package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Version is the agent build version reported to the control plane.
const Version = "0.2.0"

// Config holds agent runtime configuration sourced from environment.
type Config struct {
	Port int
	// DaemonToken is the bearer token the control plane must present.
	// MVP: shared token. Later: verify RSA-signed JWT with the panel's public key.
	DaemonToken string
	// WorkDir is where repos are cloned during builds (prefer tmpfs in prod).
	WorkDir string
	// Network is the default Docker network deployed services join.
	Network string
	// BackupDir is where volume/database snapshots are stored on the node.
	BackupDir string

	// --- Remote-node (Track 4) ---
	// PanelURL is the control-plane base URL (e.g. https://panel.example) used
	// for one-time enrollment and periodic heartbeats. Empty in local dev.
	PanelURL string
	// JoinToken is the one-time enrollment token issued by the panel. Used only
	// on first boot when no daemon token has been provisioned yet.
	JoinToken string
	// StateDir persists the TLS cert/key and the provisioned daemon token so the
	// agent survives restarts without re-enrolling.
	StateDir string
	// Insecure disables TLS (plain HTTP). Intended for the local dev agent only.
	Insecure bool
}

func Load() Config {
	workDir := envStr("AGENT_WORKDIR", "/tmp/agent-builds")
	return Config{
		Port:        envInt("AGENT_PORT", 8443),
		DaemonToken: os.Getenv("AGENT_DAEMON_TOKEN"),
		WorkDir:     workDir,
		Network:     envStr("AGENT_NETWORK", "bridge"),
		BackupDir:   envStr("AGENT_BACKUP_DIR", filepath.Join(workDir, "backups")),
		PanelURL:    strings.TrimRight(envStr("AGENT_PANEL_URL", os.Getenv("PANEL_URL")), "/"),
		JoinToken:   envStr("AGENT_JOIN_TOKEN", os.Getenv("JOIN_TOKEN")),
		StateDir:    envStr("AGENT_STATE_DIR", "/var/lib/selfhosted-agent"),
		Insecure:    os.Getenv("AGENT_INSECURE_HTTP") == "1",
	}
}

func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
