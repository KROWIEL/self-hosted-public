import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
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
}
