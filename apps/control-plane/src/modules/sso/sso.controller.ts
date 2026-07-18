import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ModuleGuard } from '../../common/licensing/module.guard';
import { RequiresModule } from '../../common/licensing/require-module.decorator';
import { SsoService, ReqLike } from './sso.service';
import { SetSsoConfigDto } from './dto/sso.dto';
import { setSessionCookies } from '../../common/http/cookies';

/** HttpOnly cookie that binds the OIDC state to the browser (anti login-CSRF). */
const SSO_STATE_COOKIE = 'sso_state';
const SSO_COOKIE_PATH = '/api/v1/auth/sso';
const SSO_STATE_TTL_MS = 10 * 60 * 1000;

@Controller('auth/sso')
export class SsoController {
  constructor(private readonly sso: SsoService) {}

  private assertAdmin(req: { user?: { role?: string } }) {
    if (req.user?.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  }

  /** True when the request reached us over HTTPS (directly or via a proxy). */
  private isHttps(req: Request): boolean {
    const xf = String(req.headers['x-forwarded-proto'] ?? '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    return xf === 'https' || req.protocol === 'https';
  }

  /** Public: the login page calls this to decide whether to show the button. */
  @Get('status')
  status() {
    return this.sso.status();
  }

  /** Public: begins the OIDC flow by redirecting to the provider. */
  @Get('start')
  async start(@Req() req: Request, @Res() res: Response) {
    const { url, csrf } = await this.sso.buildAuthUrl(req as unknown as ReqLike);
    res.cookie(SSO_STATE_COOKIE, csrf, {
      httpOnly: true,
      secure: this.isHttps(req),
      sameSite: 'lax',
      path: SSO_COOKIE_PATH,
      maxAge: SSO_STATE_TTL_MS,
    });
    res.redirect(url);
  }

  /** Public: provider redirects back here; we finish and bounce to the web app. */
  @Get('callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const cookieCsrf = readCookie(req.headers.cookie, SSO_STATE_COOKIE);
    const result = await this.sso.handleCallback(
      req as unknown as ReqLike,
      { code, state, error },
      cookieCsrf,
    );
    // One-time use: clear the binding cookie regardless of outcome.
    res.clearCookie(SSO_STATE_COOKIE, { path: SSO_COOKIE_PATH });
    // On success set the session as HttpOnly cookies (H-1) — no tokens in the
    // redirect URL — then bounce to the dashboard.
    if (result.ok) setSessionCookies(req, res, result.tokens);
    res.redirect(result.redirect);
  }

  @Get('config')
  @UseGuards(JwtAuthGuard, ModuleGuard)
  @RequiresModule('sso')
  getConfig(@Req() req: ReqLike & { user?: { role?: string } }) {
    this.assertAdmin(req);
    return this.sso.getConfig(req);
  }

  @Put('config')
  @UseGuards(JwtAuthGuard, ModuleGuard)
  @RequiresModule('sso')
  async setConfig(
    @Req() req: ReqLike & { user?: { role?: string } },
    @Body() dto: SetSsoConfigDto,
  ) {
    this.assertAdmin(req);
    await this.sso.setConfig(dto);
    return this.sso.getConfig(req);
  }
}

/**
 * Minimal Cookie-header parser (cookie-parser isn't installed). Returns the
 * value of the named cookie, or undefined if absent.
 */
function readCookie(
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
