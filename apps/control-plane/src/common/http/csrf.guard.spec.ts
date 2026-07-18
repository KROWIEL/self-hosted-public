import type { ExecutionContext } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';

function httpCtx(req: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

/** Build a minimal Express-like request. */
function req(opts: {
  method?: string;
  cookie?: string;
  auth?: string;
  csrfHeader?: string;
  url?: string;
}): Record<string, unknown> {
  const headers: Record<string, unknown> = {};
  if (opts.cookie) headers['cookie'] = opts.cookie;
  if (opts.auth) headers['authorization'] = opts.auth;
  if (opts.csrfHeader !== undefined) headers['x-csrf-token'] = opts.csrfHeader;
  return {
    method: opts.method ?? 'GET',
    headers,
    originalUrl: opts.url ?? '/api/v1/projects',
    url: opts.url ?? '/api/v1/projects',
  };
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();

  it('allows safe methods', () => {
    expect(guard.canActivate(httpCtx(req({ method: 'GET' })))).toBe(true);
    expect(guard.canActivate(httpCtx(req({ method: 'HEAD' })))).toBe(true);
    expect(guard.canActivate(httpCtx(req({ method: 'OPTIONS' })))).toBe(true);
  });

  it('allows Bearer (PAT/CLI) requests without a CSRF header', () => {
    const r = req({ method: 'POST', auth: 'Bearer shpat_abc' });
    expect(guard.canActivate(httpCtx(r))).toBe(true);
  });

  it('allows cookie-less requests (not cookie-authenticated)', () => {
    const r = req({ method: 'POST' });
    expect(guard.canActivate(httpCtx(r))).toBe(true);
  });

  it('allows a cookie-authed mutation with a matching CSRF header', () => {
    const r = req({
      method: 'POST',
      cookie: 'access_token=jwt; csrf=tok123',
      csrfHeader: 'tok123',
    });
    expect(guard.canActivate(httpCtx(r))).toBe(true);
  });

  it('rejects a cookie-authed mutation with a missing CSRF header', () => {
    const r = req({ method: 'POST', cookie: 'access_token=jwt; csrf=tok123' });
    expect(() => guard.canActivate(httpCtx(r))).toThrow();
  });

  it('rejects a cookie-authed mutation with a mismatched CSRF header', () => {
    const r = req({
      method: 'POST',
      cookie: 'access_token=jwt; csrf=tok123',
      csrfHeader: 'WRONG',
    });
    expect(() => guard.canActivate(httpCtx(r))).toThrow();
  });

  it('exempts login/register/refresh even when cookie-authed', () => {
    for (const url of [
      '/api/v1/auth/login',
      '/api/v1/auth/register',
      '/api/v1/auth/refresh',
    ]) {
      const r = req({ method: 'POST', cookie: 'access_token=jwt; csrf=x', url });
      expect(guard.canActivate(httpCtx(r))).toBe(true);
    }
  });
});
