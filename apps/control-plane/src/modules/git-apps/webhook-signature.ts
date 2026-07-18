import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verify GitHub's `X-Hub-Signature-256` header (`sha256=<hex>`) against the
 * raw request body and the shared webhook secret.
 */
export function verifyGithubSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected =
    'sha256=' +
    createHmac('sha256', secret)
      .update(typeof rawBody === 'string' ? rawBody : rawBody)
      .digest('hex');
  return safeEqual(signatureHeader, expected);
}

/**
 * Verify GitLab's `X-Gitlab-Token` header against the shared webhook secret
 * (plain token compare, timing-safe).
 */
export function verifyGitlabToken(
  tokenHeader: string | undefined,
  secret: string,
): boolean {
  if (!tokenHeader || !secret) return false;
  return safeEqual(tokenHeader, secret);
}
