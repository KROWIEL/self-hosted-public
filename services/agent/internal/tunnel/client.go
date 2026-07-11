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
	"strings"
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
	// Fingerprint, if set, pins the server's cert SHA-256 (hex).
	Fingerprint string
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
}

func NewClient(cfg ClientConfig) *Client {
	logf := cfg.Logf
	if logf == nil {
		logf = log.Printf
	}
	return &Client{cfg: cfg, logf: logf}
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
	tlsCfg := &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS12}
	if c.cfg.Fingerprint != "" {
		want := strings.ToLower(c.cfg.Fingerprint)
		tlsCfg.VerifyPeerCertificate = func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
			if len(rawCerts) == 0 || rawFingerprint(rawCerts[0]) != want {
				return errors.New("tunnel: server fingerprint mismatch")
			}
			return nil
		}
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
