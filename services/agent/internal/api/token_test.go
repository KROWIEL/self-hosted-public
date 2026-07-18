package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/self-hosted/agent/internal/config"
)

// mintToken reproduces the control plane's HS256 request-token minting so the
// tests exercise the exact wire format the agent verifies in production.
func mintToken(secret, nodeID string, iat, exp int64) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, _ := json.Marshal(signedTokenClaims{
		Iss: "selfhosted-cp",
		Aud: nodeID,
		Iat: iat,
		Exp: exp,
	})
	payloadB64 := base64.RawURLEncoding.EncodeToString(payload)
	signingInput := header + "." + payloadB64
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signingInput + "." + sig
}

func TestVerifySignedToken(t *testing.T) {
	const secret = "shared-secret-abc123"
	const nodeID = "node-uuid-1"
	now := time.Unix(1_700_000_000, 0)

	t.Run("valid token", func(t *testing.T) {
		tok := mintToken(secret, nodeID, now.Unix(), now.Add(2*time.Minute).Unix())
		if !verifySignedToken(tok, secret, nodeID, now) {
			t.Fatal("expected valid token to verify")
		}
	})

	t.Run("expired token", func(t *testing.T) {
		// Expired well beyond the clock-skew leeway.
		tok := mintToken(secret, nodeID, now.Add(-10*time.Minute).Unix(), now.Add(-5*time.Minute).Unix())
		if verifySignedToken(tok, secret, nodeID, now) {
			t.Fatal("expected expired token to be rejected")
		}
	})

	t.Run("within leeway still valid", func(t *testing.T) {
		// Expired 30s ago; inside the 60s leeway window.
		tok := mintToken(secret, nodeID, now.Add(-2*time.Minute).Unix(), now.Add(-30*time.Second).Unix())
		if !verifySignedToken(tok, secret, nodeID, now) {
			t.Fatal("expected token within leeway to verify")
		}
	})

	t.Run("wrong audience", func(t *testing.T) {
		tok := mintToken(secret, "some-other-node", now.Unix(), now.Add(2*time.Minute).Unix())
		if verifySignedToken(tok, secret, nodeID, now) {
			t.Fatal("expected wrong-audience token to be rejected")
		}
	})

	t.Run("audience skipped when node id unknown", func(t *testing.T) {
		tok := mintToken(secret, "anything", now.Unix(), now.Add(2*time.Minute).Unix())
		if !verifySignedToken(tok, secret, "", now) {
			t.Fatal("expected audience check to be skipped for empty node id")
		}
	})

	t.Run("wrong signature", func(t *testing.T) {
		tok := mintToken("attacker-secret", nodeID, now.Unix(), now.Add(2*time.Minute).Unix())
		if verifySignedToken(tok, secret, nodeID, now) {
			t.Fatal("expected token signed with the wrong secret to be rejected")
		}
	})

	t.Run("tampered payload", func(t *testing.T) {
		tok := mintToken(secret, nodeID, now.Unix(), now.Add(2*time.Minute).Unix())
		parts := strings.Split(tok, ".")
		forged, _ := json.Marshal(signedTokenClaims{Aud: nodeID, Exp: now.Add(999 * time.Hour).Unix()})
		parts[1] = base64.RawURLEncoding.EncodeToString(forged)
		if verifySignedToken(strings.Join(parts, "."), secret, nodeID, now) {
			t.Fatal("expected tampered payload (signature mismatch) to be rejected")
		}
	})

	t.Run("alg none rejected", func(t *testing.T) {
		header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
		payload, _ := json.Marshal(signedTokenClaims{Aud: nodeID, Exp: now.Add(time.Hour).Unix()})
		payloadB64 := base64.RawURLEncoding.EncodeToString(payload)
		tok := header + "." + payloadB64 + "."
		if verifySignedToken(tok, secret, nodeID, now) {
			t.Fatal("expected alg=none token to be rejected")
		}
	})

	t.Run("malformed token", func(t *testing.T) {
		if verifySignedToken("not-a-jwt", secret, nodeID, now) {
			t.Fatal("expected malformed token to be rejected")
		}
	})
}

