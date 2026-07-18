package docker

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
)

// volumeNameRe matches safe Docker named-volume identifiers. It rejects any
// value containing '/' or ':' (and other shell/path metacharacters), so a
// caller can't turn a "-v name:path" mount into a host bind-mount such as
// "/etc:/etc" or "/var/run/docker.sock:...". Must start alphanumeric.
var volumeNameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]+$`)

// ValidVolumeName reports whether name is a safe Docker named-volume identifier.
func ValidVolumeName(name string) bool {
	return volumeNameRe.MatchString(name)
}

// Client wraps Docker operations via the docker CLI.
// MVP choice: shelling out keeps the agent dependency-free and readable.
// Can be swapped for the Docker SDK later without changing callers.
type Client struct{}

func New() *Client { return &Client{} }

// BuildImage builds an image from a context dir using a specific Dockerfile,
// passing build-args to override base images. Build output streams to w.
func (c *Client) BuildImage(ctx context.Context, contextDir, dockerfile, tag string, buildArgs map[string]string, w io.Writer) error {
	args := []string{"build", "-t", tag, "-f", dockerfile}
	for k, v := range buildArgs {
		args = append(args, "--build-arg", fmt.Sprintf("%s=%s", k, v))
	}
	args = append(args, contextDir)
	return c.run(ctx, w, args...)
}

// PullImage fetches an image from a registry, streaming progress to w.
func (c *Client) PullImage(ctx context.Context, image string, w io.Writer) error {
	return c.run(ctx, w, "pull", image)
}

// Baseline container hardening applied to every managed run (services + managed
// databases). App containers additionally get a read-only rootfs + tmpfs for
// /tmp and /var/tmp (see RunOptions.ReadOnlyRootfs). Optional gVisor
// (--runtime=runsc) is off by default behind AGENT_GVISOR=1.
const (
	// defaultMemLimitMb caps memory when the caller provides no explicit limit,
	// so a container can't exhaust host RAM. It's generous enough for typical
	// apps (incl. small JVM services) while still bounding runaway usage.
	defaultMemLimitMb = 1024
	// defaultPidsLimit bounds the number of processes/threads per container.
	defaultPidsLimit = 1024
)

// hardenedCaps is the "drop ALL, add back common" Linux capability set. It keeps
// typical apps (chown/setuid at startup, binding <1024, etc.) working while
// removing capabilities they don't need.
var hardenedCaps = []string{
	"CHOWN", "DAC_OVERRIDE", "FOWNER", "FSETID", "SETGID", "SETUID",
	"SETPCAP", "NET_BIND_SERVICE", "KILL",
}

// gvisorAvailable caches whether the runsc runtime is registered with Docker.
// Checked at most once when AGENT_GVISOR=1; never fails the run if missing.
var (
	gvisorOnce      sync.Once
	gvisorRuntimeOK bool
)

// RunContainer (re)creates and starts a container for a service.
// Returns the new container ID.
func (c *Client) RunContainer(ctx context.Context, opts RunOptions, w io.Writer) (string, error) {
	_ = c.run(ctx, io.Discard, "rm", "-f", opts.Name)

	args, err := containerRunArgs(ctx, opts)
	if err != nil {
		return "", err
	}

	fmt.Fprintf(w, ">> starting container %s from %s\n", opts.Name, opts.Image)
	id, err := c.runCapture(ctx, w, args...)
	if err != nil {
		return "", err
	}
	return id, nil
}

// containerRunArgs builds the full `docker run …` argv (including "run" "-d")
// for the given options. Extracted so unit tests can assert hardening flags
// without talking to Docker.
func containerRunArgs(ctx context.Context, opts RunOptions) ([]string, error) {
	args := []string{"run", "-d", "--name", opts.Name, "--restart", "unless-stopped"}

	// Baseline hardening on every managed container.
	args = append(args, "--security-opt=no-new-privileges")
	args = append(args, "--pids-limit", fmt.Sprintf("%d", defaultPidsLimit))
	args = append(args, "--cap-drop=ALL")
	for _, capName := range hardenedCaps {
		args = append(args, "--cap-add", capName)
	}

	// Read-only rootfs for user app containers (not DB sidecars / builds). Writable
	// tmpfs mounts cover the paths most apps need for scratch files (H7).
	if opts.ReadOnlyRootfs {
		args = append(args, "--read-only")
		args = append(args, "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m")
		args = append(args, "--tmpfs", "/var/tmp:rw,nosuid,nodev,size=64m")
	}

	// Optional gVisor: only when explicitly enabled AND the runtime exists.
	if gvisorEnabled() && gvisorRuntimeAvailable(ctx) {
		args = append(args, "--runtime=runsc")
	}

	if opts.Network != "" {
		args = append(args, "--network", opts.Network)
	}
	// Dev convenience: publish the service port to the host so it can be
	// reached directly at localhost:<port> without a reverse proxy.
	if opts.PublishPort > 0 {
		args = append(args, "-p", fmt.Sprintf("%d:%d", opts.PublishPort, opts.PublishPort))
	}
	if opts.MemLimitMb > 0 {
		args = append(args, "--memory", fmt.Sprintf("%dm", opts.MemLimitMb))
	} else {
		args = append(args, "--memory", fmt.Sprintf("%dm", defaultMemLimitMb))
	}
	if opts.CPULimit > 0 {
		args = append(args, "--cpus", fmt.Sprintf("%.2f", float64(opts.CPULimit)/100.0))
	}
	for _, v := range opts.Volumes {
		if v.Name == "" || v.MountPath == "" {
			continue
		}
		if !ValidVolumeName(v.Name) {
			return nil, fmt.Errorf("invalid volume name %q", v.Name)
		}
		args = append(args, "-v", fmt.Sprintf("%s:%s", v.Name, v.MountPath))
	}
	for k, v := range opts.Env {
		args = append(args, "-e", fmt.Sprintf("%s=%s", k, v))
	}
	for _, l := range opts.Labels {
		args = append(args, "--label", l)
	}
	args = append(args, opts.Image)
	return args, nil
}

// gvisorEnabled reports whether the operator opted into the gVisor runtime.
func gvisorEnabled() bool {
	return os.Getenv("AGENT_GVISOR") == "1"
}

// gvisorRuntimeAvailable probes Docker once for the runsc runtime. Returns false
// (without failing the container start) when Docker is unreachable or runsc is
// not registered.
func gvisorRuntimeAvailable(ctx context.Context) bool {
	gvisorOnce.Do(func() {
		out, err := exec.CommandContext(ctx, "docker", "info", "--format", "{{json .Runtimes}}").Output()
		if err != nil {
			gvisorRuntimeOK = false
			return
		}
		gvisorRuntimeOK = strings.Contains(string(out), "runsc")
	})
	return gvisorRuntimeOK
}

// Remove force-removes a container (ignores "no such container").
func (c *Client) Remove(ctx context.Context, name string) error {
	return c.run(ctx, io.Discard, "rm", "-f", name)
}

// RemoveVolume removes a named volume (ignores "no such volume" via caller).
func (c *Client) RemoveVolume(ctx context.Context, name string) error {
	return c.run(ctx, io.Discard, "volume", "rm", "-f", name)
}

// Exec runs a one-shot command inside a container and returns trimmed stdout.
func (c *Client) Exec(ctx context.Context, name string, cmd ...string) (string, error) {
	args := append([]string{"exec", name}, cmd...)
	return c.runCapture(ctx, io.Discard, args...)
}

// ExecCapture runs a command inside a container, streaming stdout to out.
// Used for database dumps (`pg_dump | gzip` → file).
func (c *Client) ExecCapture(ctx context.Context, name string, out io.Writer, cmd ...string) error {
	args := append([]string{"exec", name}, cmd...)
	command := exec.CommandContext(ctx, "docker", args...)
	command.Stdout = out
	command.Stderr = io.Discard
	return command.Run()
}

// ExecStdin runs a command inside a container, feeding in to its stdin.
// Used for database restores (`gunzip | psql` ← file).
func (c *Client) ExecStdin(ctx context.Context, name string, in io.Reader, cmd ...string) error {
	args := append([]string{"exec", "-i", name}, cmd...)
	command := exec.CommandContext(ctx, "docker", args...)
	command.Stdin = in
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	return command.Run()
}

// execEnvArgs builds `docker exec [extra...] [-e KEY ...] name cmd...`, where
// each env key is forwarded into the container BY NAME ONLY — its value is
// supplied through the docker process environment (returned as procEnv). This
// keeps secrets (DB passwords) out of argv on both the host and the container.
func execEnvArgs(name string, extra []string, env map[string]string, cmd []string) (args []string, procEnv []string) {
	args = append([]string{"exec"}, extra...)
	procEnv = os.Environ()
	for k, v := range env {
		args = append(args, "-e", k)
		procEnv = append(procEnv, k+"="+v)
	}
	args = append(args, name)
	args = append(args, cmd...)
	return args, procEnv
}

// ExecEnv is Exec with extra environment variables forwarded into the container
// without exposing their values in argv. Returns trimmed stdout.
func (c *Client) ExecEnv(ctx context.Context, name string, env map[string]string, cmd ...string) (string, error) {
	args, procEnv := execEnvArgs(name, nil, env, cmd)
	command := exec.CommandContext(ctx, "docker", args...)
	command.Env = procEnv
	var out bytes.Buffer
	command.Stdout = &out
	command.Stderr = io.Discard
	err := command.Run()
	return strings.TrimSpace(out.String()), err
}

// ExecCaptureEnv is ExecCapture with forwarded env vars (see ExecEnv).
func (c *Client) ExecCaptureEnv(ctx context.Context, name string, env map[string]string, out io.Writer, cmd ...string) error {
	args, procEnv := execEnvArgs(name, nil, env, cmd)
	command := exec.CommandContext(ctx, "docker", args...)
	command.Env = procEnv
	command.Stdout = out
	command.Stderr = io.Discard
	return command.Run()
}

// ExecStdinEnv is ExecStdin with forwarded env vars (see ExecEnv).
func (c *Client) ExecStdinEnv(ctx context.Context, name string, env map[string]string, in io.Reader, cmd ...string) error {
	args, procEnv := execEnvArgs(name, []string{"-i"}, env, cmd)
	command := exec.CommandContext(ctx, "docker", args...)
	command.Env = procEnv
	command.Stdin = in
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	return command.Run()
}

// RunEphemeral runs `docker run --rm <args...>` (helper containers for volume
// backup/restore). Output is discarded; returns the command error.
func (c *Client) RunEphemeral(ctx context.Context, args ...string) error {
	full := append([]string{"run", "--rm"}, args...)
	return c.run(ctx, io.Discard, full...)
}

// HTTPProbe hits http://<target><path> from inside the given Docker network via
// an ephemeral curl container and returns the HTTP status code. Works without
// publishing ports and regardless of the target image (no curl needed inside).
func (c *Client) HTTPProbe(ctx context.Context, network, target, path string, timeoutS int) (int, error) {
	if timeoutS <= 0 {
		timeoutS = 5
	}
	url := fmt.Sprintf("http://%s%s", target, path)
	out, err := c.runCapture(ctx, io.Discard,
		"run", "--rm", "--network", network, "curlimages/curl:latest",
		"-s", "-o", "/dev/null", "-w", "%{http_code}",
		"--max-time", fmt.Sprintf("%d", timeoutS), url,
	)
	if err != nil {
		return 0, err
	}
	var code int
	_, _ = fmt.Sscanf(strings.TrimSpace(out), "%d", &code)
	return code, nil
}

func (c *Client) Power(ctx context.Context, name, action string) error {
	switch action {
	case "start":
		return c.run(ctx, io.Discard, "start", name)
	case "stop":
		return c.run(ctx, io.Discard, "stop", name)
	case "restart":
		return c.run(ctx, io.Discard, "restart", name)
	case "kill":
		return c.run(ctx, io.Discard, "kill", name)
	default:
		return fmt.Errorf("unknown power action: %s", action)
	}
}

// Logs streams container logs to w (follow mode).
func (c *Client) Logs(ctx context.Context, name string, w io.Writer) error {
	return c.run(ctx, w, "logs", "-f", "--tail", "200", name)
}

// Stats returns a one-shot resource snapshot as a JSON line ({{json .}}).
func (c *Client) Stats(ctx context.Context, name string) (string, error) {
	return c.runCapture(ctx, io.Discard, "stats", "--no-stream", "--format", "{{json .}}", name)
}

// StatsAll returns one-shot resource snapshots for all running containers,
// one JSON line each ({{json .}}).
func (c *Client) StatsAll(ctx context.Context) (string, error) {
	return c.runCapture(ctx, io.Discard, "stats", "--no-stream", "--format", "{{json .}}")
}

// Inspect returns a single formatted field from `docker inspect`.
func (c *Client) Inspect(ctx context.Context, name, format string) (string, error) {
	return c.runCapture(ctx, io.Discard, "inspect", "--format", format, name)
}

// SystemDf returns `docker system df` rows as JSON lines (one per resource type).
func (c *Client) SystemDf(ctx context.Context) (string, error) {
	return c.runCapture(ctx, io.Discard, "system", "df", "--format", "{{json .}}")
}

// Ps returns container IDs (one per line); all includes stopped containers.
func (c *Client) Ps(ctx context.Context, all bool) (string, error) {
	args := []string{"ps", "--format", "{{.ID}}"}
	if all {
		args = []string{"ps", "-a", "--format", "{{.ID}}"}
	}
	return c.runCapture(ctx, io.Discard, args...)
}

// ImagesByRepo lists "repo:tag" for every image of a given repository.
func (c *Client) ImagesByRepo(ctx context.Context, repo string) (string, error) {
	return c.runCapture(ctx, io.Discard, "images", repo, "--format", "{{.Repository}}:{{.Tag}}")
}

// RemoveImage force-removes an image by reference (ignores errors via caller).
func (c *Client) RemoveImage(ctx context.Context, ref string) error {
	return c.run(ctx, io.Discard, "rmi", "-f", ref)
}

// SystemPrune runs `docker system prune -f`, removing stopped containers,
// unused networks, dangling images and build cache. When all is true it also
// removes ALL unused images (not just dangling ones) via `-a`. Returns the
// command's stdout, which contains a "Total reclaimed space" line.
func (c *Client) SystemPrune(ctx context.Context, all bool) (string, error) {
	args := []string{"system", "prune", "-f"}
	if all {
		args = append(args, "-a")
	}
	return c.runCapture(ctx, io.Discard, args...)
}

// BuilderPrune runs `docker builder prune -f`, clearing the build cache.
func (c *Client) BuilderPrune(ctx context.Context) (string, error) {
	return c.runCapture(ctx, io.Discard, "builder", "prune", "-f")
}

// VolumePrune runs `docker volume prune -f`, removing volumes not used by any
// container. Destructive for data — only call when explicitly requested.
func (c *Client) VolumePrune(ctx context.Context) (string, error) {
	return c.runCapture(ctx, io.Discard, "volume", "prune", "-f")
}

func (c *Client) run(ctx context.Context, w io.Writer, args ...string) error {
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}

// runCapture runs docker and returns trimmed stdout, streaming stderr to w.
func (c *Client) runCapture(ctx context.Context, w io.Writer, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "docker", args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = w
	err := cmd.Run()
	return strings.TrimSpace(out.String()), err
}

type VolumeMount struct {
	Name      string
	MountPath string
}

type RunOptions struct {
	Name           string
	Image          string
	Network        string
	MemLimitMb     int
	CPULimit       int // percent of one core
	PublishPort    int // host port to publish (0 = none); maps host->container 1:1
	Env            map[string]string
	Labels         []string
	Volumes        []VolumeMount
	ReadOnlyRootfs bool // app containers only; DB sidecars leave this false
}
