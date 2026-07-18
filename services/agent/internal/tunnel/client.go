package tunnel

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/hashicorp/yamux"
)

// ClientConfig configures the private-side (home) tunnel client.
type ClientConfig struct {
	// ServerAddr is the public control endpoint to dial (host:port).
	ServerAddr string
	// Token authenticates to the server.
	Token string
	// Targets maps a public port to the local address to forward it to,
	// e.g. {443: "127.0.0.1:443", 80: "127.0.0.1:80"}.
	Targets map[int]string
	// Fingerprint, if set, pins the server's cert SHA-256 (hex). Takes priority
	// over TOFU.
	Fingerprint string
	// FingerprintFile enables trust-on-first-use (TOFU): when no Fingerprint is
	// configured, the first server cert seen is captured and persisted here, and
	// every later connect must match it. Empty disables TOFU persistence.
	FingerprintFile string
	// Insecure explicitly opts into blind TLS trust (no pinning, no TOFU). It
	// requires a deliberate flag and emits a hard warning; never the default.
	Insecure bool
	// ProxyProtocol prepends a PROXY v1 header to the local connection so the
	// target can recover the real client IP.
	ProxyProtocol bool
	// Logf, if nil, defaults to the standard logger.
	Logf func(format string, args ...any)
}

// Client maintains a persistent reverse tunnel to the server, reconnecting with
// backoff whenever the link drops.
type Client struct {
	cfg  ClientConfig
	logf func(string, ...any)

	mu     sync.Mutex
	pinned string // lowercased hex SHA-256 of the trusted server cert, if known
}

func NewClient(cfg ClientConfig) *Client {
	logf := cfg.Logf
	if logf == nil {
		logf = log.Printf
	}
	c := &Client{cfg: cfg, logf: logf}

	// Seed the pinned fingerprint: an explicit config value wins; otherwise load
	// any value previously captured via TOFU.
	c.pinned = strings.ToLower(strings.TrimSpace(cfg.Fingerprint))
	if c.pinned == "" && cfg.FingerprintFile != "" {
		if b, err := os.ReadFile(cfg.FingerprintFile); err == nil {
			c.pinned = strings.ToLower(strings.TrimSpace(string(b)))
		}
	}
	return c
}

// Run connects and serves until ctx is cancelled, reconnecting on failure.
func (c *Client) Run(ctx context.Context) error {
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		err := c.serveOnce(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			c.logf("tunnel link down: %v (retry in %s)", err, backoff)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}
	}
}

func (c *Client) serveOnce(ctx context.Context) error {
	// We always set InsecureSkipVerify (the server uses a self-signed cert) but
	// supply our own verifier that pins the fingerprint (configured or TOFU).
	// Blind trust is only reached when Insecure is explicitly set.
	tlsCfg := &tls.Config{
		InsecureSkipVerify:    true, //nolint:gosec // verified via VerifyPeerCertificate (pin/TOFU)
		MinVersion:            tls.VersionTLS12,
		VerifyPeerCertificate: c.verifyPeer,
	}

	d := &tls.Dialer{Config: tlsCfg}
	dialCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	rawConn, err := d.DialContext(dialCtx, "tcp", c.cfg.ServerAddr)
	cancel()
	if err != nil {
		return fmt.Errorf("dial %s: %w", c.cfg.ServerAddr, err)
	}
	conn := rawConn.(net.Conn)

	_ = conn.SetDeadline(time.Now().Add(handshakeLimit))
	if err := writeJSONLine(conn, Hello{Version: ProtocolVersion, Token: c.cfg.Token}); err != nil {
		_ = conn.Close()
		return fmt.Errorf("send hello: %w", err)
	}
	var ack HelloAck
	if err := readJSONLine(bufio.NewReader(conn), &ack); err != nil {
		_ = conn.Close()
		return fmt.Errorf("read ack: %w", err)
	}
	if !ack.OK {
		_ = conn.Close()
		return fmt.Errorf("server rejected: %s", ack.Error)
	}
	_ = conn.SetDeadline(time.Time{})

	sess, err := yamux.Client(conn, yamuxConfig())
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("yamux client: %w", err)
	}
	defer sess.Close()
	c.logf("tunnel connected to %s (relaying ports %v)", c.cfg.ServerAddr, ack.Ports)

	go func() { <-ctx.Done(); _ = sess.Close() }()

	for {
		stream, err := sess.AcceptStream()
		if err != nil {
			return err
		}
		go c.handleStream(stream)
	}
}

// verifyPeer implements the TLS peer verification for the self-signed server:
//   - if a fingerprint is pinned (configured or previously captured via TOFU),
//     require an exact match;
//   - else if a FingerprintFile is set, TOFU: capture + persist this cert and
//     pin it for subsequent connects;
//   - else if Insecure is explicitly enabled, accept blindly (loud warning);
//   - otherwise refuse to connect (fail closed) rather than trust blindly.
func (c *Client) verifyPeer(rawCerts [][]byte, _ [][]*x509.Certificate) error {
	if len(rawCerts) == 0 {
		return errors.New("tunnel: server presented no certificate")
	}
	fp := rawFingerprint(rawCerts[0])

	c.mu.Lock()
	pinned := c.pinned
	c.mu.Unlock()

	if pinned != "" {
		if fp != pinned {
			return errors.New("tunnel: server fingerprint mismatch")
		}
		return nil
	}

	// No pin yet — trust on first use if we have somewhere to persist it.
	if c.cfg.FingerprintFile != "" {
		c.mu.Lock()
		c.pinned = fp
		c.mu.Unlock()
		if err := persistFingerprint(c.cfg.FingerprintFile, fp); err != nil {
			c.logf("tunnel: WARNING could not persist pinned fingerprint to %s: %v "+
				"(pinned in-memory for this session only)", c.cfg.FingerprintFile, err)
		} else {
			c.logf("tunnel: pinned server fingerprint %s (TOFU) → %s", fp, c.cfg.FingerprintFile)
		}
		return nil
	}

	if c.cfg.Insecure {
		c.logf("tunnel: WARNING connecting with INSECURE blind TLS trust — the " +
			"server certificate is NOT verified; set a fingerprint or state dir")
		return nil
	}

	return errors.New("tunnel: no pinned fingerprint and TOFU persistence is " +
		"disabled; refusing blind trust (set --fingerprint, --state-dir/--fingerprint-file, or --insecure)")
}

// persistFingerprint atomically writes the pinned fingerprint to disk (0600),
// creating the parent directory if needed.
func persistFingerprint(path, fp string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(fp+"\n"), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (c *Client) handleStream(stream net.Conn) {
	hdr, err := readStreamHeader(stream)
	if err != nil {
		_ = stream.Close()
		return
	}
	target, ok := c.cfg.Targets[hdr.Port]
	if !ok {
		c.logf("no local target mapped for port %d", hdr.Port)
		_ = stream.Close()
		return
	}

	local, err := net.DialTimeout("tcp", target, 10*time.Second)
	if err != nil {
		c.logf("dial local %s: %v", target, err)
		_ = stream.Close()
		return
	}

	if c.cfg.ProxyProtocol {
		if remote := parseAddr(hdr.Remote); remote != nil {
			_ = writeProxyV1(local, remote, local.LocalAddr())
		}
	}
	pipe(stream, local)
}

func parseAddr(s string) net.Addr {
	host, port, err := net.SplitHostPort(s)
	if err != nil {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return nil
	}
	p := 0
	fmt.Sscanf(port, "%d", &p)
	return &net.TCPAddr{IP: ip, Port: p}
}
