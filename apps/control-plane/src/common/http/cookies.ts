import type { Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * HttpOnly-cookie session transport (H-1). The panel SPA no longer keeps raw
 * JWTs in JavaScript: on login/refresh the control plane sets the access and
 * refresh tokens as HttpOnly cookies (so XSS can't read them) plus a readable
 * `csrf` cookie for double-submit CSRF protection. PATs/CLI keep using the
 * `Authorization: Bearer` header, which the strategies still accept as a
 * fallback.
 */
export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
/** Readable-by-JS token echoed back in the `x-csrf-token` header (double-submit). */
export const CSRF_COOKIE = 'csrf';
export const CSRF_HEADER = 'x-csrf-token';

/**
 * The refresh cookie is scoped to the refresh endpoint only, so it is never sent
 * on ordinary API calls (smaller attack surface, not exposed to every handler).
 * Must include the global `api/v1` prefix.
 */
export const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';

/** Default access/refresh lifetimes, mirrored from the JWT expiry envs. */
const DEFAULT_ACCESS_MS = 15 * 60 * 1000;
const DEFAULT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Parse a JWT-style duration ("15m", "7d", "900s", "1h30m") or a bare number of
 * seconds into milliseconds, falling back to `def` on anything unrecognized.
 */
export function parseDurationMs(value: string | undefined, def: number): number {
  if (!value) return def;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000; // bare seconds
  const re = /(\d+)\s*(ms|s|m|h|d|w|y)/gi;
  const unit: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    y: 31_536_000_000,
  };
  let total = 0;
  let matched = false;
  for (const m of v.matchAll(re)) {
    matched = true;
    total += Number(m[1]) * unit[m[2].toLowerCase()];
  }
  return matched && total > 0 ? total : def;
}

function accessMaxAge(): number {
  return parseDurationMs(process.env.JWT_EXPIRES_IN, DEFAULT_ACCESS_MS);
}

function refreshMaxAge(): number {
  return parseDurationMs(process.env.JWT_REFRESH_EXPIRES_IN, DEFAULT_REFRESH_MS);
}

/** True when the request reached us over HTTPS (directly or via a proxy). */
export function isHttps(req: Request): boolean {
  const xf = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return xf === 'https' || req.protocol === 'https';
}

/**
 * Minimal `Cookie:` header parser (cookie-parser isn't a dependency). Returns
 * the value of the named cookie, or undefined if absent.
 */
export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

/** A fresh, URL-safe CSRF token value. */
export function newCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Sets the access + refresh + csrf cookies for a freshly issued session. The
 * access and refresh tokens are HttpOnly (unreadable by JS); the csrf token is
 * readable so the SPA can echo it back in the `x-csrf-token` header. `Secure` is
 * derived from the request scheme so local http dev keeps working while any TLS
 * deployment gets Secure cookies automatically. Reuses an existing csrf value
 * when the caller already has one so a refresh doesn't rotate it needlessly.
 */
export function setSessionCookies(
  req: Request,
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  const secure = isHttps(req);
  const sameSite = 'lax' as const;
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: accessMaxAge(),
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite,
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshMaxAge(),
  });
  const csrf = readCookie(req.headers.cookie, CSRF_COOKIE) ?? newCsrfToken();
  res.cookie(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure,
    sameSite,
    path: '/',
    maxAge: refreshMaxAge(),
  });
}

/** Clears every session cookie (logout / failed refresh). */
export function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

/**
 * Constant-time comparison of two (possibly undefined) strings. Used for the
 * CSRF double-submit check so a mismatch length/timing can't be probed.
 */
export function safeStrEqual(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
