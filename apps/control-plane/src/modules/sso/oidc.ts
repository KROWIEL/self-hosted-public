import { createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';

/**
 * Minimal, dependency-free OpenID Connect (Authorization Code flow) helpers.
 *
 * We deliberately avoid pulling in a full OIDC client: the flow we need is
 * small and well-specified. Discovery + JWKS + RS256/384/512 ID-token
 * verification is enough to support the common enterprise IdPs (Google,
 * Microsoft Entra, Okta, Auth0, Keycloak, Authentik, …). The ID token is
 * fetched over the TLS-protected back-channel and its signature is verified
 * against the provider's published JWKS.
 */

const FETCH_TIMEOUT_MS = 10_000;

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

export interface OidcClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  nonce?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  [key: string]: unknown;
}

interface Jwk {
  kty?: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

function base64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** Fetch and validate the provider's OIDC discovery document. */
export async function discover(issuer: string): Promise<OidcDiscovery> {
  const url = `${stripTrailingSlash(issuer)}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OIDC discovery failed (HTTP ${res.status})`);
  const doc = (await res.json()) as Partial<OidcDiscovery>;
  if (
    !doc.authorization_endpoint ||
    !doc.token_endpoint ||
    !doc.jwks_uri ||
    !doc.issuer
  ) {
    throw new Error('OIDC discovery document is missing required endpoints');
  }
  return doc as OidcDiscovery;
}

/** Exchange an authorization code for tokens (confidential client / Basic auth). */
export async function exchangeCode(
  disc: OidcDiscovery,
  opts: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  },
): Promise<{ id_token: string; access_token?: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
  });
  const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString(
    'base64',
  );
  const res = await fetch(disc.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      authorization: `Basic ${basic}`,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OIDC token exchange failed (HTTP ${res.status})`);
  const data = (await res.json()) as { id_token?: string; access_token?: string };
  if (!data.id_token) throw new Error('OIDC token response missing id_token');
  return { id_token: data.id_token, access_token: data.access_token };
}

/**
 * Verify an ID token against the provider's JWKS and validate the standard
 * claims (issuer, audience, expiry, nonce). Returns the decoded claims on
 * success; throws otherwise. Only RSA (RS256/384/512) signatures are supported.
 */
export async function verifyIdToken(
  idToken: string,
  disc: OidcDiscovery,
  opts: { clientId: string; nonce?: string },
): Promise<OidcClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed id_token');

  const header = JSON.parse(base64urlToBuffer(parts[0]).toString('utf8')) as {
    kid?: string;
    alg?: string;
  };
  const claims = JSON.parse(
    base64urlToBuffer(parts[1]).toString('utf8'),
  ) as OidcClaims;

  const alg = header.alg ?? 'RS256';
  if (!alg.startsWith('RS')) {
    throw new Error(`Unsupported id_token algorithm: ${alg}`);
  }

  const jwksRes = await fetch(disc.jwks_uri, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!jwksRes.ok) throw new Error(`JWKS fetch failed (HTTP ${jwksRes.status})`);
  const jwks = (await jwksRes.json()) as { keys?: Jwk[] };
  const keys = jwks.keys ?? [];
  const jwk =
    keys.find((k) => k.kty === 'RSA' && (!header.kid || k.kid === header.kid)) ??
    keys.find((k) => k.kty === 'RSA');
  if (!jwk) throw new Error('No matching RSA key in provider JWKS');

  const keyObject = createPublicKey({ key: jwk as never, format: 'jwk' });
  const hashAlg =
    alg === 'RS384'
      ? 'RSA-SHA384'
      : alg === 'RS512'
        ? 'RSA-SHA512'
        : 'RSA-SHA256';
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = base64urlToBuffer(parts[2]);
  if (!cryptoVerify(hashAlg, signingInput, keyObject, signature)) {
    throw new Error('id_token signature verification failed');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && claims.exp < now - 60) {
    throw new Error('id_token has expired');
  }
  if (stripTrailingSlash(claims.iss ?? '') !== stripTrailingSlash(disc.issuer)) {
    throw new Error('id_token issuer mismatch');
  }
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.clientId)) {
    throw new Error('id_token audience mismatch');
  }
  if (opts.nonce && claims.nonce !== opts.nonce) {
    throw new Error('id_token nonce mismatch');
  }

  return claims;
}

/** Cryptographically random hex token (used for state / nonce). */
export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

/** Split a display name into first/last parts (best-effort). */
export function splitName(name?: string): { first?: string; last?: string } {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return {};
  const idx = trimmed.indexOf(' ');
  if (idx < 0) return { first: trimmed };
  return { first: trimmed.slice(0, idx), last: trimmed.slice(idx + 1).trim() };
}
