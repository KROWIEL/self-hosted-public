package builder

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveDockerfile(t *testing.T) {
	repo := t.TempDir()
	repoDockerfile := filepath.Join(repo, "Dockerfile")

	t.Run("no template falls back to repo Dockerfile", func(t *testing.T) {
		if got := resolveDockerfile(repo, "", false); got != repoDockerfile {
			t.Fatalf("got %q, want %q", got, repoDockerfile)
		}
	})

	t.Run("opt-in uses repo Dockerfile when present", func(t *testing.T) {
		if err := os.WriteFile(repoDockerfile, []byte("FROM scratch"), 0o644); err != nil {
			t.Fatal(err)
		}
		got := resolveDockerfile(repo, "templates/java/Dockerfile", true)
		if got != repoDockerfile {
			t.Fatalf("got %q, want %q", got, repoDockerfile)
		}
	})

	t.Run("template wins by default and strips templates/ prefix", func(t *testing.T) {
		root := t.TempDir()
		t.Setenv("AGENT_TEMPLATES_DIR", root)
		got := resolveDockerfile(repo, "templates/java/Dockerfile", false)
		want := filepath.Join(root, "java", "Dockerfile")
		if got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
	})

	t.Run("opt-in but no repo Dockerfile falls through to template", func(t *testing.T) {
		emptyRepo := t.TempDir()
		root := t.TempDir()
		t.Setenv("AGENT_TEMPLATES_DIR", root)
		got := resolveDockerfile(emptyRepo, "nextjs/Dockerfile", true)
		want := filepath.Join(root, "nextjs", "Dockerfile")
		if got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
	})
}

func TestTokenCloneEnv(t *testing.T) {
	if env := tokenCloneEnv(""); env != nil {
		t.Fatalf("expected nil env without a token, got %v", env)
	}

	env := tokenCloneEnv("secret123")
	basic := base64.StdEncoding.EncodeToString([]byte("x-access-token:secret123"))
	want := []string{
		"GIT_CONFIG_COUNT=1",
		"GIT_CONFIG_KEY_0=http.extraHeader",
		"GIT_CONFIG_VALUE_0=AUTHORIZATION: Basic " + basic,
	}
	if len(env) != len(want) {
		t.Fatalf("got %v, want %v", env, want)
	}
	for i := range want {
		if env[i] != want[i] {
			t.Fatalf("index %d: got %q, want %q", i, env[i], want[i])
		}
	}
	// The raw token must never appear verbatim (only base64 in the header).
	for _, e := range env {
		if strings.Contains(e, "secret123") {
			t.Fatalf("raw token leaked into env entry %q", e)
		}
	}
}

func TestValidateRef(t *testing.T) {
	if err := validateRef("https://github.com/acme/app.git", "main"); err != nil {
		t.Fatalf("valid ref rejected: %v", err)
	}
	if err := validateRef("--upload-pack=evil", "main"); err == nil {
		t.Fatal("expected leading-dash URL to be rejected")
	}
	if err := validateRef("https://github.com/acme/app.git", "-x"); err == nil {
		t.Fatal("expected leading-dash branch to be rejected")
	}
}

func TestValidateID(t *testing.T) {
	valid := []string{
		"svc",
		"service-123",
		"a_b-c",
		"550e8400-e29b-41d4-a716-446655440000",
	}
	for _, id := range valid {
		if err := validateID("serviceID", id); err != nil {
			t.Fatalf("valid id %q rejected: %v", id, err)
		}
	}
	invalid := []string{
		"",
		"../etc",
		"a/b",
		"a b",
		"a:b",
		"foo/../bar",
		".",
		"..",
	}
	for _, id := range invalid {
		if err := validateID("serviceID", id); err == nil {
			t.Fatalf("expected id %q to be rejected", id)
		}
	}
}

func TestSafeSubdir(t *testing.T) {
	base := t.TempDir()

	t.Run("contained subdir is accepted", func(t *testing.T) {
		got, err := safeSubdir(base, "service-1")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		want := filepath.Join(base, "service-1")
		if got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
	})

	t.Run("traversal escaping base is rejected", func(t *testing.T) {
		for _, name := range []string{"../evil", "../../etc", "sub/../../out"} {
			if _, err := safeSubdir(base, name); err == nil {
				t.Fatalf("expected %q to be rejected", name)
			}
		}
	})
}

func TestEnsureDockerignoreGit(t *testing.T) {
	t.Run("creates when missing", func(t *testing.T) {
		dir := t.TempDir()
		if err := ensureDockerignoreGit(dir); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(filepath.Join(dir, ".dockerignore"))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), ".git") {
			t.Fatalf("expected .git in .dockerignore, got %q", data)
		}
	})

	t.Run("appends when present without .git", func(t *testing.T) {
		dir := t.TempDir()
		p := filepath.Join(dir, ".dockerignore")
		if err := os.WriteFile(p, []byte("node_modules"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := ensureDockerignoreGit(dir); err != nil {
			t.Fatal(err)
		}
		data, _ := os.ReadFile(p)
		if !strings.Contains(string(data), "node_modules") ||
			!strings.Contains(string(data), ".git") {
			t.Fatalf("expected both entries, got %q", data)
		}
	})

	t.Run("no duplicate when already ignored", func(t *testing.T) {
		dir := t.TempDir()
		p := filepath.Join(dir, ".dockerignore")
		if err := os.WriteFile(p, []byte(".git\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := ensureDockerignoreGit(dir); err != nil {
			t.Fatal(err)
		}
		data, _ := os.ReadFile(p)
		if strings.Count(string(data), ".git") != 1 {
			t.Fatalf("expected a single .git entry, got %q", data)
		}
	})
}
