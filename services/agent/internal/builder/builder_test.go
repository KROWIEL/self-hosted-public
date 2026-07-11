package builder

import (
	"os"
	"path/filepath"
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

func TestInjectToken(t *testing.T) {
	t.Run("https gets x-access-token credentials", func(t *testing.T) {
		got := injectToken("https://github.com/acme/app.git", "secret123")
		want := "https://x-access-token:secret123@github.com/acme/app.git"
		if got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
	})

	t.Run("non-https left untouched", func(t *testing.T) {
		in := "git@github.com:acme/app.git"
		if got := injectToken(in, "secret123"); got != in {
			t.Fatalf("got %q, want %q", got, in)
		}
	})
}
