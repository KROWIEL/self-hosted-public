import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { MembersService, Actor } from '../../modules/members/members.service';
import { ProjectResolver } from '../../modules/members/project-resolver.service';
import { PROJECT_ROLE_KEY, ProjectRoleMeta } from './project-role.decorator';

/**
 * Enforces per-project role requirements declared via @ProjectRole. Runs after
 * JwtAuthGuard, so req.user is populated. Endpoints without the decorator are
 * unaffected.
 */
@Injectable()
export class ProjectRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly members: MembersService,
    private readonly resolver: ProjectResolver,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<ProjectRoleMeta | undefined>(
      PROJECT_ROLE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!meta) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: Actor }>();
    const actor = req.user;
    if (!actor) return false;

    const idParam = meta.param ?? 'id';
    const raw = (req.params as Record<string, string | string[]>)?.[idParam];
    const id = Array.isArray(raw) ? raw[0] : raw;
    if (!id) {
      throw new BadRequestException(`Missing route param "${idParam}"`);
    }

    const projectId = await this.resolver.resolve(meta.kind, id);
    await this.members.assertRole(actor, projectId, meta.min);
    return true;
  }
}
