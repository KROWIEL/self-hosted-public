import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthErrors } from '../errors/app-errors';
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  readCookie,
  safeStrEqual,
} from './cookies';

/** State-changing methods that require the double-submit CSRF check. */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Endpoints that legitimately mutate state before a CSRF token can exist (or
 * that authenticate via the HttpOnly refresh cookie rather than the access
 * cookie). Matched by path suffix so the global `api/v1` prefix is irrelevant.
 */
const EXEMPT_SUFFIXES = ['/auth/login', '/auth/register', '/auth/refresh'];

/** Prefixes for unauthenticated provider webhooks (HMAC/token auth, no CSRF). */
const EXEMPT_INCLUDES = ['/webhooks/'];

/**
 * Double-submit CSRF protection (H-1) for cookie-authenticated browser
 * requests. Rationale: an HttpOnly session cookie is sent automatically by the
 * browser, so a cross-site form/fetch could ride it. We defend by also
 * requiring a header (`x-csrf-token`) that echoes a readable `csrf` cookie —
 * something a cross-origin attacker cannot read or set.
 *
 * The check is deliberately scoped so it never breaks non-browser clients:
 *  - skipped for safe methods (GET/HEAD/OPTIONS);
 *  - skipped for `Authorization: Bearer` requests (PAT/CLI/Bearer JWT), which
 *    are immune to CSRF because the browser never attaches those automatically;
 *  - skipped when there is no access-token cookie (i.e. not cookie-authed);
 *  - skipped for login/register/refresh.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();

    const method = (req.method ?? 'GET').toUpperCase();
    if (!MUTATING.has(method)) return true;

    // Header-authenticated requests (PATs / CLI / Bearer JWT) aren't cookie
    // rides — the browser never sends the Authorization header on its own.
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) return true;

    // Only cookie-authenticated requests are exposed to CSRF.
    const accessCookie = readCookie(req.headers.cookie, ACCESS_COOKIE);
    if (!accessCookie) return true;

    const path = (req.originalUrl || req.url || '').split('?')[0];
    if (EXEMPT_SUFFIXES.some((p) => path.endsWith(p))) return true;
    if (EXEMPT_INCLUDES.some((p) => path.includes(p))) return true;

    const cookie = readCookie(req.headers.cookie, CSRF_COOKIE);
    const raw = req.headers[CSRF_HEADER];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!safeStrEqual(header, cookie)) {
      throw AuthErrors.csrfInvalid();
    }
    return true;
  }
}
