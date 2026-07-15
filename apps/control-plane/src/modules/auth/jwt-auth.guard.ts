import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { ApiTokenService } from '../api-tokens/api-token.service';
import { API_TOKEN_PREFIX } from '../api-tokens/api-tokens.constants';

/**
 * Accepts either a normal JWT (session) or a personal API token (Pro: api-cli).
 * A `Bearer shpat_…` value is validated against stored token hashes; anything
 * else falls through to the standard passport-jwt strategy.
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
        const user = await this.apiTokens.validateRaw(token);
        if (!user) throw new UnauthorizedException('Invalid or expired API token');
        (req as Request & { user: unknown }).user = user;
        return true;
      }
    }
    return (await super.canActivate(context)) as boolean;
  }
}