func TestTokenMatches(t *testing.T) {
	const secret = "shared-secret-abc123"
	const nodeID = "node-uuid-1"
	now := time.Now()

	t.Run("raw static secret accepted (back-compat)", func(t *testing.T) {
		if !tokenMatches(secret, secret, nodeID, now) {
			t.Fatal("expected raw static secret to authenticate")
		}
	})

	t.Run("signed token accepted", func(t *testing.T) {
		tok := mintToken(secret, nodeID, now.Unix(), now.Add(2*time.Minute).Unix())
		if !tokenMatches(tok, secret, nodeID, now) {
			t.Fatal("expected signed token to authenticate")
		}
	})

	t.Run("wrong raw secret rejected", func(t *testing.T) {
		if tokenMatches("nope", secret, nodeID, now) {
			t.Fatal("expected wrong raw secret to be rejected")
		}
	})

	t.Run("empty presented rejected", func(t *testing.T) {
		if tokenMatches("", secret, nodeID, now) {
			t.Fatal("expected empty bearer to be rejected")
		}
	})
}

// TestAuthMiddleware exercises the full HTTP auth path: signed tokens, the raw
// back-compat secret, rejection, and the rotation accept-both + promotion flow.
func TestAuthMiddleware(t *testing.T) {
	const current = "current-secret-0001"
	const nodeID = "node-uuid-1"
	srv := NewServer(config.Config{DaemonToken: current, NodeID: nodeID})

	handler := srv.auth(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	do := func(bearer string) int {
		req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}

	now := time.Now()

	if code := do(mintToken(current, nodeID, now.Unix(), now.Add(time.Minute).Unix())); code != http.StatusOK {
		t.Fatalf("signed token: want 200, got %d", code)
	}
	if code := do(current); code != http.StatusOK {
		t.Fatalf("raw secret: want 200, got %d", code)
	}
	if code := do("garbage"); code != http.StatusUnauthorized {
		t.Fatalf("bad token: want 401, got %d", code)
	}
	if code := do(""); code != http.StatusUnauthorized {
		t.Fatalf("no token: want 401, got %d", code)
	}

	// --- Rotation window: stage a new secret, then confirm both are accepted
	// and that using the new one promotes it and retires the old.
	const next = "next-secret-0002"
	srv.tokens.setNext(next)

	if code := do(current); code != http.StatusOK {
		t.Fatalf("old secret during rotation: want 200, got %d", code)
	}
	if got := srv.CurrentToken(); got != current {
		t.Fatalf("current should not promote on old-secret use, got %q", got)
	}

	// Use the NEW secret -> promotion should occur.
	if code := do(mintToken(next, nodeID, now.Unix(), now.Add(time.Minute).Unix())); code != http.StatusOK {
		t.Fatalf("new signed token during rotation: want 200, got %d", code)
	}
	if got := srv.CurrentToken(); got != next {
		t.Fatalf("expected promotion to next secret, got %q", got)
	}
	// Old secret must no longer authenticate once the window closed.
	if code := do(current); code != http.StatusUnauthorized {
		t.Fatalf("old secret after promotion: want 401, got %d", code)
	}
}

// TestHandleRotate verifies the rotate endpoint stages the new secret.
func TestHandleRotate(t *testing.T) {
	srv := NewServer(config.Config{DaemonToken: "current-secret", NodeID: "n1"})

	body := strings.NewReader(`{"newToken":"brand-new-secret"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/rotate", body)
	rec := httptest.NewRecorder()
	srv.handleRotate(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("rotate: want 200, got %d", rec.Code)
	}

	// The new secret must now authenticate (accepted as the pending "next").
	handler := srv.auth(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req2 := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	req2.Header.Set("Authorization", "Bearer brand-new-secret")
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("new secret after rotate: want 200, got %d", rec2.Code)
	}

	// An empty newToken is a bad request.
	rec3 := httptest.NewRecorder()
	srv.handleRotate(rec3, httptest.NewRequest(http.MethodPost, "/api/rotate", strings.NewReader(`{"newToken":""}`)))
	if rec3.Code != http.StatusBadRequest {
		t.Fatalf("empty rotate: want 400, got %d", rec3.Code)
	}
}
