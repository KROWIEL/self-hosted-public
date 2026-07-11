// Command tunnel-server is the lightweight public-side (VDS) relay. It listens
// on the configured public ports and forwards every connection back to a single
// connected tunnel client over one multiplexed link. It runs no Docker and
// keeps no per-app state — it only relays bytes.
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

func main() {
	control := flag.String("control", env("TUNNEL_CONTROL", ":7000"), "control listen address (host:port)")
	token := flag.String("token", env("TUNNEL_TOKEN", ""), "shared auth token")
	portsStr := flag.String("ports", env("TUNNEL_PORTS", "443"), "comma-separated public ports to relay (e.g. 443,80)")
	flag.Parse()

	if *token == "" {
		log.Fatal("tunnel-server: --token (or TUNNEL_TOKEN) is required")
	}
	ports, err := parsePorts(*portsStr)
	if err != nil {
		log.Fatalf("tunnel-server: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := tunnel.NewServer(tunnel.ServerConfig{
		ControlAddr: *control,
		Token:       *token,
		Ports:       ports,
	})
	if err := srv.Run(ctx); err != nil && ctx.Err() == nil {
		log.Fatalf("tunnel-server: %v", err)
	}
}

func parsePorts(s string) ([]int, error) {
	var out []int
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		p, err := strconv.Atoi(part)
		if err != nil || p <= 0 || p > 65535 {
			return nil, &portError{part}
		}
		out = append(out, p)
	}
	if len(out) == 0 {
		return nil, &portError{s}
	}
	return out, nil
}

type portError struct{ v string }

func (e *portError) Error() string { return "invalid port: " + e.v }

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
