import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { AuthErrors } from '../../common/errors/app-errors';
import { ApiTokenService } from '../api-tokens/api-token.service';
import {
  API_TOKEN_PREFIX,
  MUTATING_METHODS,
} from '../api-tokens/api-tokens.constants';

/**
 * Accepts either a normal JWT (session) or a personal API token (Pro: api-cli).
 * A `Bearer shpat_…` value is validated against stored token hashes; anything
 * else falls through to the standard passport-jwt strategy.
 *
 * PAT scopes (M4) are enforced here so every downstream authz check sees a
 * correctly-restricted principal:
 *  - a `read`-only token is rejected on mutating HTTP methods; and
 *  - a token without the `admin` scope has its effective role forced down to
 *    USER, so both `AdminGuard` and the inline `role !== 'ADMIN'` checks reject
 *    it even when the owning user is an administrator.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly apiTokens: ApiTokenService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      if (token.startsWith(API_TOKEN_PREFIX)) {
        const resolved = await this.apiTokens.validateRaw(token);
        if (!resolved) {
          throw new UnauthorizedException('Invalid or expired API token');
        }
        const { user, scopes } = resolved;
        // read-only tokens cannot mutate state.
        if (!scopes.includes('full') && MUTATING_METHODS.has(req.method)) {
          throw AuthErrors.tokenReadOnly();
        }
        // admin routes require the explicit `admin` scope; without it, present
        // the principal as a regular USER regardless of their stored role.
        const effectiveRole = scopes.includes('admin') ? user.role : 'USER';
        const reqx = req as Request & {
          user: unknown;
          authScopes?: string[];
        };
        reqx.user = { ...user, role: effectiveRole };
        reqx.authScopes = scopes;
        return true;
      }
    }
    return (await super.canActivate(context)) as boolean;
  }
}
