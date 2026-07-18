package docker

import "testing"

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
		"a",              // too short (needs 2+ chars)
		"/etc",           // absolute host path
		"/var/run/docker.sock",
		"foo/bar",        // path separator
		"name:extra",     // embedded colon
		".hidden",        // must start alphanumeric
		"-flag",          // option-like
		"a b",            // space
	}
	for _, name := range invalid {
		if ValidVolumeName(name) {
			t.Fatalf("expected %q to be rejected", name)
		}
	}
}
