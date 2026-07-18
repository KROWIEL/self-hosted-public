package builder

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/self-hosted/agent/internal/docker"
)

// idRe matches safe identifiers used to build per-service / per-work
// subdirectories (UUIDs and slugs). It forbids path separators, "..", and any
// other character that could let a crafted id escape the work directory.
var idRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// validateID rejects identifiers that are not a plain slug/UUID.
func validateID(kind, id string) error {
	if !idRe.MatchString(id) {
		return fmt.Errorf("invalid %s %q", kind, id)
	}
	return nil
}

// safeSubdir joins base + name and verifies the cleaned result stays within
// base. This is defense-in-depth (on top of validateID) so a destructive
// os.RemoveAll can never operate outside the work directory.
func safeSubdir(base, name string) (string, error) {
	baseClean := filepath.Clean(base)
	clean := filepath.Clean(filepath.Join(baseClean, name))
	if clean != baseClean &&
		!strings.HasPrefix(clean, baseClean+string(os.PathSeparator)) {
		return "", fmt.Errorf("resolved path %q escapes work dir", clean)
	}
	return clean, nil
}

// Builder clones a git repo and builds a Docker image from it.
type Builder struct {
	docker  *docker.Client
	workDir string
}

func New(d *docker.Client, workDir string) *Builder {
	return &Builder{docker: d, workDir: workDir}
}

type BuildRequest struct {
	ServiceID         string
	RepoURL           string
	Branch            string
	PATToken          string // used only in-memory for clone; never persisted
	BuildImage        string
	RunImage          string
	Dockerfile        string // path relative to the templates tree, shipped with the agent
	UseRepoDockerfile bool   // prefer the repo's own Dockerfile over the template
	// BuildMode selects the build strategy: "template" (default), "dockerfile", or "nixpacks".
	BuildMode string
	ImageTag  string
}

// Build clones the repo and builds the image, streaming output to w.
// Returns the resolved commit SHA.
func (b *Builder) Build(ctx context.Context, req BuildRequest, w io.Writer) (string, error) {
	// Validate the service id and confirm the resolved dir is inside workDir
	// BEFORE any os.RemoveAll (M3: path traversal / arbitrary deletion).
	if err := validateID("serviceID", req.ServiceID); err != nil {
		return "", err
	}
	dir, err := safeSubdir(b.workDir, req.ServiceID)
	if err != nil {
		return "", err
	}
	if err := os.RemoveAll(dir); err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	// Always clean up the working tree.
	defer os.RemoveAll(dir)

	// Reject inputs that git could interpret as options (leading "-").
	if err := validateRef(req.RepoURL, req.Branch); err != nil {
		return "", err
	}

	// Credentials are injected via the environment (http.extraHeader), never
	// baked into the clone URL — so the token stays out of argv, on-disk git
	// config and image layers. Clone the clean URL.
	cloneEnv := tokenCloneEnv(req.PATToken)

	fmt.Fprintf(w, ">> cloning %s (%s)\n", req.RepoURL, req.Branch)
	// Force LF on checkout so shell scripts (e.g. gradlew) keep their POSIX
	// shebang. On a Windows host, git's core.autocrlf can rewrite LF → CRLF,
	// which breaks `./gradlew` inside the Linux build container ("not found").
	// Restrict transports to http(s) only ("--" ends option parsing).
	if err := runEnv(ctx, w, dir, cloneEnv, "git",
		"-c", "core.autocrlf=false", "-c", "core.eol=lf",
		"-c", "protocol.allow=never",
		"-c", "protocol.https.allow=always",
		"-c", "protocol.http.allow=always",
		"clone", "--depth", "1", "--branch", req.Branch, "--", req.RepoURL, "."); err != nil {
		return "", fmt.Errorf("git clone failed: %w", err)
	}

	// Keep the .git directory (history + any embedded creds) out of the image:
	// the templates do `COPY . .`, so ensure the context ignores it.
	if err := ensureDockerignoreGit(dir); err != nil {
		return "", err
	}

	sha, err := commitSHA(ctx, dir)
	if err != nil {
		return "", err
	}

	mode := strings.ToLower(strings.TrimSpace(req.BuildMode))
	if mode == "" {
		if req.UseRepoDockerfile {
			mode = "dockerfile"
		} else {
			mode = "template"
		}
	}

	if mode == "nixpacks" {
		fmt.Fprintf(w, ">> building image %s with nixpacks\n", req.ImageTag)
		if err := runNixpacks(ctx, w, dir, req.ImageTag); err != nil {
			return "", err
		}
		fmt.Fprintf(w, ">> build complete: %s @ %s\n", req.ImageTag, sha)
		return sha, nil
	}

	useRepo := req.UseRepoDockerfile || mode == "dockerfile"
	dockerfilePath := resolveDockerfile(dir, req.Dockerfile, useRepo)
	fmt.Fprintf(w, ">> building image %s (dockerfile: %s)\n", req.ImageTag, dockerfilePath)
	buildArgs := map[string]string{
		"BUILD_IMAGE": req.BuildImage,
		"RUN_IMAGE":   req.RunImage,
	}
	if err := b.docker.BuildImage(ctx, dir, dockerfilePath, req.ImageTag, buildArgs, w); err != nil {
		return "", fmt.Errorf("docker build failed: %w", err)
	}

	fmt.Fprintf(w, ">> build complete: %s @ %s\n", req.ImageTag, sha)
	return sha, nil
}

