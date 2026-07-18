package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/self-hosted/agent/internal/builder"
	"github.com/self-hosted/agent/internal/certs"
	"github.com/self-hosted/agent/internal/config"
	"github.com/self-hosted/agent/internal/docker"
)

// tokenState holds the shared daemon secret(s) the agent authenticates requests
// against. During a rotation it accepts BOTH the current and the pending "next"
// secret; the first request that authenticates with `next` proves the control
// plane has switched over, so `next` is promoted to current and the old secret
// is dropped. `persist` writes the state through to disk (nil for the dev agent).
type tokenState struct {
	mu      sync.Mutex
	current string
	next    string
	nodeID  string
	persist func(current, next string) error
}

func (t *tokenState) snapshot() (current, next, nodeID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.current, t.next, t.nodeID
}

// observe promotes the pending secret once the control plane starts using it,
// closing the rotation window so the old secret no longer authenticates.
func (t *tokenState) observe(matched string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.next != "" && matched == t.next {
		t.current = t.next
		t.next = ""
		if t.persist != nil {
			_ = t.persist(t.current, t.next)
		}
	}
}

// setNext stages a new secret received from the control plane. The agent keeps
// accepting the current secret until the panel confirms the new one (observe).
func (t *tokenState) setNext(newToken string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if newToken == "" || newToken == t.current {
		return
	}
	t.next = newToken
	if t.persist != nil {
		_ = t.persist(t.current, t.next)
	}
}

func (t *tokenState) currentToken() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.current
}

type Server struct {
	cfg     config.Config
	docker  *docker.Client
	builder *builder.Builder
	certs   *certs.Manager
	mux     *http.ServeMux
	tokens  *tokenState

	// buildSem caps concurrent builds; buildTimeout/inspectTimeout bound their
	// runtime. Set from config with safe fallbacks so a bare Config still works.
	buildSem       chan struct{}
	buildTimeout   time.Duration
	inspectTimeout time.Duration
}

func NewServer(cfg config.Config) *Server {
	d := docker.New()

	maxBuilds := cfg.MaxConcurrentBuilds
	if maxBuilds < 1 {
		maxBuilds = 2
	}
	buildTimeout := cfg.BuildTimeout
	if buildTimeout <= 0 {
		buildTimeout = 20 * time.Minute
	}
	inspectTimeout := cfg.InspectTimeout
	if inspectTimeout <= 0 {
		inspectTimeout = 2 * time.Minute
	}

	s := &Server{
		cfg:            cfg,
		docker:         d,
		builder:        builder.New(d, cfg.WorkDir),
		certs:          certs.New(cfg.TraefikCertsDir, cfg.TraefikDynamicDir),
		mux:            http.NewServeMux(),
		tokens:         &tokenState{current: cfg.DaemonToken, nodeID: cfg.NodeID},
		buildSem:       make(chan struct{}, maxBuilds),
		buildTimeout:   buildTimeout,
		inspectTimeout: inspectTimeout,
	}
	s.routes()
	return s
}

// Configure wires the agent's identity (node id, for audience checks), a
// pending rotation secret loaded from persisted state, and a persist callback.
// Called once at startup by an enrolled agent; the dev agent leaves persist nil.
func (s *Server) Configure(nodeID, next string, persist func(current, next string) error) {
	s.tokens.mu.Lock()
	defer s.tokens.mu.Unlock()
	if nodeID != "" {
		s.tokens.nodeID = nodeID
	}
	s.tokens.next = next
	s.tokens.persist = persist
}

// CurrentToken returns the secret the agent currently authenticates with. Used
// by the heartbeat loop so, after a rotation converges, heartbeats present the
// new secret and the panel can retire the old one.
func (s *Server) CurrentToken() string { return s.tokens.currentToken() }

func (s *Server) Run() error {
	addr := fmt.Sprintf(":%d", s.cfg.Port)
	return http.ListenAndServe(addr, s.auth(s.mux))
}

