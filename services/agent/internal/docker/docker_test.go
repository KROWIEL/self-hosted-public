package docker

import (
	"context"
	"strings"
	"testing"
)

func TestValidVolumeName(t *testing.T) {
	valid := []string{
		"vol-1a2b3c4d",
		"data",
		"my_volume.1",
		"a1",
	}
	for _, name := range valid {
		if !ValidVolumeName(name) {
			t.Fatalf("expected %q to be a valid volume name", name)
		}
	}

	// Names that would let "-v <name>:<path>" become a host bind-mount or carry
	// path/shell metacharacters must be rejected.
	invalid := []string{
		"",
		"a", // too short (needs 2+ chars)
		"/etc",
		"/var/run/docker.sock",
		"foo/bar",
		"name:extra",
		".hidden",
		"-flag",
		"a b",
	}
	for _, name := range invalid {
		if ValidVolumeName(name) {
			t.Fatalf("expected %q to be rejected", name)
		}
	}
}

func TestContainerRunArgsReadOnlyRootfs(t *testing.T) {
	t.Setenv("AGENT_GVISOR", "")
	args, err := containerRunArgs(context.Background(), RunOptions{
		Name:           "svc-abc",
		Image:          "app:latest",
		ReadOnlyRootfs: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	if !containsArg(args, "--read-only") {
		t.Fatalf("expected --read-only in args: %s", joined)
	}
	if !containsPair(args, "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m") {
		t.Fatalf("expected /tmp tmpfs in args: %s", joined)
	}
	if !containsPair(args, "--tmpfs", "/var/tmp:rw,nosuid,nodev,size=64m") {
		t.Fatalf("expected /var/tmp tmpfs in args: %s", joined)
	}
	if containsArg(args, "--runtime=runsc") {
		t.Fatalf("gVisor must stay off by default: %s", joined)
	}
}

func TestContainerRunArgsDBNoReadOnly(t *testing.T) {
	t.Setenv("AGENT_GVISOR", "")
	args, err := containerRunArgs(context.Background(), RunOptions{
		Name:  "db-pg",
		Image: "postgres:16",
		// ReadOnlyRootfs left false — managed DB sidecars need a writable rootfs
		// for engine internals beyond the data volume.
	})
	if err != nil {
		t.Fatal(err)
	}
	if containsArg(args, "--read-only") {
		t.Fatalf("DB containers must not get --read-only: %v", args)
	}
}

func containsArg(args []string, want string) bool {
	for _, a := range args {
		if a == want {
			return true
		}
	}
	return false
}

func containsPair(args []string, flag, value string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == flag && args[i+1] == value {
			return true
		}
	}
	return false
}