// nixpacksBin resolves the nixpacks CLI path (AGENT_NIXPACKS_BIN or PATH).
func nixpacksBin() string {
	if v := strings.TrimSpace(os.Getenv("AGENT_NIXPACKS_BIN")); v != "" {
		return v
	}
	return "nixpacks"
}

// runNixpacks builds an image with the nixpacks CLI. Clear error if missing.
func runNixpacks(ctx context.Context, w io.Writer, workDir, imageTag string) error {
	bin := nixpacksBin()
	path, err := exec.LookPath(bin)
	if err != nil {
		fmt.Fprintf(w, "!! nixpacks binary not found (%s). Install nixpacks on the node or set AGENT_NIXPACKS_BIN.\n", bin)
		return fmt.Errorf("nixpacks not found: %w (set AGENT_NIXPACKS_BIN or install nixpacks on PATH)", err)
	}
	return run(ctx, w, workDir, path, "build", ".", "--name", imageTag)
}

// resolveDockerfile decides which Dockerfile to build with.
//
// By default the selected template's Dockerfile wins (predictable, self-contained
// multi-stage builds from source). The repo's own Dockerfile is only used when
// the service opts in via useRepoDockerfile, or as a fallback when no template
// Dockerfile is configured.
func resolveDockerfile(repoDir, templateRel string, useRepoDockerfile bool) string {
	repoDockerfile := filepath.Join(repoDir, "Dockerfile")
	repoExists := false
	if _, err := os.Stat(repoDockerfile); err == nil {
		repoExists = true
	}

	if templateRel == "" {
		return repoDockerfile // nothing else to build with
	}
	if useRepoDockerfile && repoExists {
		return repoDockerfile
	}

	templateRoot := os.Getenv("AGENT_TEMPLATES_DIR")
	if templateRoot == "" {
		templateRoot = "/opt/agent/templates"
	}
	// The stored path may carry a leading "templates/" prefix while
	// AGENT_TEMPLATES_DIR already points at the templates dir. Strip it so the
	// join doesn't produce a doubled ".../templates/templates/..." path.
	rel := strings.TrimPrefix(filepath.ToSlash(templateRel), "templates/")
	return filepath.Join(templateRoot, filepath.FromSlash(rel))
}

// validateRef rejects a clone URL or branch that begins with "-" and would
// otherwise be parsed by git as an option/flag (option-injection).
func validateRef(cloneURL, branch string) error {
	if strings.HasPrefix(cloneURL, "-") {
		return fmt.Errorf("invalid repo URL: must not start with '-'")
	}
	if strings.HasPrefix(branch, "-") {
		return fmt.Errorf("invalid branch: must not start with '-'")
	}
	return nil
}

// tokenCloneEnv returns extra environment entries that make git send an HTTP
// Authorization header for the clone via the GIT_CONFIG_* mechanism (git
// 2.31+). This keeps the PAT out of argv and the stored remote URL. Returns nil
// when no token is set (unauthenticated clone — behavior unchanged).
func tokenCloneEnv(token string) []string {
	if token == "" {
		return nil
	}
	basic := base64.StdEncoding.EncodeToString([]byte("x-access-token:" + token))
	return []string{
		"GIT_CONFIG_COUNT=1",
		"GIT_CONFIG_KEY_0=http.extraHeader",
		"GIT_CONFIG_VALUE_0=AUTHORIZATION: Basic " + basic,
	}
}

// ensureDockerignoreGit guarantees the build context ignores ".git" so the repo
// history (and any credentials it might contain) is never copied into an image
// by template Dockerfiles that use `COPY . .`.
func ensureDockerignoreGit(dir string) error {
	path := filepath.Join(dir, ".dockerignore")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return os.WriteFile(path, []byte(".git\n"), 0o644)
		}
		return err
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(line) == ".git" {
			return nil // already ignored
		}
	}
	content := string(data)
	if len(content) > 0 && !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	content += ".git\n"
	return os.WriteFile(path, []byte(content), 0o644)
}

func commitSHA(ctx context.Context, dir string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "rev-parse", "HEAD")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func run(ctx context.Context, w io.Writer, dir string, name string, args ...string) error {
	return runEnv(ctx, w, dir, nil, name, args...)
}

// runEnv is run() with extra environment variables appended to the process
// environment (used to pass git credentials without exposing them in argv).
func runEnv(ctx context.Context, w io.Writer, dir string, extraEnv []string, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Stdout = w
	cmd.Stderr = w
	if len(extraEnv) > 0 {
		cmd.Env = append(os.Environ(), extraEnv...)
	}
	return cmd.Run()
}
