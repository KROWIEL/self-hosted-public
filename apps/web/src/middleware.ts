import { NextRequest, NextResponse } from 'next/server';

/**
 * Content-Security-Policy is emitted here (not in next.config.js) because the
 * app-router serves inline bootstrap/flight scripts (`self.__next_f.push(...)`)
 * that must be allowlisted. A static `headers()` policy can only use
 * `script-src 'self'`, which blocks those inline scripts and prevents React
 * from hydrating. Middleware runs per request, so it can mint a fresh nonce,
 * hand it to Next (via the request `content-security-policy`/`x-nonce` headers
 * so Next stamps it onto every `<script>` tag it renders) and send the matching
 * policy to the browser. This is the official Next.js nonce pattern.
 */

/**
 * Derive the API origins (http(s) + matching ws(s)) from NEXT_PUBLIC_API_URL so
 * both fetch() calls and the interactive-exec WebSocket are allowed by
 * connect-src. Falls back to the app default (localhost:3001) when unset — the
 * same default used by src/lib/api.ts. Uses the identical origin/ws derivation
 * as next.config.js. Returns [] only when the URL is unparseable.
 */
function apiConnectSrc(): string[] {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
  try {
    const u = new URL(raw);
    const wsScheme = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return [u.origin, `${wsScheme}//${u.host}`];
  } catch {
    return [];
  }
}

function contentSecurityPolicy(nonce: string): string {
  const isProd = process.env.NODE_ENV === 'production';
  const connectSrc = ["'self'", ...apiConnectSrc()].join(' ');

  // Production locks scripts to the per-request nonce; 'strict-dynamic' lets the
  // nonce'd bootstrap script load Next's other chunks. Dev needs 'unsafe-eval'
  // and 'unsafe-inline' for HMR / React Refresh (no nonce in dev).
  const scriptSrc = isProd
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    `connect-src ${connectSrc}`,
    "font-src 'self' data:",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);

  // Next reads the nonce from the incoming request's CSP header (and x-nonce)
  // and injects it into the inline <script> tags it renders.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Send the same policy to the browser. The other baseline security headers
  // (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS) stay in
  // next.config.js so they cover every route, including API and static assets
  // that this middleware intentionally skips.
  response.headers.set('content-security-policy', csp);

  return response;
}

export const config = {
  // Apply to every page route; skip API routes and Next's static/image assets.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
