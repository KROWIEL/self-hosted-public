// Command tunnel-client runs on the private (home / grey-IP) host alongside the
// panel and Traefik. It dials OUT to the public tunnel-server and forwards
// inbound public connections to local targets (e.g. the local Traefik).
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"github.com/self-hosted/agent/internal/tunnel"
)

type mapFlag map[int]string

func (m mapFlag) String() string { return "" }
func (m mapFlag) Set(v string) error {
	// Accept "443=127.0.0.1:443" or "443:127.0.0.1:443".
	sep := strings.IndexAny(v, "=")
	if sep < 0 {
		// fall back to first ':' as separator (port:host:port)
		sep = strings.Index(v, ":")
	}
	if sep <= 0 {
		return &mapError{v}
	}
	port, err := strconv.Atoi(strings.TrimSpace(v[:sep]))
	if err != nil || port <= 0 || port > 65535 {
		return &mapError{v}
	}
	target := strings.TrimSpace(v[sep+1:])
	if target == "" {
		return &mapError{v}
	}
	m[port] = target
	return nil
}

type mapError struct{ v string }

func (e *mapError) Error() string { return "invalid --map (want PORT=HOST:PORT): " + e.v }

func main() {
	server := flag.String("server", env("TUNNEL_SERVER", ""), "public control endpoint (host:port)")
	token := flag.String("token", env("TUNNEL_TOKEN", ""), "shared auth token")
	fingerprint := flag.String("fingerprint", env("TUNNEL_FINGERPRINT", ""), "pinned server cert SHA-256 (hex, optional)")
	proxyProto := flag.Bool("proxy-protocol", env("TUNNEL_PROXY_PROTOCOL", "") == "1", "prepend PROXY v1 header to local connections")
	targets := mapFlag{}
	flag.Var(targets, "map", "port mapping PORT=HOST:PORT (repeatable; default 443=127.0.0.1:443)")
	flag.Parse()

	if *server == "" || *token == "" {
		log.Fatal("tunnel-client: --server and --token are required")
	}
	if len(targets) == 0 {
		// Allow TUNNEL_MAP="443=127.0.0.1:443,80=127.0.0.1:80".
		if envMap := os.Getenv("TUNNEL_MAP"); envMap != "" {
			for _, part := range strings.Split(envMap, ",") {
				if err := targets.Set(part); err != nil {
					log.Fatalf("tunnel-client: %v", err)
				}
			}
		}
	}
	if len(targets) == 0 {
		targets[443] = "127.0.0.1:443"
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cl := tunnel.NewClient(tunnel.ClientConfig{
		ServerAddr:    *server,
		Token:         *token,
		Targets:       targets,
		Fingerprint:   *fingerprint,
		ProxyProtocol: *proxyProto,
	})
	if err := cl.Run(ctx); err != nil && ctx.Err() == nil {
		log.Fatalf("tunnel-client: %v", err)
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
