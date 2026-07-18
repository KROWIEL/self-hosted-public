package compose

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// projectNameRe matches docker compose project names (lowercase alnum + _-).
var projectNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

// ValidateProjectName rejects unsafe compose project names.
func ValidateProjectName(name string) error {
	if !projectNameRe.MatchString(name) {
		return fmt.Errorf("invalid compose project name %q", name)
	}
	return nil
}

// UpRequest describes a compose up invocation.
type UpRequest struct {
	ProjectName string
	WorkDir     string
	ComposeFile string // relative path inside WorkDir
	Env         map[string]string
	Network     string
}

// Runner shells out to `docker compose`.
type Runner struct{}

func NewRunner() *Runner { return &Runner{} }

// Up runs `docker compose -p <name> -f <file> up -d --build`, streaming logs to w.
func (r *Runner) Up(ctx context.Context, req UpRequest, w io.Writer) error {
	if err := ValidateProjectName(req.ProjectName); err != nil {
		return err
	}
	composePath, err := ResolveComposePath(req.WorkDir, req.ComposeFile)
	if err != nil {
		return err
	}
	if _, err := os.Stat(composePath); err != nil {
		return fmt.Errorf("compose file not found: %w", err)
	}

	relFile, err := filepath.Rel(req.WorkDir, composePath)
	if err != nil {
		return err
	}

	envFile, err := writeEnvFile(req.WorkDir, req.Env)
	if err != nil {
		return err
	}
	defer os.Remove(envFile)

	relEnv, err := filepath.Rel(req.WorkDir, envFile)
	if err != nil {
		relEnv = filepath.Base(envFile)
	}

	args := []string{
		"compose",
		"-p", req.ProjectName,
		"-f", relFile,
		"--env-file", relEnv,
		"up", "-d", "--build",
	}

	fmt.Fprintf(w, ">> docker compose -p %s up -d --build\n", req.ProjectName)
	return runCompose(ctx, req.WorkDir, w, args...)
}

// Down tears down a compose project. When removeVolumes is true, passes -v.
func (r *Runner) Down(ctx context.Context, projectName string, removeVolumes bool, w io.Writer) error {
	if err := ValidateProjectName(projectName); err != nil {
		return err
	}
	args := []string{"compose", "-p", projectName, "down"}
	if removeVolumes {
		args = append(args, "-v")
	}
	fmt.Fprintf(w, ">> docker compose -p %s down\n", projectName)
	return runCompose(ctx, "", w, args...)
}

// Power runs start/stop/restart against an existing compose project.
func (r *Runner) Power(ctx context.Context, projectName, action string, w io.Writer) error {
	if err := ValidateProjectName(projectName); err != nil {
		return err
	}
	switch strings.ToLower(action) {
	case "start", "stop", "restart":
		// ok
	default:
		return fmt.Errorf("unsupported compose power action %q", action)
	}
	args := []string{"compose", "-p", projectName, strings.ToLower(action)}
	fmt.Fprintf(w, ">> docker compose -p %s %s\n", projectName, action)
	return runCompose(ctx, "", w, args...)
}

func writeEnvFile(workDir string, env map[string]string) (string, error) {
	path := filepath.Join(workDir, ".selfhosted.env")
	var b strings.Builder
	for k, v := range env {
		if k == "" || strings.ContainsAny(k, "=\n\r") {
			continue
		}
		val := strings.ReplaceAll(v, "\n", "\\n")
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(val)
		b.WriteByte('\n')
	}
	if err := os.WriteFile(path, []byte(b.String()), 0o600); err != nil {
		return "", err
	}
	return path, nil
}

func runCompose(ctx context.Context, dir string, w io.Writer, args ...string) error {
	cmd := exec.CommandContext(ctx, "docker", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}
