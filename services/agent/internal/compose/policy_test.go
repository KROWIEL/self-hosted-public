package compose

import (
	"strings"
	"testing"
)

func TestCheckComposePrivileges(t *testing.T) {
	ok := `
services:
  web:
    image: nginx:alpine
    volumes:
      - data:/var/www
`
	if err := CheckComposePrivileges(ok); err != nil {
		t.Fatalf("expected ok, got %v", err)
	}

	cases := []struct {
		name string
		yaml string
		want string
	}{
		{
			name: "privileged",
			yaml: "services:\n  x:\n    privileged: true\n",
			want: "privileged",
		},
		{
			name: "docker.sock bind",
			yaml: "services:\n  x:\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n",
			want: "docker.sock",
		},
		{
			name: "network_mode host",
			yaml: "services:\n  x:\n    network_mode: host\n",
			want: "network_mode",
		},
		{
			name: "network_mode host quoted",
			yaml: "services:\n  x:\n    network_mode: \"host\"\n",
			want: "network_mode",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := CheckComposePrivileges(tc.yaml)
			if err == nil {
				t.Fatalf("expected error containing %q", tc.want)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error %q should mention %q", err.Error(), tc.want)
			}
		})
	}
}
