package compose

import (
	"fmt"
	"os"
	"regexp"
)

// Patterns that must never appear in tenant compose files: they escalate to host
// Docker control, privileged containers, or host networking.
var (
	rePrivilegedTrue = regexp.MustCompile(`(?i)(^|[\s,{])privileged\s*:\s*true\b`)
	reDockerSock     = regexp.MustCompile(`(?i)/var/run/docker\.sock`)
	reNetworkModeHost = regexp.MustCompile(`(?i)(^|[\s,{])network_mode\s*:\s*["']?host["']?\b`)
)

// CheckComposePrivileges scans compose YAML/text for dangerous privilege patterns
// and returns a clear error if any are found.
func CheckComposePrivileges(content string) error {
	if rePrivilegedTrue.MatchString(content) {
		return fmt.Errorf("compose policy: privileged: true is not allowed")
	}
	if reDockerSock.MatchString(content) {
		return fmt.Errorf("compose policy: mounting /var/run/docker.sock is not allowed")
	}
	if reNetworkModeHost.MatchString(content) {
		return fmt.Errorf("compose policy: network_mode: host is not allowed")
	}
	return nil
}

// CheckComposeFile reads the compose file at path and applies CheckComposePrivileges.
func CheckComposeFile(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("compose policy: read file: %w", err)
	}
	return CheckComposePrivileges(string(raw))
}
