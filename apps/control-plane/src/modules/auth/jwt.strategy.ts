import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type JwtFromRequestFunction } from 'passport-jwt';
import type { Request } from 'express';
import { ACCESS_COOKIE, readCookie } from '../../common/http/cookies';
import { UsersService } from '../users/users.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  /** Session epoch the token was signed with; must match the user's current one. */
  tv?: number;
}

/**
 * Read the access-token signing secret, failing closed if it is unset. There is
 * deliberately no hardcoded fallback — a missing secret must abort startup
 * (see validate-env.ts, which also rejects weak/default values).
 */
function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

/**
 * Extract the access token from the HttpOnly `access_token` cookie first (H-1:
 * browser sessions), then fall back to the `Authorization: Bearer` header so
 * PATs and the CLI keep working unchanged.
 */
const fromCookieOrHeader: JwtFromRequestFunction = (req: Request) => {
  const fromCookie = readCookie(req?.headers?.cookie, ACCESS_COOKIE);
  if (fromCookie) return fromCookie;
  return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly users: UsersService) {
    super({
      jwtFromRequest: fromCookieOrHeader,
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    // Reject tokens minted before the account's session epoch was bumped
    // (password change, 2FA disable, logout). Also rejects pre-upgrade tokens
    // that carry no `tv` claim.
    if (payload.tv !== user.tokenVersion) {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };
  }
}