// RunTLS serves over HTTPS using the agent's persistent self-signed cert. The
// control plane trusts it via a pinned fingerprint captured at enrollment.
func (s *Server) RunTLS(certPath, keyPath string) error {
	addr := fmt.Sprintf(":%d", s.cfg.Port)
	return http.ListenAndServeTLS(addr, certPath, keyPath, s.auth(s.mux))
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/version", s.handleVersion)
	s.mux.HandleFunc("GET /api/system", s.handleSystem)
	s.mux.HandleFunc("GET /api/host", s.handleHost)
	s.mux.HandleFunc("GET /api/stats", s.handleNodeStats)
	s.mux.HandleFunc("POST /api/system/prune", s.handlePrune)
	s.mux.HandleFunc("POST /api/servers/{uuid}/build", s.handleBuild)
	s.mux.HandleFunc("POST /api/inspect", s.handleInspect)
	s.mux.HandleFunc("POST /api/servers/{uuid}/run", s.handleRun)
	s.mux.HandleFunc("POST /api/servers/{uuid}/run-image", s.handleRunImage)
	s.mux.HandleFunc("POST /api/servers/{uuid}/compose", s.handleComposeUp)
	s.mux.HandleFunc("POST /api/servers/{uuid}/compose/down", s.handleComposeDown)
	s.mux.HandleFunc("POST /api/servers/{uuid}/compose/power", s.handleComposePower)
	s.mux.HandleFunc("POST /api/servers/{uuid}/health", s.handleHealth)
	s.mux.HandleFunc("POST /api/servers/{uuid}/promote", s.handlePromote)
	s.mux.HandleFunc("POST /api/servers/{uuid}/power", s.handlePower)
	s.mux.HandleFunc("DELETE /api/servers/{uuid}", s.handleRemove)
	s.mux.HandleFunc("GET /api/servers/{uuid}/logs", s.handleLogs)
	s.mux.HandleFunc("GET /api/servers/{uuid}/stats", s.handleStats)
	s.mux.HandleFunc("POST /api/servers/{uuid}/gc", s.handleGC)
	s.mux.HandleFunc("GET /api/servers/{uuid}/exec", s.handleExec)
	s.mux.HandleFunc("POST /api/servers/{uuid}/exec-cmd", s.handleExecCmd)
	s.mux.HandleFunc("POST /api/databases", s.handleDBCreate)
	s.mux.HandleFunc("POST /api/databases/power", s.handleDBPower)
	s.mux.HandleFunc("POST /api/databases/status", s.handleDBStatus)
	s.mux.HandleFunc("DELETE /api/databases", s.handleDBRemove)
	s.mux.HandleFunc("POST /api/databases/schema", s.handleDBSchema)
	s.mux.HandleFunc("POST /api/databases/grant", s.handleDBGrant)
	s.mux.HandleFunc("DELETE /api/volumes", s.handleVolumeRemove)
	s.mux.HandleFunc("POST /api/backups", s.handleBackupCreate)
	s.mux.HandleFunc("POST /api/backups/restore", s.handleBackupRestore)
	s.mux.HandleFunc("GET /api/backups/download", s.handleBackupDownload)
	s.mux.HandleFunc("DELETE /api/backups", s.handleBackupDelete)
	s.mux.HandleFunc("POST /api/rotate", s.handleRotate)
	s.mux.HandleFunc("PUT /api/certs", s.handleCertPut)
	s.mux.HandleFunc("DELETE /api/certs", s.handleCertDelete)
	s.mux.HandleFunc("GET /api/certs", s.handleCertList)
}

// auth authenticates a CP->agent request. It accepts a short-lived HS256 request
// token signed with the node's shared secret (preferred) OR the raw static
// secret (constant-time compare, for already-enrolled agents and the control
// plane's legacy fallback). Both the current and, during a rotation, the pending
// "next" secret are accepted; using the next secret promotes it and closes the
// rotation window.
func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		matched, ok := s.authenticate(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		s.tokens.observe(matched)
		next.ServeHTTP(w, r)
	})
}

// authenticate returns the shared secret the request authenticated against (so
// the caller can detect a rotation switch-over) and whether it was authorized.
func (s *Server) authenticate(r *http.Request) (matched string, ok bool) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" {
		return "", false
	}
	current, nextSecret, nodeID := s.tokens.snapshot()
	now := time.Now()
	for _, secret := range []string{current, nextSecret} {
		if tokenMatches(token, secret, nodeID, now) {
			return secret, true
		}
	}
	return "", false
}

