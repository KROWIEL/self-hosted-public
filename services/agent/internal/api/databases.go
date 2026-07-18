package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/self-hosted/agent/internal/docker"
)

// Managed database lifecycle (Postgres/MySQL sidecars). The control plane owns
// naming, image and credentials; the agent just creates the volume + container
// on the shared network with no published port (reachable only inside it).

type dbCreateBody struct {
	Container    string            `json:"container"`
	Volume       string            `json:"volume"`
	Image        string            `json:"image"`
	Network      string            `json:"network"`
	DataDir      string            `json:"dataDir"`
	InternalPort int               `json:"internalPort"`
	Env          map[string]string `json:"env"`
}

func (s *Server) handleDBCreate(w http.ResponseWriter, r *http.Request) {
	var body dbCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	network := body.Network
	if network == "" {
		network = s.cfg.Network
	}

	opts := docker.RunOptions{
		Name:    body.Container,
		Image:   body.Image,
		Network: network,
		Env:     body.Env,
		Volumes: []docker.VolumeMount{{Name: body.Volume, MountPath: body.DataDir}},
	}

	id, err := s.docker.RunContainer(context.Background(), opts, discardWriter{})
	if err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true, "containerId": id})
}

type dbPowerBody struct {
	Container string `json:"container"`
	Action    string `json:"action"`
}

func (s *Server) handleDBPower(w http.ResponseWriter, r *http.Request) {
	var body dbPowerBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := s.docker.Power(context.Background(), body.Container, body.Action); err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

type dbRemoveBody struct {
	Container  string `json:"container"`
	Volume     string `json:"volume"`
	KeepVolume bool   `json:"keepVolume"`
}

func (s *Server) handleDBRemove(w http.ResponseWriter, r *http.Request) {
	var body dbRemoveBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	ctx := context.Background()
	_ = s.docker.Remove(ctx, body.Container)
	if !body.KeepVolume && body.Volume != "" {
		_ = s.docker.RemoveVolume(ctx, body.Volume)
	}
	writeJSON(w, map[string]any{"ok": true})
}

type dbStatusBody struct {
	Container string `json:"container"`
	Engine    string `json:"engine"`
	User      string `json:"user"`
	Password  string `json:"password"`
	DBName    string `json:"dbName"`
}

func (s *Server) handleDBStatus(w http.ResponseWriter, r *http.Request) {
	var body dbStatusBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	ctx := r.Context()

	state, err := s.docker.Inspect(ctx, body.Container, "{{.State.Status}}")
	if err != nil || state == "" {
		writeJSON(w, map[string]any{"running": false, "state": "missing", "ready": false})
		return
	}

	ready := false
	if state == "running" {
		switch body.Engine {
		case "postgres":
			_, e := s.docker.Exec(ctx, body.Container, "pg_isready", "-U", body.User, "-d", body.DBName)
			ready = e == nil
		case "mysql":
			// argv only; password via MYSQL_PWD env, never on the command line.
			_, e := s.docker.ExecEnv(ctx, body.Container,
				dbPasswordEnv("mysql", body.Password),
				"mysqladmin", "ping", "-uroot", "--silent")
			ready = e == nil
		}
	}

	writeJSON(w, map[string]any{
		"running": state == "running",
		"state":   state,
		"ready":   ready,
	})
}

type dbSchemaBody struct {
	Container string `json:"container"`
	Engine    string `json:"engine"`
	User      string `json:"user"`
	Password  string `json:"password"`
	Schema    string `json:"schema"`
}

// handleDBSchema creates an additional schema/database inside an existing
// managed DB container (idempotent), granting access to the app user.
func (s *Server) handleDBSchema(w http.ResponseWriter, r *http.Request) {
	var body dbSchemaBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Schema == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	ctx := context.Background()

	var err error
	switch body.Engine {
	case "postgres":
		// Idempotent CREATE DATABASE, split into two argv-only psql calls (no
		// shell pipe/`||`): first check existence, then create if absent.
		pgEnv := dbPasswordEnv("postgres", body.Password)
		var out string
		out, err = s.docker.ExecEnv(ctx, body.Container, pgEnv,
			"psql", "-U", body.User, "-d", "postgres", "-tAc",
			fmt.Sprintf("SELECT 1 FROM pg_database WHERE datname='%s'", body.Schema))
		if err == nil && strings.TrimSpace(out) == "" {
			_, err = s.docker.ExecEnv(ctx, body.Container, pgEnv,
				"psql", "-U", body.User, "-d", "postgres", "-c",
				fmt.Sprintf(`CREATE DATABASE "%s"`, body.Schema))
		}
	case "mysql":
		// Call mysql directly (no shell) so backtick identifier quoting is not
		// interpreted as shell command substitution; password via MYSQL_PWD.
		stmt := fmt.Sprintf(
			"CREATE DATABASE IF NOT EXISTS `%s`; GRANT ALL ON `%s`.* TO '%s'@'%%';",
			body.Schema, body.Schema, body.User,
		)
		_, err = s.docker.ExecEnv(ctx, body.Container,
			dbPasswordEnv("mysql", body.Password),
			"mysql", "-uroot", "-e", stmt)
	default:
		http.Error(w, "bad engine", http.StatusBadRequest)
		return
	}

	if err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

type dbGrantBody struct {
	Container string `json:"container"`
	Engine    string `json:"engine"`
	User      string `json:"user"`
	Password  string `json:"password"` // root password (equals the app user's)
}

// handleDBGrant elevates the app user so it can create and manage additional
// schemas at runtime (multi-tenant apps that CREATE DATABASE per tenant). Each
// managed container is dedicated to a single service, so a container-wide grant
// is safe. Idempotent.
func (s *Server) handleDBGrant(w http.ResponseWriter, r *http.Request) {
	var body dbGrantBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.User == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	ctx := context.Background()

	var err error
	switch body.Engine {
	case "postgres":
		// The primary POSTGRES_USER is already a superuser; ensure CREATEDB.
		stmt := fmt.Sprintf(`ALTER ROLE "%s" CREATEDB`, body.User)
		_, err = s.docker.Exec(ctx, body.Container,
			"psql", "-U", body.User, "-d", "postgres", "-c", stmt)
	case "mysql":
		stmt := fmt.Sprintf(
			"GRANT ALL PRIVILEGES ON *.* TO '%s'@'%%' WITH GRANT OPTION; FLUSH PRIVILEGES;",
			body.User,
		)
		_, err = s.docker.ExecEnv(ctx, body.Container,
			dbPasswordEnv("mysql", body.Password),
			"mysql", "-uroot", "-e", stmt)
	default:
		http.Error(w, "bad engine", http.StatusBadRequest)
		return
	}

	if err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

type volumeRemoveBody struct {
	Name string `json:"name"`
}

func (s *Server) handleVolumeRemove(w http.ResponseWriter, r *http.Request) {
	var body volumeRemoveBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	// Best-effort: fails (and is ignored) if the volume is still in use.
	err := s.docker.RemoveVolume(context.Background(), body.Name)
	writeJSON(w, map[string]any{"ok": err == nil})
}

type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }
