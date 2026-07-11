package builder

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/self-hosted/agent/internal/docker"
)

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
	ImageTag          string
}

// Build clones the repo and builds the image, streaming output to w.
// Returns the resolved commit SHA.
func (b *Builder) Build(ctx context.Context, req BuildRequest, w io.Writer) (string, error) {
	dir := filepath.Join(b.workDir, req.ServiceID)
	if err := os.RemoveAll(dir); err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	// Always clean up the working tree (and any token in the remote URL).
	defer os.RemoveAll(dir)

	cloneURL := req.RepoURL
	if req.PATToken != "" {
		cloneURL = injectToken(req.RepoURL, req.PATToken)
	}

	fmt.Fprintf(w, ">> cloning %s (%s)\n", req.RepoURL, req.Branch)
	// Force LF on checkout so shell scripts (e.g. gradlew) keep their POSIX
	// shebang. On a Windows host, git's core.autocrlf can rewrite LF → CRLF,
	// which breaks `./gradlew` inside the Linux build container ("not found").
	if err := run(ctx, w, dir, "git",
		"-c", "core.autocrlf=false", "-c", "core.eol=lf",
		"clone", "--depth", "1", "--branch", req.Branch, cloneURL, "."); err != nil {
		return "", fmt.Errorf("git clone failed: %w", err)
	}

	sha, err := commitSHA(ctx, dir)
	if err != nil {
		return "", err
	}

	dockerfilePath := resolveDockerfile(dir, req.Dockerfile, req.UseRepoDockerfile)
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

func injectToken(repoURL, token string) string {
	if strings.HasPrefix(repoURL, "https://") {
		return "https://x-access-token:" + token + "@" + strings.TrimPrefix(repoURL, "https://")
	}
	return repoURL
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
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}
