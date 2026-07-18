package tunnel

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// certDER generates a fresh self-signed cert and returns its leaf DER bytes and
// hex SHA-256 fingerprint.
func certDER(t *testing.T) ([]byte, string) {
	t.Helper()
	cert, err := selfSignedCert()
	if err != nil {
		t.Fatalf("selfSignedCert: %v", err)
	}
	der := cert.Certificate[0]
	return der, rawFingerprint(der)
}

func newTestClient(cfg ClientConfig) *Client {
	cfg.Logf = func(string, ...any) {}
	return NewClient(cfg)
}

func TestVerifyPeer_ConfiguredFingerprint(t *testing.T) {
	der, fp := certDER(t)

	// Exact (case-insensitive) match passes.
	c := newTestClient(ClientConfig{Fingerprint: strings.ToUpper(fp)})
	if err := c.verifyPeer([][]byte{der}, nil); err != nil {
		t.Fatalf("expected match, got error: %v", err)
	}

	// A different pin fails.
	c2 := newTestClient(ClientConfig{Fingerprint: "deadbeef"})
	if err := c2.verifyPeer([][]byte{der}, nil); err == nil {
		t.Fatal("expected fingerprint mismatch error, got nil")
	}
}

func TestVerifyPeer_TOFUCaptureAndPersist(t *testing.T) {
	der, fp := certDER(t)
	fpFile := filepath.Join(t.TempDir(), "nested", "fp.hex")

	c := newTestClient(ClientConfig{FingerprintFile: fpFile})
	if err := c.verifyPeer([][]byte{der}, nil); err != nil {
		t.Fatalf("TOFU first connect should succeed: %v", err)
	}

	// Fingerprint was persisted.
	data, err := os.ReadFile(fpFile)
	if err != nil {
		t.Fatalf("expected persisted fingerprint file: %v", err)
	}
	if got := strings.TrimSpace(string(data)); got != fp {
		t.Fatalf("persisted fingerprint = %q, want %q", got, fp)
	}

	// A new client loads the pinned value and rejects a different cert.
	otherDER, _ := certDER(t)
	c2 := newTestClient(ClientConfig{FingerprintFile: fpFile})
	if err := c2.verifyPeer([][]byte{otherDER}, nil); err == nil {
		t.Fatal("expected mismatch against TOFU-pinned fingerprint, got nil")
	}
	// ...but accepts the originally pinned cert.
	if err := c2.verifyPeer([][]byte{der}, nil); err != nil {
		t.Fatalf("expected pinned cert to pass, got: %v", err)
	}
}

func TestVerifyPeer_FailClosedWithoutPinOrTOFU(t *testing.T) {
	der, _ := certDER(t)
	c := newTestClient(ClientConfig{})
	if err := c.verifyPeer([][]byte{der}, nil); err == nil {
		t.Fatal("expected fail-closed error when no pin/TOFU/insecure, got nil")
	}
}

func TestVerifyPeer_InsecureAllows(t *testing.T) {
	der, _ := certDER(t)
	c := newTestClient(ClientConfig{Insecure: true})
	if err := c.verifyPeer([][]byte{der}, nil); err != nil {
		t.Fatalf("insecure mode should accept any cert, got: %v", err)
	}
}

func TestVerifyPeer_NoCert(t *testing.T) {
	c := newTestClient(ClientConfig{Insecure: true})
	if err := c.verifyPeer(nil, nil); err == nil {
		t.Fatal("expected error when server presents no certificate")
	}
}
