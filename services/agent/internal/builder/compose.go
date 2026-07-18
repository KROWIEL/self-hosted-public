package builder

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ComposePrepareRequest prepares a work directory for docker compose up.
type ComposePrepareRequest struct {
	ServiceID   string
	RepoURL     string // optional when ComposeYAML is set
	Branch      string
	PATToken    string
	ComposeFile string
	ComposeYAML string // when set, skip git clone and write this file
}

// PrepareCompose creates (or refreshes) a work dir for the service: either
// writes inline compose YAML or shallow-clones the repo. Returns the work dir
// and the relative compose file path to pass to docker compose -f.
func (b *Builder) PrepareCompose(ctx context.Context, req ComposePrepareRequest, w io.Writer) (workDir, composeFile string, err error) {
	if err := validateID("serviceID", req.ServiceID); err != nil {
		return "", "", err
	}
	dir, err := safeSubdir(b.workDir, "compose-"+req.ServiceID)
	if err != nil {
		return "", "", err
	}
	if err := os.RemoveAll(dir); err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", "", err
	}

	composeFile = req.ComposeFile
	if composeFile == "" {
		composeFile = "docker-compose.yml"
	}

	if strings.TrimSpace(req.ComposeYAML) != "" {
		// Inline catalog compose — write the YAML at the requested relative path.
		full := filepath.Join(dir, filepath.FromSlash(filepath.ToSlash(composeFile)))
		if err := os.MkdirAll(filepath.Dir(full), 0o700); err != nil {
			_ = os.RemoveAll(dir)
			return "", "", err
		}
		if err := os.WriteFile(full, []byte(req.ComposeYAML), 0o600); err != nil {
			_ = os.RemoveAll(dir)
			return "", "", err
		}
		fmt.Fprintf(w, ">> wrote inline compose file %s\n", composeFile)
		return dir, composeFile, nil
	}

	if strings.TrimSpace(req.RepoURL) == "" {
		_ = os.RemoveAll(dir)
		return "", "", fmt.Errorf("repoUrl or composeYaml is required")
	}
	if err := validateRef(req.RepoURL, req.Branch); err != nil {
		_ = os.RemoveAll(dir)
		return "", "", err
	}
	branch := req.Branch
	if branch == "" {
		branch = "main"
	}
	cloneEnv := tokenCloneEnv(req.PATToken)
	fmt.Fprintf(w, ">> cloning %s (%s) for compose\n", req.RepoURL, branch)
	if err := runEnv(ctx, w, dir, cloneEnv, "git",
		"-c", "core.autocrlf=false", "-c", "core.eol=lf",
		"-c", "protocol.allow=never",
		"-c", "protocol.https.allow=always",
		"-c", "protocol.http.allow=always",
		"clone", "--depth", "1", "--branch", branch, "--", req.RepoURL, "."); err != nil {
		_ = os.RemoveAll(dir)
		return "", "", fmt.Errorf("git clone failed: %w", err)
	}
	return dir, composeFile, nil
}
