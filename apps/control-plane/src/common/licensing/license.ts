import { createPublicKey, verify as edVerify } from 'crypto';
import {
  Entitlements,
  FREE_ENTITLEMENTS,
  LicensePayload,
  TIER_LIMITS,
  TIER_MODULES,
} from '@selfhosted/shared';

/**
 * License key format: `base64url(payloadJson).base64url(ed25519Signature)`.
 *
 * The signature is produced by the seller-side issuer tool with the private
 * key; the panel verifies it offline with the embedded public key (or an
 * override supplied via `LICENSE_PUBLIC_KEY`). No network calls, so licensing
 * keeps working on air-gapped / home-lab installs.
 */

/**
 * Default verification public key — the seller's PRODUCTION signing key. The
 * matching private key lives ONLY in the seller's signer (self-hosted-pay /
 * tools/license-issuer) and is never shipped. Override per-deployment with
 * `LICENSE_PUBLIC_KEY` (full PEM, or a single line with `\n` escapes).
 */
const DEFAULT_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEArcXE4cUrEDz66l0umXQGq1dxX1QVYAFOO6JqTx6BjWs=
-----END PUBLIC KEY-----`;

/**
 * The throwaway development key that shipped in early builds. Kept only so the
 * panel can warn operators who somehow still verify against it (its private key
 * is public). Not used for verification unless it is the active key.
 */
const DEV_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAzT28H6B1h8HEt/YMfxbJI2AIWGZBwu2XU6Z9YEqj6qo=
-----END PUBLIC KEY-----`;

function publicKeyPem(): string {
  const env = process.env.LICENSE_PUBLIC_KEY;
  if (env && env.trim()) {
    return env.includes('BEGIN') ? env.replace(/\\n/g, '\n') : env;
  }
  return DEFAULT_PUBLIC_KEY_PEM;
}

function base64urlToBuffer(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

/**
 * Verify a license key's signature and parse its payload. Returns `null` for
 * any malformed, tampered or unverifiable key (never throws). Expiry is NOT
 * checked here — see {@link entitlementsFromKey}.
 */
export function verifyLicenseKey(key: string): LicensePayload | null {
  try {
    const trimmed = key.trim();
    const dot = trimmed.indexOf('.');
    if (dot <= 0 || dot === trimmed.length - 1) return null;

    const payloadBuf = base64urlToBuffer(trimmed.slice(0, dot));
    const signature = base64urlToBuffer(trimmed.slice(dot + 1));
    const pub = createPublicKey(publicKeyPem());

    // Ed25519 uses a null algorithm identifier.
    if (!edVerify(null, payloadBuf, pub, signature)) return null;

    const payload = JSON.parse(payloadBuf.toString('utf8')) as LicensePayload;
    if (!payload || typeof payload !== 'object') return null;
    if (!['free', 'homelab', 'pro'].includes(payload.tier)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Resolve the effective entitlements for a (possibly absent) license key.
 * Invalid or expired keys degrade gracefully to the Free defaults.
 */
export function entitlementsFromKey(
  key: string | null | undefined,
): Entitlements {
  if (!key || !key.trim()) return FREE_ENTITLEMENTS;

  const payload = verifyLicenseKey(key);
  if (!payload) return FREE_ENTITLEMENTS;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp > 0 && payload.exp < now) {
    return FREE_ENTITLEMENTS;
  }

  const modules = Array.from(
    new Set([...(TIER_MODULES[payload.tier] ?? []), ...(payload.modules ?? [])]),
  );

  return {
    tier: payload.tier,
    modules,
    limits: TIER_LIMITS[payload.tier] ?? TIER_LIMITS.free,
    expiresAt: payload.exp && payload.exp > 0 ? payload.exp : null,
    licensed: payload.tier !== 'free',
    subject: payload.sub,
    name: payload.name,
  };
}

/** Returns true when the key is a syntactically & cryptographically valid,
 * non-expired license (any tier). */
export function isLicenseUsable(key: string): boolean {
  const payload = verifyLicenseKey(key);
  if (!payload) return false;
  const now = Math.floor(Date.now() / 1000);
  return !(payload.exp && payload.exp > 0 && payload.exp < now);
}

/**
 * True when license verification is still using the throwaway DEVELOPMENT key —
 * either baked into an un-rotated build or supplied via `LICENSE_PUBLIC_KEY`. The
 * dev private key is public, so anyone could mint valid keys; this MUST be false
 * before issuing real licenses (rotate the embedded key or set LICENSE_PUBLIC_KEY).
 */
export function isUsingDevLicenseKey(): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '');
  return norm(publicKeyPem()) === norm(DEV_PUBLIC_KEY_PEM);
}
