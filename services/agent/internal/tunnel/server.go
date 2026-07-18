package tunnel

import (
	"bufio"
	"context"
	"crypto/subtle"
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	"github.com/hashicorp/yamux"
)

// ServerConfig configures the public-side (VDS) tunnel server.
type ServerConfig struct {
	// ControlAddr is where the client dials in (e.g. ":7000").
	ControlAddr string
	// Token authenticates the client.
	Token string
	// Ports are the public TCP ports to listen on and relay (e.g. 443, 80).
	Ports []int
	// Logf, if nil, defaults to the standard logger.
	Logf func(format string, args ...any)
}

// Server relays public inbound connections to a single connected client.
type Server struct {
	cfg  ServerConfig
	logf func(string, ...any)

	mu      sync.RWMutex
	session *yamux.Session
}

func NewServer(cfg ServerConfig) *Server {
	logf := cfg.Logf
	if logf == nil {
		logf = log.Printf
	}
	return &Server{cfg: cfg, logf: logf}
}

// Run starts the control listener and all public port listeners. Blocks until
// ctx is cancelled or a listener fails fatally.
func (s *Server) Run(ctx context.Context) error {
	cert, err := selfSignedCert()
	if err != nil {
		return fmt.Errorf("tls cert: %w", err)
	}
	s.logf("tunnel-server control fingerprint: %s", CertFingerprint(cert))

	tlsCfg := &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
	cl, err := tls.Listen("tcp", s.cfg.ControlAddr, tlsCfg)
	if err != nil {
		return fmt.Errorf("control listen %s: %w", s.cfg.ControlAddr, err)
	}
	defer cl.Close()
	s.logf("tunnel-server control listening on %s", s.cfg.ControlAddr)

	go s.acceptControl(ctx, cl)

	errc := make(chan error, len(s.cfg.Ports))
	for _, p := range s.cfg.Ports {
		go func(port int) { errc <- s.servePublic(ctx, port) }(p)
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-errc:
		return err
	}
}

func (s *Server) acceptControl(ctx context.Context, l net.Listener) {
	go func() { <-ctx.Done(); _ = l.Close() }()
	for {
		conn, err := l.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			s.logf("control accept: %v", err)
			time.Sleep(time.Second)
			continue
		}
		go s.handleControl(conn)
	}
}

func (s *Server) handleControl(conn net.Conn) {
	_ = conn.SetDeadline(time.Now().Add(handshakeLimit))
	br := bufio.NewReader(conn)
	var hello Hello
	if err := readJSONLine(br, &hello); err != nil {
		s.logf("control handshake read: %v", err)
		_ = conn.Close()
		return
	}
	// Constant-time compare to avoid leaking the token via response timing. An
	// empty configured token always rejects (fail closed).
	if s.cfg.Token == "" ||
		subtle.ConstantTimeCompare([]byte(hello.Token), []byte(s.cfg.Token)) != 1 {
		_ = writeJSONLine(conn, HelloAck{OK: false, Error: "unauthorized"})
		_ = conn.Close()
		s.logf("control rejected: bad token from %s", conn.RemoteAddr())
		return
	}
	if err := writeJSONLine(conn, HelloAck{OK: true, Ports: s.cfg.Ports}); err != nil {
		_ = conn.Close()
		return
	}
	_ = conn.SetDeadline(time.Time{})

	sess, err := yamux.Server(conn, yamuxConfig())
	if err != nil {
		s.logf("yamux server: %v", err)
		_ = conn.Close()
		return
	}

	s.mu.Lock()
	if s.session != nil {
		_ = s.session.Close() // replace any stale client
	}
	s.session = sess
	s.mu.Unlock()
	s.logf("client connected from %s", conn.RemoteAddr())

	<-sess.CloseChan()
	s.mu.Lock()
	if s.session == sess {
		s.session = nil
	}
	s.mu.Unlock()
	s.logf("client disconnected from %s", conn.RemoteAddr())
}

func (s *Server) servePublic(ctx context.Context, port int) error {
	addr := fmt.Sprintf(":%d", port)
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("public listen %s: %w", addr, err)
	}
	defer l.Close()
	go func() { <-ctx.Done(); _ = l.Close() }()
	s.logf("tunnel-server public listening on %s", addr)

	for {
		conn, err := l.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			s.logf("public accept %s: %v", addr, err)
			time.Sleep(200 * time.Millisecond)
			continue
		}
		go s.relay(conn, port)
	}
}

func (s *Server) relay(pub net.Conn, port int) {
	s.mu.RLock()
	sess := s.session
	s.mu.RUnlock()
	if sess == nil {
		_ = pub.Close() // no client connected; drop
		return
	}

	stream, err := sess.OpenStream()
	if err != nil {
		s.logf("open stream: %v", err)
		_ = pub.Close()
		return
	}
	if err := writeStreamHeader(stream, StreamHeader{Port: port, Remote: pub.RemoteAddr().String()}); err != nil {
		_ = stream.Close()
		_ = pub.Close()
		return
	}
	pipe(pub, stream)
}

func yamuxConfig() *yamux.Config {
	c := yamux.DefaultConfig()
	c.EnableKeepAlive = true
	c.KeepAliveInterval = 15 * time.Second
	c.ConnectionWriteTimeout = 20 * time.Second
	// Silence yamux's internal logging.
	c.LogOutput = discard{}
	return c
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }
