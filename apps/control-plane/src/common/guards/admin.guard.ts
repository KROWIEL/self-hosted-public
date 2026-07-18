import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { CommonErrors } from '../errors/app-errors';

/**
 * Platform-admin gate for infrastructure-level controllers (nodes, tunnels,
 * metrics, global git credentials, …). Mirrors the inline
 * `if (req.user.role !== 'ADMIN') throw CommonErrors.adminOnly()` check used by
 * sibling controllers, but as a reusable class-level guard.
 *
 * Must run AFTER `JwtAuthGuard` (which populates `req.user`) — list it second
 * in `@UseGuards(JwtAuthGuard, AdminGuard, …)`.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<{ user?: { role?: string } }>();
    if (req.user?.role !== 'ADMIN') {
      throw CommonErrors.adminOnly();
    }
    return true;
  }
}
