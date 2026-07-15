import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, like, lte, type SQL } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { auditLogs } from '../../db/schema';

export interface AuditEntry {
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  projectId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
  status?: number | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Best-effort append; auditing must never break the request it observes. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        userId: entry.userId ?? null,
        userEmail: entry.userEmail ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        projectId: entry.projectId ?? null,
        meta: entry.meta ?? {},
        ip: entry.ip ?? null,
        status: entry.status ?? null,
      });
    } catch (e) {
      this.logger.warn(
        `audit write failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async list(opts: { projectId?: string; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? 200, 500);
    const base = this.db.select().from(auditLogs);
    const rows = opts.projectId
      ? await base
          .where(eq(auditLogs.projectId, opts.projectId))
          .orderBy(desc(auditLogs.createdAt))
          .limit(limit)
      : await base.orderBy(desc(auditLogs.createdAt)).limit(limit);
    return rows;
  }

  /**
   * Filtered read used by the Pro audit-export feature. Supports an action
   * prefix, a created-at range and a project scope, with a much higher row cap
   * than the on-screen viewer (bulk export).
   */
  async query(
    opts: {
      projectId?: string;
      action?: string;
      from?: Date;
      to?: Date;
      limit?: number;
    } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 5000, 1), 50_000);
    const conds: SQL[] = [];
    if (opts.projectId) conds.push(eq(auditLogs.projectId, opts.projectId));
    if (opts.action) conds.push(like(auditLogs.action, `${opts.action}%`));
    if (opts.from && !Number.isNaN(opts.from.getTime())) {
      conds.push(gte(auditLogs.createdAt, opts.from));
    }
    if (opts.to && !Number.isNaN(opts.to.getTime())) {
      conds.push(lte(auditLogs.createdAt, opts.to));
    }
    const where = conds.length ? and(...conds) : undefined;
    const base = this.db.select().from(auditLogs);
    return where
      ? await base.where(where).orderBy(desc(auditLogs.createdAt)).limit(limit)
      : await base.orderBy(desc(auditLogs.createdAt)).limit(limit);
  }
}
