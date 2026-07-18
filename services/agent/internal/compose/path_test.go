package compose

import (
	"path/filepath"
	"testing"
)

func TestValidateComposeFilePath(t *testing.T) {
	ok := []string{
		"docker-compose.yml",
		"compose.yaml",
		"deploy/compose.yml",
		"./docker-compose.yml",
		"",
	}
	for _, p := range ok {
		got, err := ValidateComposeFilePath(p)
		if err != nil {
			t.Fatalf("%q rejected: %v", p, err)
		}
		if p == "" && got != "docker-compose.yml" {
			t.Fatalf("empty default: got %q", got)
		}
	}

	bad := []string{
		"../docker-compose.yml",
		"../../etc/passwd",
		"/etc/docker-compose.yml",
		"foo/../../bar.yml",
		`C:\evil\compose.yml`,
		`\\server\share\compose.yml`,
		"//server/share/compose.yml",
	}
	for _, p := range bad {
		if _, err := ValidateComposeFilePath(p); err == nil {
			t.Fatalf("expected %q to be rejected", p)
		}
	}
}

func TestResolveComposePath(t *testing.T) {
	base := t.TempDir()
	full, err := ResolveComposePath(base, "deploy/compose.yml")
	if err != nil {
		t.Fatal(err)
	}
	wantPrefix := filepath.Clean(base)
	if full != wantPrefix && !hasPathPrefix(full, wantPrefix) {
		t.Fatalf("resolved %q not under %q", full, base)
	}
	if _, err := ResolveComposePath(base, "../escape.yml"); err == nil {
		t.Fatal("expected traversal to be rejected")
	}
}

func hasPathPrefix(path, prefix string) bool {
	sep := string(filepath.Separator)
	return path == prefix || (len(path) > len(prefix) && path[:len(prefix)+1] == prefix+sep)
}

func TestValidateProjectName(t *testing.T) {
	if err := ValidateProjectName("svc-abc123"); err != nil {
		t.Fatal(err)
	}
	if err := ValidateProjectName("Bad Name"); err == nil {
		t.Fatal("expected rejection")
	}
	if err := ValidateProjectName("../evil"); err == nil {
		t.Fatal("expected rejection")
	}
}
