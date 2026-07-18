package main

import (
	"log"

	"github.com/self-hosted/agent/internal/api"
	"github.com/self-hosted/agent/internal/config"
	"github.com/self-hosted/agent/internal/enroll"
)

func main() {
	cfg := config.Load()

	// Local dev agent: plain HTTP with a preconfigured shared token, no enrollment.
	if cfg.Insecure {
		srv := api.NewServer(cfg)
		log.Printf("agent %s listening (http) on :%d", config.Version, cfg.Port)
		if err := srv.Run(); err != nil {
			log.Fatalf("agent stopped: %v", err)
		}
		return
	}

	// Remote agent: persistent TLS identity + one-time enrollment + heartbeat.
	store := enroll.NewStore(cfg.StateDir)
	fingerprint, err := store.EnsureCert()
	if err != nil {
		log.Fatalf("tls identity: %v", err)
	}

	state := store.LoadState()
	if state == nil {
		if cfg.PanelURL == "" || cfg.JoinToken == "" {
			log.Fatalf("not enrolled: set PANEL_URL and JOIN_TOKEN for first-time enrollment")
		}
		log.Printf("enrolling with %s …", cfg.PanelURL)
		s, err := enroll.Enroll(cfg.PanelURL, cfg.JoinToken, fingerprint, config.Version, cfg.Port)
		if err != nil {
			log.Fatalf("enrollment failed: %v", err)
		}
		if err := store.SaveState(s); err != nil {
			log.Fatalf("persist state: %v", err)
		}
		state = &s
		log.Printf("enrolled as node %s", s.NodeID)
	}

	cfg.DaemonToken = state.DaemonToken
	cfg.NodeID = state.NodeID
	srv := api.NewServer(cfg)

	// Persist rotation state so a restart mid-rotation keeps accepting both the
	// old and new secret until the panel confirms the switch-over.
	persist := func(current, next string) error {
		state.DaemonToken = current
		state.NextToken = next
		return store.SaveState(*state)
	}
	srv.Configure(state.NodeID, state.NextToken, persist)

	if cfg.PanelURL != "" {
		go enroll.HeartbeatLoop(cfg.PanelURL, state.NodeID, config.Version, srv.CurrentToken)
	}

	log.Printf("agent %s listening (https) on :%d", config.Version, cfg.Port)
	if err := srv.RunTLS(store.CertPath(), store.KeyPath()); err != nil {
		log.Fatalf("agent stopped: %v", err)
	}
}
