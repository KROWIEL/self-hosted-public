package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/self-hosted/agent/internal/builder"
	"github.com/self-hosted/agent/internal/compose"
	"github.com/self-hosted/agent/internal/docker"
)

// composeProjectName derives a stable docker compose project name from a
// service UUID (lowercase alnum only).
func composeProjectName(uuid string) string {
	return "c" + strings.ReplaceAll(strings.ToLower(uuid), "-", "")
}

type composeUpBody struct {
	RepoURL     string            `json:"repoUrl"`
	Branch      string            `json:"branch"`
	ComposeFile string            `json:"composeFile"`
	ComposeYAML string            `json:"composeYaml"`
	PATToken    string            `json:"patToken"`
	Env         map[string]string `json:"env"`
	ProjectName string            `json:"projectName"`
	Domain      string            `json:"domain"`
	HTTPS       bool              `json:"https"`
}

func (s *Server) handleComposeUp(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	var body composeUpBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	projectName := body.ProjectName
	if projectName == "" {
		projectName = composeProjectName(uuid)
	}
	if err := compose.ValidateProjectName(projectName); err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if _, err := compose.ValidateComposeFilePath(body.ComposeFile); err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}

	flusher, _ := w.(http.Flusher)
	w.Header().Set("Content-Type", "application/x-ndjson")

	select {
	case s.buildSem <- struct{}{}:
		defer func() { <-s.buildSem }()
	case <-r.Context().Done():
		writeJSON(w, map[string]any{"error": "compose cancelled while queued"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.buildTimeout)
	defer cancel()

	out := &flushWriter{w: w, f: flusher}
	workDir, composeFile, err := s.builder.PrepareCompose(ctx, builder.ComposePrepareRequest{
		ServiceID:   uuid,
		RepoURL:     body.RepoURL,
		Branch:      body.Branch,
		PATToken:    body.PATToken,
		ComposeFile: body.ComposeFile,
		ComposeYAML: body.ComposeYAML,
	}, out)
	if err != nil {
		writeJSON(w, map[string]any{"error": err.Error()})
		return
	}
	// Keep the compose workdir so subsequent stop/start can find the files when
	// needed; down does not require the file. Clean previous sibling dirs only.

	env := body.Env
	if env == nil {
		env = map[string]string{}
	}
	if body.Domain != "" {
		env["SELFHOSTED_DOMAIN"] = body.Domain
		if body.HTTPS {
			env["SELFHOSTED_HTTPS"] = "1"
		}
	}
	if s.cfg.Network != "" {
		env["SELFHOSTED_NETWORK"] = s.cfg.Network
	}

	runner := compose.NewRunner()
	if err := runner.Up(ctx, compose.UpRequest{
		ProjectName: projectName,
		WorkDir:     workDir,
		ComposeFile: composeFile,
		Env:         env,
		Network:     s.cfg.Network,
	}, out); err != nil {
		writeJSON(w, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{
		"ok":          true,
		"projectName": projectName,
		"commitSha":   "",
	})
}

type composeDownBody struct {
	ProjectName   string `json:"projectName"`
	RemoveVolumes bool   `json:"removeVolumes"`
}

func (s *Server) handleComposeDown(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	var body composeDownBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	projectName := body.ProjectName
	if projectName == "" {
		projectName = composeProjectName(uuid)
	}
	var buf bytes.Buffer
	runner := compose.NewRunner()
	if err := runner.Down(context.Background(), projectName, body.RemoveVolumes, &buf); err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error(), "log": buf.String()})
		return
	}
	// Best-effort cleanup of the prepare workdir.
	_ = os.RemoveAll(filepath.Join(s.cfg.WorkDir, "compose-"+uuid))
	writeJSON(w, map[string]any{"ok": true})
}

type composePowerBody struct {
	ProjectName string `json:"projectName"`
	Action      string `json:"action"`
}

func (s *Server) handleComposePower(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	var body composePowerBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	projectName := body.ProjectName
	if projectName == "" {
		projectName = composeProjectName(uuid)
	}
	var buf bytes.Buffer
	runner := compose.NewRunner()
	if err := runner.Power(context.Background(), projectName, body.Action, &buf); err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error(), "log": buf.String()})
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

// handleRunImage pulls (via docker run) and starts a pre-built image with the
// same Traefik labels / volume mounts as handleRun — no git build step.
func (s *Server) handleRunImage(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	var body runBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(body.Image) == "" {
		http.Error(w, "image required", http.StatusBadRequest)
		return
	}

	network := body.Network
	if network == "" {
		network = s.cfg.Network
	}
	publishPort := 0
	if os.Getenv("AGENT_PUBLISH_PORTS") == "1" {
		publishPort = body.Port
	}
	mounts := make([]docker.VolumeMount, 0, len(body.Volumes))
	for _, v := range body.Volumes {
		mounts = append(mounts, docker.VolumeMount{Name: v.Name, MountPath: v.MountPath})
	}

	// Pull first so progress is visible; RunContainer also pulls implicitly.
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	var progress bytes.Buffer
	fmt.Fprintf(&progress, ">> pulling image %s\n", body.Image)
	_ = s.docker.PullImage(ctx, body.Image, &progress)

	name := coloredName(uuid, body.Color)
	opts := docker.RunOptions{
		Name:           name,
		Image:          body.Image,
		Network:        network,
		MemLimitMb:     body.MemLimit,
		CPULimit:       body.CPULimit,
		PublishPort:    publishPort,
		Env:            body.Env,
		Labels:         traefikLabels(uuid, body.Domain, body.Port, body.HTTPS, body.HealthPath, body.CustomTLS),
		Volumes:        mounts,
		ReadOnlyRootfs: true,
	}
	id, err := s.docker.RunContainer(ctx, opts, &progress)
	if err != nil {
		writeJSON(w, map[string]any{
			"ok":    false,
			"error": err.Error(),
			"log":   progress.String(),
		})
		return
	}
	writeJSON(w, map[string]any{"ok": true, "containerId": id, "log": progress.String()})
}
