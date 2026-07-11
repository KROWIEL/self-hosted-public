// Package tunnel implements a minimal multiplexed reverse tunnel.
//
// Topology: the panel/apps run on a private (grey-IP / NAT) host together with
// a tunnel CLIENT; a lightweight tunnel SERVER runs on a public (white-IP) VDS.
// The client dials OUT to the server (NAT-friendly), the server listens on the
// public ports (e.g. 443) and forwards every inbound connection back over a
// single multiplexed link to the client, which pipes it to a local target
// (e.g. the local Traefik). The VDS only relays bytes — no per-app config.
package tunnel

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"time"
)

// ProtocolVersion is bumped on incompatible wire changes.
const ProtocolVersion = 1

// Hello is sent by the client right after the control connection is up.
type Hello struct {
	Version int    `json:"version"`
	Token   string `json:"token"`
}

// HelloAck is the server's reply to a Hello.
type HelloAck struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	// Ports the server is publicly listening on, for client-side logging.
	Ports []int `json:"ports,omitempty"`
}

// StreamHeader prefixes every data stream the server opens toward the client,
// telling it which public port the connection arrived on (so it can map to the
// right local target) and the original client address (for logging / PROXY).
type StreamHeader struct {
	Port   int    `json:"port"`
	Remote string `json:"remote"`
}

const (
	maxLine        = 64 * 1024
	handshakeLimit = 10 * time.Second
)

func writeJSONLine(w io.Writer, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	_, err = w.Write(b)
	return err
}

func readJSONLine(r *bufio.Reader, v any) error {
	line, err := r.ReadBytes('\n')
	if err != nil {
		return err
	}
	if len(line) > maxLine {
		return errors.New("tunnel: handshake line too long")
	}
	return json.Unmarshal(line, v)
}

// writeStreamHeader writes a length-prefixed JSON header onto a fresh stream.
func writeStreamHeader(w io.Writer, h StreamHeader) error {
	b, err := json.Marshal(h)
	if err != nil {
		return err
	}
	if len(b) > 0xffff {
		return errors.New("tunnel: stream header too large")
	}
	var lp [2]byte
	lp[0] = byte(len(b) >> 8)
	lp[1] = byte(len(b))
	if _, err := w.Write(lp[:]); err != nil {
		return err
	}
	_, err = w.Write(b)
	return err
}

// readStreamHeader reads the length-prefixed JSON header from a stream.
func readStreamHeader(r io.Reader) (StreamHeader, error) {
	var h StreamHeader
	var lp [2]byte
	if _, err := io.ReadFull(r, lp[:]); err != nil {
		return h, err
	}
	n := int(lp[0])<<8 | int(lp[1])
	if n == 0 || n > 0xffff {
		return h, fmt.Errorf("tunnel: bad stream header length %d", n)
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return h, err
	}
	err := json.Unmarshal(buf, &h)
	return h, err
}

// pipe copies between two connections until either side closes, then tears the
// other half down. Returns when both directions are finished.
func pipe(a, b net.Conn) {
	done := make(chan struct{}, 2)
	cp := func(dst, src net.Conn) {
		_, _ = io.Copy(dst, src)
		// Unblock the peer copy by closing the write side.
		if cw, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = cw.CloseWrite()
		} else {
			_ = dst.Close()
		}
		done <- struct{}{}
	}
	go cp(a, b)
	go cp(b, a)
	<-done
	<-done
	_ = a.Close()
	_ = b.Close()
}

// writeProxyV1 writes a HAProxy PROXY protocol v1 header describing src→dst so
// the local target (e.g. Traefik) can recover the real client IP.
func writeProxyV1(w io.Writer, src, dst net.Addr) error {
	sh, sp, err1 := net.SplitHostPort(src.String())
	dh, dp, err2 := net.SplitHostPort(dst.String())
	if err1 != nil || err2 != nil {
		return errors.New("tunnel: cannot format PROXY header")
	}
	proto := "TCP4"
	if ip := net.ParseIP(sh); ip != nil && ip.To4() == nil {
		proto = "TCP6"
	}
	_, err := fmt.Fprintf(w, "PROXY %s %s %s %s %s\r\n", proto, sh, dh, sp, dp)
	return err
}
