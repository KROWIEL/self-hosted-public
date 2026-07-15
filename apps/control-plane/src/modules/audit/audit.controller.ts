import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { MemberRole } from '@selfhosted/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectRole } from '../../common/rbac/project-role.decorator';
import { ProjectRolesGuard } from '../../common/rbac/project-roles.guard';
import { ModuleGuard } from '../../common/licensing/module.guard';
import { RequiresModule } from '../../common/licensing/require-module.decorator';
import { AuditService } from './audit.service';

@UseGuards(JwtAuthGuard, ProjectRolesGuard)
@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Platform-wide trail — restricted to global admins. */
  @Get('audit')
  all(@Request() req: { user: { role: string } }) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
    return this.audit.list({});
  }

  /**
   * Bulk export of the platform-wide trail as CSV or JSON (Pro: audit-export).
   * Global-admin only; supports action-prefix + created-at range filters.
   */
  @Get('audit/export')
  @UseGuards(ModuleGuard)
  @RequiresModule('audit-export')
  async export(
    @Res() res: Response,
    @Request() req: { user: { role: string } },
    @Query('format') format?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
    const rows = await this.audit.query({
      action: action?.trim() || undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    const stamp = new Date().toISOString().slice(0, 10);

    if ((format ?? 'csv').toLowerCase() === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="audit-${stamp}.json"`,
      );
      res.send(JSON.stringify(rows, null, 2));
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-${stamp}.csv"`,
    );
    // Prepend a UTF-8 BOM so Excel opens Cyrillic content correctly.
    res.send('\uFEFF' + toCsv(rows));
  }

  /** Per-project trail — visible to project admins/owner. */
  @Get('projects/:projectId/audit')
  @ProjectRole(MemberRole.ADMIN, 'project', 'projectId')
  forProject(@Param('projectId') projectId: string) {
    return this.audit.list({ projectId });
  }
}

const CSV_COLUMNS = [
  'createdAt',
  'userEmail',
  'action',
  'targetType',
  'targetId',
  'projectId',
  'ip',
  'status',
  'meta',
] as const;

function csvCell(value: unknown): string {
  const s =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  const header = CSV_COLUMNS.join(',');
  const lines = rows.map((r) =>
    CSV_COLUMNS.map((c) => csvCell(r[c])).join(','),
  );
  return [header, ...lines].join('\r\n') + '\r\n';
}
