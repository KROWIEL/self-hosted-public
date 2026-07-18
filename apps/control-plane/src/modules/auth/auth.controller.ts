import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { OnboardingDto } from './dto/onboarding.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Enable2faDto } from './dto/enable-2fa.dto';
import { Disable2faDto } from './dto/disable-2fa.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  REFRESH_COOKIE,
  clearSessionCookies,
  readCookie,
  setSessionCookies,
} from '../../common/http/cookies';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Brute-force sensitive: cap credential/2FA attempts tightly per client IP.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    // H-1: put the tokens in HttpOnly cookies; the JSON body carries only the
    // minimal flags the SPA needs to route (no raw JWTs reach JavaScript).
    const { accessToken, refreshToken, ...rest } = await this.auth.login(dto);
    setSessionCookies(req, res, { accessToken, refreshToken });
    return rest;
  }

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, ...rest } =
      await this.auth.register(dto);
    setSessionCookies(req, res, { accessToken, refreshToken });
    return rest;
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  async refresh(
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
    @Body('refreshToken') bodyRefreshToken?: string,
  ) {
    // Prefer the HttpOnly refresh cookie; fall back to the body for any
    // non-browser client that still posts the token explicitly.
    const token =
      readCookie(req.headers.cookie, REFRESH_COOKIE) ?? bodyRefreshToken;
    const { accessToken, refreshToken } = await this.auth.refresh(token ?? '');
    setSessionCookies(req, res, { accessToken, refreshToken });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  setup2fa(@Request() req: { user: { id: string } }) {
    return this.auth.begin2fa(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('onboarding')
  onboarding(
    @Request() req: { user: { id: string } },
    @Body() dto: OnboardingDto,
  ) {
    return this.auth.completeOnboarding(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('password')
  changePassword(
    @Request() req: { user: { id: string } },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(req.user.id, dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  enable2fa(
    @Request() req: { user: { id: string } },
    @Body() dto: Enable2faDto,
  ) {
    return this.auth.enable2fa(req.user.id, dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  disable2fa(
    @Request() req: { user: { id: string } },
    @Body() dto: Disable2faDto,
  ) {
    return this.auth.disable2fa(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @Request() req: { user: { id: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    // Bump the session epoch (invalidates every issued token) AND drop the
    // browser's cookies so the tab is signed out immediately.
    const result = await this.auth.logout(req.user.id);
    clearSessionCookies(res);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Request() req: { user: { id: string } }) {
    return this.auth.me(req.user.id);
  }
}
