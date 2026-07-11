import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import {
  ProjectResolver,
  ResolveKind,
} from '../members/project-resolver.service';

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Controller name (minus "Controller", lowercased) → resolvable entity kind. */
const CONTROLLER_KIND: Record<string, ResolveKind> = {
  services: 'service',
  projects: 'project',
  databases: 'database',
  backups: 'backup',
};

/**
 * Records every mutating request into the audit log with the acting user, the
 * affected project (best-effort) and the resulting HTTP status. Never stores
 * request bodies, so secrets don't leak into the trail.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly resolver: ProjectResolver,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: { id: string; email: string } }>();
    if (!MUTATIONS.has(req.method)) return next.handle();

    const controller = ctx
      .getClass()
      .name.replace(/Controller$/, '')
      .toLowerCase();
    const handler = ctx.getHandler().name;
    const params = (req.params ?? {}) as Record<string, string>;
    const targetId =
      params.id ??
      params.serviceId ??
      params.deploymentId ??
      params.projectId ??
      params.userId ??
      null;

    const write = (status: number, projectId: string | null) =>
      void this.audit.record({
        userId: req.user?.id ?? null,
        userEmail: req.user?.email ?? null,
        action: `${controller}.${handler}`,
        targetType: controller,
        targetId,
        projectId,
        ip: req.ip ?? null,
        status,
        meta: { method: req.method, path: req.originalUrl?.split('?')[0] },
      });

    // Resolve the project up-front so DELETEs still capture it before the row
    // disappears. Promise resolves to null when it can't be determined.
    const projectIdP = this.resolveProject(controller, params);

    const res = ctx.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap(() => void projectIdP.then((pid) => write(res.statusCode, pid))),
      catchError((err: unknown) => {
        const status =
          typeof (err as { status?: number })?.status === 'number'
            ? (err as { status: number }).status
            : 500;
        void projectIdP.then((pid) => write(status, pid));
        throw err;
      }),
    );
  }

  private async resolveProject(
    controller: string,
    params: Record<string, string>,
  ): Promise<string | null> {
    if (params.projectId) return params.projectId;
    const kind = CONTROLLER_KIND[controller];
    const id = params.id;
    if (!kind || !id) return null;
    try {
      return await this.resolver.resolve(kind, id);
    } catch {
      return null;
    }
  }
}
