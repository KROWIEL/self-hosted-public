package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

// tokenLeeway tolerates modest clock skew between the panel and the node when
// checking a signed request token's expiry / issued-at.
const tokenLeeway = 60 * time.Second

// signedTokenClaims is the payload the control plane signs (HS256) for each
// CP->agent request. The signing key is the per-node shared daemon secret
// established at enrollment, so no new key material is ever exchanged.
type signedTokenClaims struct {
	Iss string `json:"iss"`
	Aud string `json:"aud"`
	Iat int64  `json:"iat"`
	Exp int64  `json:"exp"`
}

// looksLikeJWT reports whether s has the three dot-separated segments of a JWS
// compact serialization. Used to decide whether to attempt signature
// verification before falling back to a raw static-token comparison.
func looksLikeJWT(s string) bool {
	return strings.Count(s, ".") == 2
}

// verifySignedToken validates a short-lived HS256 request token against a single
// shared secret. It rejects any algorithm other than HS256 (guards against
// alg-confusion / "none"), verifies the signature in constant time, checks the
// expiry (with leeway) and — when nodeID is known — the audience. Returns true
// only for a fully valid token.
func verifySignedToken(token, secret, nodeID string, now time.Time) bool {
	if secret == "" {
		return false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}
	headerB64, payloadB64, sigB64 := parts[0], parts[1], parts[2]

	headerRaw, err := base64.RawURLEncoding.DecodeString(headerB64)
	if err != nil {
		return false
	}
	var header struct {
		Alg string `json:"alg"`
		Typ string `json:"typ"`
	}
	if json.Unmarshal(headerRaw, &header) != nil || header.Alg != "HS256" {
		return false
	}

	sig, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(headerB64 + "." + payloadB64))
	if subtle.ConstantTimeCompare(sig, mac.Sum(nil)) != 1 {
		return false
	}

	payloadRaw, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return false
	}
	var claims signedTokenClaims
	if json.Unmarshal(payloadRaw, &claims) != nil {
		return false
	}
	if claims.Exp == 0 || now.After(time.Unix(claims.Exp, 0).Add(tokenLeeway)) {
		return false
	}
	if claims.Iat != 0 && time.Unix(claims.Iat, 0).After(now.Add(tokenLeeway)) {
		return false
	}
	// Audience binds a token to one node; skipped when the agent has no node id
	// (the local dev agent, which is not enrolled).
	if nodeID != "" && claims.Aud != nodeID {
		return false
	}
	return true
}

// tokenMatches reports whether the presented bearer value authenticates against
// the given shared secret — either as a valid signed request token or as the
// raw static secret (constant-time). Preserving the raw comparison keeps
// already-enrolled agents and the control plane's legacy fallback working.
func tokenMatches(presented, secret, nodeID string, now time.Time) bool {
	if secret == "" || presented == "" {
		return false
	}
	if looksLikeJWT(presented) && verifySignedToken(presented, secret, nodeID, now) {
		return true
	}
	return subtle.ConstantTimeCompare([]byte(presented), []byte(secret)) == 1
}
