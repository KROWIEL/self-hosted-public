package compose

import (
	"fmt"
	"path/filepath"
	"strings"
)

// ValidateComposeFilePath rejects absolute paths, empty values, and any path
// that would escape the work directory via ".." segments. The returned path is
// cleaned and slash-normalized for use as a docker compose -f argument.
func ValidateComposeFilePath(composeFile string) (string, error) {
	raw := strings.TrimSpace(composeFile)
	if raw == "" {
		raw = "docker-compose.yml"
	}
	if filepath.IsAbs(raw) || strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, `\`) {
		return "", fmt.Errorf("compose file must be a relative path")
	}
	// Reject Windows drive / UNC style even on Linux agents (defense in depth).
	if len(raw) >= 2 && raw[1] == ':' {
		return "", fmt.Errorf("compose file must be a relative path")
	}
	if strings.HasPrefix(raw, `\\`) || strings.HasPrefix(raw, "//") {
		return "", fmt.Errorf("compose file must be a relative path")
	}
	cleaned := filepath.Clean(raw)
	slash := filepath.ToSlash(cleaned)
	if slash == ".." || strings.HasPrefix(slash, "../") {
		return "", fmt.Errorf("compose file path escapes work directory")
	}
	// filepath.Clean on Windows may leave ".." segments differently; also reject
	// any remaining ".." component after clean.
	for _, part := range strings.Split(slash, "/") {
		if part == ".." {
			return "", fmt.Errorf("compose file path escapes work directory")
		}
	}
	return cleaned, nil
}

// ResolveComposePath joins workDir + relative compose file and verifies the
// result stays under workDir.
func ResolveComposePath(workDir, composeFile string) (string, error) {
	rel, err := ValidateComposeFilePath(composeFile)
	if err != nil {
		return "", err
	}
	baseClean := filepath.Clean(workDir)
	full := filepath.Clean(filepath.Join(baseClean, rel))
	if full != baseClean &&
		!strings.HasPrefix(full, baseClean+string(filepath.Separator)) {
		return "", fmt.Errorf("compose file path escapes work directory")
	}
	return full, nil
}