type rotateBody struct {
	NewToken string `json:"newToken"`
}

// handleRotate stages a new daemon secret pushed by the control plane. The
// request is already authenticated (with the current or pending secret) by the
// auth middleware; the agent now accepts the new secret too until the panel
// switches over. Persisted so the agent survives a restart mid-rotation.
func (s *Server) handleRotate(w http.ResponseWriter, r *http.Request) {
	var body rotateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
		strings.TrimSpace(body.NewToken) == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	s.tokens.setNext(strings.TrimSpace(body.NewToken))
	writeJSON(w, map[string]any{"ok": true, "rotated": true})
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]any{"version": config.Version})
}

func (s *Server) handleSystem(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	resp := map[string]any{"version": config.Version}

	if running, err := s.docker.Ps(ctx, false); err == nil {
		resp["containersRunning"] = countLines(running)
	}
	if all, err := s.docker.Ps(ctx, true); err == nil {
		resp["containersTotal"] = countLines(all)
	}

	// docker system df: one JSON object per resource type (Images, Containers, …).
	if df, err := s.docker.SystemDf(ctx); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(df), "\n") {
			if strings.TrimSpace(line) == "" {
				continue
			}
			var row map[string]string
			if json.Unmarshal([]byte(line), &row) != nil {
				continue
			}
			switch row["Type"] {
			case "Images":
				resp["imagesCount"] = row["TotalCount"]
				resp["imagesSize"] = row["Size"]
				resp["imagesReclaimable"] = row["Reclaimable"]
			case "Local Volumes":
				resp["volumesSize"] = row["Size"]
			case "Build Cache":
				resp["buildCacheSize"] = row["Size"]
			}
		}
	}
	writeJSON(w, resp)
}

// handleNodeStats aggregates live CPU/RAM usage across all running containers
// on the node. cpuPerc is in Docker units (100 = one core); memUsageMb is the
// total used memory in MB. Used to show real consumption next to node capacity.
func (s *Server) handleNodeStats(w http.ResponseWriter, r *http.Request) {
	out, err := s.docker.StatsAll(r.Context())
	if err != nil {
		writeJSON(w, map[string]any{"reachable": true, "cpuPerc": 0, "memUsageMb": 0, "containers": 0})
		return
	}
	var cpu, memMb float64
	count := 0
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var row struct {
			CPUPerc  string `json:"CPUPerc"`
			MemUsage string `json:"MemUsage"`
		}
		if json.Unmarshal([]byte(line), &row) != nil {
			continue
		}
		cpu += parseStatsPercent(row.CPUPerc)
		memMb += parseStatsMemMb(row.MemUsage)
		count++
	}
	writeJSON(w, map[string]any{
		"reachable":  true,
		"cpuPerc":    round2(cpu),
		"memUsageMb": round2(memMb),
		"containers": count,
	})
}

// parseStatsPercent parses "12.34%" -> 12.34.
func parseStatsPercent(v string) float64 {
	v = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(v), "%"))
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0
	}
	return f
}

// parseStatsMemMb parses the used side of "124MiB / 1.945GiB" into MB.
func parseStatsMemMb(v string) float64 {
	used := strings.TrimSpace(strings.Split(v, "/")[0])
	if used == "" {
		return 0
	}
	lower := strings.ToLower(used)
	var mult float64 = 1.0 / (1024 * 1024) // default: bytes
	switch {
	case strings.HasSuffix(lower, "gib"):
		mult = 1024
		lower = strings.TrimSuffix(lower, "gib")
	case strings.HasSuffix(lower, "mib"):
		mult = 1
		lower = strings.TrimSuffix(lower, "mib")
	case strings.HasSuffix(lower, "kib"):
		mult = 1.0 / 1024
		lower = strings.TrimSuffix(lower, "kib")
	case strings.HasSuffix(lower, "gb"):
		mult = 1000
		lower = strings.TrimSuffix(lower, "gb")
	case strings.HasSuffix(lower, "mb"):
		mult = 1
		lower = strings.TrimSuffix(lower, "mb")
	case strings.HasSuffix(lower, "kb"):
		mult = 1.0 / 1000
		lower = strings.TrimSuffix(lower, "kb")
	case strings.HasSuffix(lower, "b"):
		mult = 1.0 / (1024 * 1024)
		lower = strings.TrimSuffix(lower, "b")
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(lower), 64)
	if err != nil {
		return 0
	}
	return f * mult
}

