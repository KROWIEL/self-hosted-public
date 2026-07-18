package config

import (
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// devSentinel reports whether the explicit AGENT_DEV=1 opt-in is set. Insecure
// kill-switches (plain HTTP, skip panel TLS verify) are ignored unless it is, so
// they can't be flipped on by accident in production (L2).
func devSentinel() bool {
	return os.Getenv("AGENT_DEV") == "1"
}

// insecureHTTP resolves AGENT_INSECURE_HTTP, honoring it only alongside the
// AGENT_DEV sentinel and emitting a hard warning either way.
func insecureHTTP() bool {
	if os.Getenv("AGENT_INSECURE_HTTP") != "1" {
		return false
	}
	if !devSentinel() {
		log.Printf("WARNING: AGENT_INSECURE_HTTP=1 ignored because AGENT_DEV=1 is not set; " +
			"refusing to serve plain HTTP. Set AGENT_DEV=1 to enable it for local development.")
		return false
	}
	log.Printf("WARNING: AGENT_INSECURE_HTTP is ACTIVE — the agent serves PLAIN HTTP with no TLS. " +
		"This is for local development only; never expose it on an untrusted network.")
	return true
}

// Version is the agent build version reported to the control plane. 0.3.0+
// verifies short-lived HS256 request tokens and supports daemon-token rotation;
// the control plane uses this version to decide when to mint signed tokens.
const Version = "0.3.0"

// Config holds agent runtime configuration sourced from environment.
type Config struct {
	Port int
	// DaemonToken is the shared secret the control plane authenticates with —
	// either presented raw (legacy / back-compat) or used to sign short-lived
	// HS256 request tokens the agent verifies.
	DaemonToken string
	// NodeID is this node's control-plane id. Enrolled agents load it from
	// persisted state; the dev agent may set it via AGENT_NODE_ID so signed
	// request tokens can be audience-checked. Empty disables the audience check.
	NodeID string
	// WorkDir is where repos are cloned during builds (prefer tmpfs in prod).
	WorkDir string
	// Network is the default Docker network deployed services join.
	Network string
	// BackupDir is where volume/database snapshots are stored on the node.
	BackupDir string
	// TraefikCertsDir / TraefikDynamicDir hold custom TLS PEMs + file-provider
	// YAML. Bind-mount the same host paths into Traefik as /certs and /dynamic.
	TraefikCertsDir   string
	TraefikDynamicDir string

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

	// --- Build/inspect resource limits (DoS hardening) ---
	// BuildTimeout caps a single image build; InspectTimeout caps a repo inspect.
	// Both also cancel automatically when the caller disconnects.
	BuildTimeout   time.Duration
	InspectTimeout time.Duration
	// MaxConcurrentBuilds caps how many builds may run at once on this agent, so
	// a burst of deploys can't exhaust CPU/RAM/disk. Minimum 1.
	MaxConcurrentBuilds int
}

func Load() Config {
	workDir := envStr("AGENT_WORKDIR", "/tmp/agent-builds")
	stateDir := envStr("AGENT_STATE_DIR", "/var/lib/selfhosted-agent")
	return Config{
		Port:        envInt("AGENT_PORT", 8443),
		DaemonToken: os.Getenv("AGENT_DAEMON_TOKEN"),
		NodeID:      os.Getenv("AGENT_NODE_ID"),
		WorkDir:     workDir,
		Network:     envStr("AGENT_NETWORK", "bridge"),
		BackupDir:   envStr("AGENT_BACKUP_DIR", filepath.Join(workDir, "backups")),
		TraefikCertsDir: envStr(
			"AGENT_TRAEFIK_CERTS_DIR",
			filepath.Join(stateDir, "traefik", "certs"),
		),
		TraefikDynamicDir: envStr(
			"AGENT_TRAEFIK_DYNAMIC_DIR",
			filepath.Join(stateDir, "traefik", "dynamic"),
		),
		PanelURL:  strings.TrimRight(envStr("AGENT_PANEL_URL", os.Getenv("PANEL_URL")), "/"),
		JoinToken: envStr("AGENT_JOIN_TOKEN", os.Getenv("JOIN_TOKEN")),
		StateDir:  stateDir,
		Insecure:  insecureHTTP(),

		BuildTimeout:        envDuration("AGENT_BUILD_TIMEOUT", 20*time.Minute),
		InspectTimeout:      envDuration("AGENT_INSPECT_TIMEOUT", 2*time.Minute),
		MaxConcurrentBuilds: envInt("AGENT_MAX_CONCURRENT_BUILDS", 2),
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

// envDuration reads a Go duration string (e.g. "20m", "90s", "1h30m") from the
// environment. A bare integer is treated as seconds for convenience. Falls back
// to def when unset, malformed or non-positive.
func envDuration(key string, def time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	if d, err := time.ParseDuration(v); err == nil && d > 0 {
		return d
	}
	if n, err := strconv.Atoi(v); err == nil && n > 0 {
		return time.Duration(n) * time.Second
	}
	return def
}
