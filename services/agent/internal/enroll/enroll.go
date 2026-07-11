// Package enroll handles remote-node bootstrap: a persistent self-signed TLS
// identity, one-time enrollment with the control plane (exchanging a join token
// for a long-lived daemon token), persistence of that state across restarts,
// and periodic heartbeats so the panel can track online/offline status.
package enroll

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// httpClient talks to the panel. Set AGENT_PANEL_INSECURE=1 when the panel uses
// a self-signed certificate (e.g. behind a grey-IP reverse tunnel in dev).
func httpClient() *http.Client {
	tr := &http.Transport{}
	if os.Getenv("AGENT_PANEL_INSECURE") == "1" {
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} // #nosec G402 — opt-in
	}
	return &http.Client{Timeout: 15 * time.Second, Transport: tr}
}

// Store persists the agent's TLS identity and provisioned credentials.
type Store struct {
	dir string
}

// State is the provisioned identity written after a successful enrollment.
type State struct {
	NodeID      string `json:"nodeId"`
	DaemonToken string `json:"daemonToken"`
}

func NewStore(dir string) *Store { return &Store{dir: dir} }

func (s *Store) certPath() string  { return filepath.Join(s.dir, "cert.pem") }
func (s *Store) keyPath() string   { return filepath.Join(s.dir, "key.pem") }
func (s *Store) statePath() string { return filepath.Join(s.dir, "state.json") }

// CertPath / KeyPath expose the TLS material for the HTTPS server.
func (s *Store) CertPath() string { return s.certPath() }
func (s *Store) KeyPath() string  { return s.keyPath() }

// EnsureCert generates a persistent self-signed certificate on first use and
// returns its SHA-256 fingerprint (hex, lowercase) — the value the panel pins.
func (s *Store) EnsureCert() (fingerprint string, err error) {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return "", fmt.Errorf("state dir: %w", err)
	}
	if _, statErr := os.Stat(s.certPath()); statErr == nil {
		return s.fingerprintFromFile()
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return "", err
	}
	tmpl := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "selfhosted-agent"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		return "", err
	}
	certPem := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyDer, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return "", err
	}
	keyPem := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDer})
	if err := os.WriteFile(s.certPath(), certPem, 0o600); err != nil {
		return "", err
	}
	if err := os.WriteFile(s.keyPath(), keyPem, 0o600); err != nil {
		return "", err
	}
	sum := sha256.Sum256(der)
	return hex.EncodeToString(sum[:]), nil
}

func (s *Store) fingerprintFromFile() (string, error) {
	raw, err := os.ReadFile(s.certPath())
	if err != nil {
		return "", err
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return "", fmt.Errorf("bad cert pem")
	}
	sum := sha256.Sum256(block.Bytes)
	return hex.EncodeToString(sum[:]), nil
}

// LoadState reads the persisted enrollment state, or nil if not yet enrolled.
func (s *Store) LoadState() *State {
	raw, err := os.ReadFile(s.statePath())
	if err != nil {
		return nil
	}
	var st State
	if json.Unmarshal(raw, &st) != nil || st.DaemonToken == "" {
		return nil
	}
	return &st
}

// SaveState persists the enrollment state (node id + daemon token).
func (s *Store) SaveState(st State) error {
	raw, err := json.Marshal(st)
	if err != nil {
		return err
	}
	return os.WriteFile(s.statePath(), raw, 0o600)
}

// Enroll exchanges a one-time join token for a long-lived daemon token.
func Enroll(panelURL, joinToken, fingerprint string, version string, port int) (State, error) {
	body, _ := json.Marshal(map[string]any{
		"joinToken":   joinToken,
		"fingerprint": fingerprint,
		"version":     version,
		"agentPort":   port,
	})
	req, err := http.NewRequest(http.MethodPost, panelURL+"/api/v1/node-agent/enroll", bytes.NewReader(body))
	if err != nil {
		return State{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient().Do(req)
	if err != nil {
		return State{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return State{}, fmt.Errorf("enroll failed: HTTP %d", resp.StatusCode)
	}
	var out State
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return State{}, err
	}
	if out.DaemonToken == "" || out.NodeID == "" {
		return State{}, fmt.Errorf("enroll: incomplete response")
	}
	return out, nil
}

// HeartbeatLoop periodically reports liveness to the panel until ctx-less exit.
func HeartbeatLoop(panelURL string, st State, version string) {
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	beat := func() {
		body, _ := json.Marshal(map[string]any{"nodeId": st.NodeID, "version": version})
		req, err := http.NewRequest(http.MethodPost, panelURL+"/api/v1/node-agent/heartbeat", bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+st.DaemonToken)
		resp, err := httpClient().Do(req)
		if err != nil {
			return
		}
		resp.Body.Close()
	}
	beat()
	for range tick.C {
		beat()
	}
}