func round2(f float64) float64 {
	return float64(int64(f*100+0.5)) / 100
}

// handlePrune reclaims disk on the node: stopped containers, unused networks,
// dangling images and build cache (docker system prune). Optionally removes all
// unused images (all=true) and unused volumes (volumes=true, destructive).
// Returns the "Total reclaimed space" summary of each step plus the fresh
// reclaimable figure from `docker system df`.
func (s *Server) handlePrune(w http.ResponseWriter, r *http.Request) {
	var body struct {
		All     bool `json:"all"`
		Volumes bool `json:"volumes"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	ctx := r.Context()

	resp := map[string]any{"ok": true}
	if out, err := s.docker.SystemPrune(ctx, body.All); err == nil {
		resp["system"] = reclaimedSpace(out)
	} else {
		resp["ok"] = false
		resp["error"] = err.Error()
	}
	if out, err := s.docker.BuilderPrune(ctx); err == nil {
		resp["builder"] = reclaimedSpace(out)
	}
	if body.Volumes {
		if out, err := s.docker.VolumePrune(ctx); err == nil {
			resp["volumes"] = reclaimedSpace(out)
		}
	}

	// Report the remaining reclaimable image space so the UI can refresh.
	if df, err := s.docker.SystemDf(ctx); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(df), "\n") {
			if strings.TrimSpace(line) == "" {
				continue
			}
			var row map[string]string
			if json.Unmarshal([]byte(line), &row) != nil {
				continue
			}
			if row["Type"] == "Images" {
				resp["imagesReclaimable"] = row["Reclaimable"]
			}
		}
	}
	writeJSON(w, resp)
}

// reclaimedSpace extracts the human-readable size from a prune command's
// output (e.g. "Total reclaimed space: 1.5GB" -> "1.5GB"). Falls back to "0B".
func reclaimedSpace(out string) string {
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		lower := strings.ToLower(line)
		if strings.Contains(lower, "reclaimed space:") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				return strings.TrimSpace(parts[1])
			}
		}
	}
	return "0B"
}

// handleGC removes stale images of a service, keeping the currently used one.
func (s *Server) handleGC(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	var body struct {
		KeepImage string `json:"keepImage"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	// Image repo is "svc-" + first 8 chars of the service id (see control plane).
	short := uuid
	if len(short) > 8 {
		short = short[:8]
	}
	repo := "svc-" + short

	out, err := s.docker.ImagesByRepo(r.Context(), repo)
	if err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	removed := 0
	for _, ref := range strings.Split(strings.TrimSpace(out), "\n") {
		ref = strings.TrimSpace(ref)
		if ref == "" || ref == body.KeepImage || strings.HasSuffix(ref, ":<none>") {
			continue
		}
		if s.docker.RemoveImage(r.Context(), ref) == nil {
			removed++
		}
	}
	writeJSON(w, map[string]any{"ok": true, "removed": removed})
}

func countLines(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	return len(strings.Split(s, "\n"))
}

type buildBody struct {
	RepoURL           string `json:"repoUrl"`
	Branch            string `json:"branch"`
	PATToken          string `json:"patToken"`
	BuildImage        string `json:"buildImage"`
	RunImage          string `json:"runImage"`
	Dockerfile        string `json:"dockerfile"`
	UseRepoDockerfile bool   `json:"useRepoDockerfile"`
	BuildMode         string `json:"buildMode"`
	BuildScript       string `json:"buildScript"`
	ImageTag          string `json:"imageTag"`
}

func (s *Server) handleBuild(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	var body buildBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	// Stream build logs back to the caller as they happen.
	flusher, _ := w.(http.Flusher)
	w.Header().Set("Content-Type", "application/x-ndjson")

	// Concurrency cap: wait for a build slot, but bail out if the client goes
	// away first so a disconnected deploy can't hold a slot hostage.
	select {
	case s.buildSem <- struct{}{}:
		defer func() { <-s.buildSem }()
	case <-r.Context().Done():
		writeJSON(w, map[string]any{"error": "build cancelled while queued"})
		return
	}

	// Cancel on client disconnect (r.Context) and hard-cap the total runtime.
	ctx, cancel := context.WithTimeout(r.Context(), s.buildTimeout)
	defer cancel()

	sha, err := s.builder.Build(ctx, builder.BuildRequest{
		ServiceID:         uuid,
		RepoURL:           body.RepoURL,
		Branch:            body.Branch,
		PATToken:          body.PATToken,
		BuildImage:        body.BuildImage,
		RunImage:          body.RunImage,
		Dockerfile:        body.Dockerfile,
		UseRepoDockerfile: body.UseRepoDockerfile,
		BuildMode:         body.BuildMode,
		ImageTag:          body.ImageTag,
	}, &flushWriter{w: w, f: flusher})
	if err != nil {
		writeJSON(w, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"commitSha": sha})
}

type inspectBody struct {
	RepoURL  string `json:"repoUrl"`
	Branch   string `json:"branch"`
	PATToken string `json:"patToken"`
	WorkID   string `json:"workId"`
}

func (s *Server) handleInspect(w http.ResponseWriter, r *http.Request) {
	var body inspectBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	// Cancel on client disconnect and hard-cap the inspect (shallow clone + scan).
	ctx, cancel := context.WithTimeout(r.Context(), s.inspectTimeout)
	defer cancel()

	res, err := s.builder.Inspect(ctx, builder.InspectRequest{
		WorkID:   body.WorkID,
		RepoURL:  body.RepoURL,
		Branch:   body.Branch,
		PATToken: body.PATToken,
	})
	if err != nil {
		writeJSON(w, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

type volumeMount struct {
	Name      string `json:"name"`
	MountPath string `json:"mountPath"`
}

type runBody struct {
	Image    string            `json:"image"`
	Port     int               `json:"port"`
	CPULimit int               `json:"cpuLimit"`
	MemLimit int               `json:"memLimit"`
	Env      map[string]string `json:"env"`
	Domain   string            `json:"domain"`
	HTTPS    bool              `json:"https"`
	// CustomTLS skips ACME certresolver and relies on Traefik file-provider certs.
	CustomTLS bool `json:"customTls"`
	Network   string         `json:"network"`
	Volumes   []volumeMount  `json:"volumes"`
	// Color ('blue'|'green') runs the container as svc-<uuid>-<color> for
	// blue-green deploys; empty keeps the legacy single-container name.
	Color string `json:"color"`
	// HealthPath, when set, adds a Traefik load-balancer healthcheck so the
	// proxy never routes to a backend that is still starting.
	HealthPath string `json:"healthPath"`
}

func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	var body runBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	network := body.Network
	if network == "" {
		network = s.cfg.Network
	}

	// Dev: publish the port to the host so the app is reachable at
	// localhost:<port> without Traefik. Disabled by default.
	publishPort := 0
	if os.Getenv("AGENT_PUBLISH_PORTS") == "1" {
		publishPort = body.Port
	}

	mounts := make([]docker.VolumeMount, 0, len(body.Volumes))
	for _, v := range body.Volumes {
		mounts = append(mounts, docker.VolumeMount{Name: v.Name, MountPath: v.MountPath})
	}

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
		ReadOnlyRootfs: true, // H7: app containers get read-only rootfs + /tmp tmpfs
	}

	// Capture progress so the HTTP response stays valid JSON.
	var progress bytes.Buffer
	id, err := s.docker.RunContainer(context.Background(), opts, &progress)
	if err != nil {
		writeJSON(w, map[string]any{
			"ok":    false,
			"error": err.Error(),
			"log":   progress.String(),
		})
		return
	}
	writeJSON(w, map[string]any{"ok": true, "containerId": id})
}

// traefikLabels wires a service container into the Traefik reverse proxy.
// Returns no labels when no domain is attached (internal-only service).
// The router/service name is color-agnostic (svc-<uuid>) so both blue and green
// containers register as two servers of one Traefik service — enabling a smooth
// overlap during blue-green switchover. When healthPath is set, a load-balancer
// healthcheck keeps Traefik from routing to a backend that is still starting.
// When customTLS is true, ACME is skipped and Traefik uses file-provider certs.
func traefikLabels(uuid, domain string, port int, https bool, healthPath string, customTLS bool) []string {
	if domain == "" {
		return nil
	}
	router := "svc-" + uuid
	labels := []string{
		"traefik.enable=true",
		fmt.Sprintf("traefik.http.routers.%s.rule=%s", router, traefikHostRule(domain)),
		fmt.Sprintf("traefik.http.services.%s.loadbalancer.server.port=%d", router, port),
	}
	if healthPath != "" {
		labels = append(labels,
			fmt.Sprintf("traefik.http.services.%s.loadbalancer.healthcheck.path=%s", router, healthPath),
			fmt.Sprintf("traefik.http.services.%s.loadbalancer.healthcheck.interval=3s", router),
			fmt.Sprintf("traefik.http.services.%s.loadbalancer.healthcheck.timeout=3s", router),
		)
	}
	if https {
		labels = append(labels,
			fmt.Sprintf("traefik.http.routers.%s.entrypoints=websecure", router),
			fmt.Sprintf("traefik.http.routers.%s.tls=true", router),
		)
		if !customTLS {
			resolver := acmeCertResolver()
			labels = append(labels,
				fmt.Sprintf("traefik.http.routers.%s.tls.certresolver=%s", router, resolver),
			)
			// DNS-01: one wildcard cert covers apex + all tenant subdomains.
			if acmeWildcardEnabled() {
				labels = append(labels,
					fmt.Sprintf("traefik.http.routers.%s.tls.domains[0].main=%s", router, domain),
					fmt.Sprintf("traefik.http.routers.%s.tls.domains[0].sans=*.%s", router, domain),
				)
			}
		}
	} else {
		labels = append(labels, fmt.Sprintf("traefik.http.routers.%s.entrypoints=web", router))
	}
	return labels
}

// acmeCertResolver picks the Traefik certificates resolver name. Default is
// HTTP-01 (letsencrypt). Set ACME_WILDCARD_CERTS=1 or ACME_CERT_RESOLVER to
// use DNS-01 wildcard certs (*.domain + domain).
func acmeCertResolver() string {
	if r := strings.TrimSpace(os.Getenv("ACME_CERT_RESOLVER")); r != "" {
		return r
	}
	if acmeWildcardEnabled() {
		return "letsencrypt-dns"
	}
	return "letsencrypt"
}

func acmeWildcardEnabled() bool {
	if os.Getenv("ACME_WILDCARD_CERTS") == "1" {
		return true
	}
	return strings.TrimSpace(os.Getenv("ACME_CERT_RESOLVER")) == "letsencrypt-dns"
}

// traefikHostRule matches exactly one hostname. Domains are FQDN-validated by
// the control plane before deploy; previews also get a concrete host, so a
// HostRegexp subdomain wildcard is unnecessary and would over-match (H9).
func traefikHostRule(domain string) string {
	return fmt.Sprintf("Host(`%s`)", domain)
}

func (s *Server) handleRemove(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	// Optional ?color=blue|green removes a single color instance (blue-green
	// cleanup); without it, all instances of the service are removed.
	color := r.URL.Query().Get("color")
	ctx := context.Background()
	if color != "" {
		if err := s.docker.Remove(ctx, coloredName(uuid, color)); err != nil {
			writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	for _, name := range serviceContainers(uuid) {
		_ = s.docker.Remove(ctx, name)
	}
	writeJSON(w, map[string]any{"ok": true})
}

type healthBody struct {
	Color    string `json:"color"`
	Port     int    `json:"port"`
	Path     string `json:"path"`
	Network  string `json:"network"`
	TimeoutS int    `json:"timeoutS"`
}

// handleHealth performs a single HTTP probe against a color instance from inside
// the Docker network. The control plane polls this endpoint to health-gate a
// blue-green switchover.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	var body healthBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	network := body.Network
	if network == "" {
		network = s.cfg.Network
	}
	path := body.Path
	if path == "" {
		path = "/"
	}
	target := fmt.Sprintf("%s:%d", coloredName(uuid, body.Color), body.Port)
	code, err := s.docker.HTTPProbe(r.Context(), network, target, path, body.TimeoutS)
	healthy := err == nil && code >= 200 && code < 400
	resp := map[string]any{"ok": true, "healthy": healthy, "code": code}
	if err != nil {
		resp["error"] = err.Error()
	}
	writeJSON(w, resp)
}

type promoteBody struct {
	KeepColor string `json:"keepColor"`
}

// handlePromote retires every instance of the service except the kept color
// (the freshly health-checked one), completing a blue-green switchover.
func (s *Server) handlePromote(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	var body promoteBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	keep := coloredName(uuid, body.KeepColor)
	ctx := context.Background()
	for _, name := range serviceContainers(uuid) {
		if name == keep {
			continue
		}
		_ = s.docker.Remove(ctx, name)
	}
	writeJSON(w, map[string]any{"ok": true})
}

type powerBody struct {
	Action string `json:"action"`
}

func (s *Server) handlePower(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	var body powerBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	name := s.resolveContainer(context.Background(), uuid)
	if err := s.docker.Power(context.Background(), name, body.Action); err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	flusher, _ := w.(http.Flusher)
	name := s.resolveContainer(r.Context(), uuid)
	_ = s.docker.Logs(r.Context(), name, &flushWriter{w: w, f: flusher})
}

// handleStats returns a live resource + health snapshot for a service container.
func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	ctx := r.Context()
	name := s.resolveContainer(ctx, uuid)

	state, err := s.docker.Inspect(ctx, name, "{{.State.Status}}")
	if err != nil || state == "" {
		writeJSON(w, map[string]any{"running": false, "state": "missing"})
		return
	}
	health, _ := s.docker.Inspect(ctx, name,
		"{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}")

	resp := map[string]any{
		"running": state == "running",
		"state":   state,
		"health":  strings.TrimSpace(health),
	}

	if state == "running" {
		if raw, err := s.docker.Stats(ctx, name); err == nil && raw != "" {
			var stat map[string]string
			if json.Unmarshal([]byte(raw), &stat) == nil {
				resp["cpuPerc"] = stat["CPUPerc"]
				resp["memUsage"] = stat["MemUsage"]
				resp["memPerc"] = stat["MemPerc"]
				resp["netIO"] = stat["NetIO"]
				resp["blockIO"] = stat["BlockIO"]
				resp["pids"] = stat["PIDs"]
			}
		}
	}
	writeJSON(w, resp)
}

func containerName(uuid string) string { return "svc-" + uuid }

// coloredName is the container name for a blue-green color; an empty color maps
// to the legacy single-container name.
func coloredName(uuid, color string) string {
	if color == "" {
		return containerName(uuid)
	}
	return "svc-" + uuid + "-" + color
}

// serviceContainers lists every possible container name for a service (legacy +
// both colors), used for cleanup/promotion.
func serviceContainers(uuid string) []string {
	return []string{
		containerName(uuid),
		coloredName(uuid, "blue"),
		coloredName(uuid, "green"),
	}
}

// resolveContainer picks the live container name for a service: prefer a running
// instance, else any that exists, else the legacy name. Lets stats/logs/power/
// exec work regardless of blue-green color without the caller knowing it.
func (s *Server) resolveContainer(ctx context.Context, uuid string) string {
	existing := ""
	for _, name := range serviceContainers(uuid) {
		state, err := s.docker.Inspect(ctx, name, "{{.State.Running}}")
		if err != nil {
			continue
		}
		if strings.TrimSpace(state) == "true" {
			return name
		}
		if existing == "" {
			existing = name
		}
	}
	if existing != "" {
		return existing
	}
	return containerName(uuid)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

type flushWriter struct {
	w http.ResponseWriter
	f http.Flusher
}

func (fw *flushWriter) Write(p []byte) (int, error) {
	n, err := fw.w.Write(p)
	if fw.f != nil {
		fw.f.Flush()
	}
	return n, err
}
