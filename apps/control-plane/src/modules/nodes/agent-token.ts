import { createHmac } from 'node:crypto';

/**
 * Lifetime of a CP->agent request token. Authentication happens once, when the
 * request/stream is established, so a short window comfortably covers even long
 * build streams while keeping a leaked token near-worthless. The agent verifies
 * with a small clock-skew leeway.
 */
export const AGENT_REQUEST_TOKEN_TTL_MS = 120_000;

/** Minimum agent version that verifies signed request tokens + supports rotation. */
const SIGNED_TOKEN_MIN_VERSION = [0, 3, 0] as const;

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/**
 * Mints a short-lived HS256 request token for a node agent. The signing key is
 * the per-node shared daemon secret established at enrollment (used as its raw
 * UTF-8 bytes), so the agent verifies it with material it already holds — no new
 * key exchange. The token carries an expiry and the node id as its audience so
 * it cannot be replayed against a different node.
 */
export function signAgentRequestToken(
  secret: string,
  nodeId: string,
  ttlMs: number = AGENT_REQUEST_TOKEN_TTL_MS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: 'selfhosted-cp',
      aud: nodeId,
      iat: now,
      exp: now + Math.ceil(ttlMs / 1000),
    }),
  );
  const signingInput = `${header}.${payload}`;
  const sig = createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${sig}`;
}

function parseVersion(v: string | null | undefined): number[] | null {
  if (!v) return null;
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Whether an agent of the reported version verifies signed request tokens. Used
 * to gate minting: unknown or older agents receive the raw daemon token so
 * already-enrolled nodes never lock out (back-compat). Conservative by design —
 * we only send a signed token when we are confident the agent understands it.
 */
export function agentSupportsSignedTokens(
  agentVersion: string | null | undefined,
): boolean {
  const v = parseVersion(agentVersion);
  if (!v) return false;
  for (let i = 0; i < 3; i++) {
    if (v[i] > SIGNED_TOKEN_MIN_VERSION[i]) return true;
    if (v[i] < SIGNED_TOKEN_MIN_VERSION[i]) return false;
  }
  return true;
}
