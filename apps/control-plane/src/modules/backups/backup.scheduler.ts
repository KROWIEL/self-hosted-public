import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { backupSchedules } from '../../db/schema';
import { createRedisConnection } from '../services/deploy.constants';
import { BackupsService } from './backups.service';
import {
  BACKUP_QUEUE,
  BACKUP_QUEUE_NAME,
  BackupJobData,
} from './backup.constants';

type BackupKind = 'VOLUME' | 'DATABASE';

/**
 * Drives recurring backups via BullMQ repeatable jobs. The set of repeatable
 * jobs is rebuilt from the DB whenever schedules change (and on boot).
 */
@Injectable()
export class BackupScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupScheduler.name);
  private worker?: Worker<BackupJobData>;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(BACKUP_QUEUE) private readonly queue: Queue<BackupJobData>,
    private readonly backups: BackupsService,
  ) {}

  async onModuleInit() {
    this.worker = new Worker<BackupJobData>(
      BACKUP_QUEUE_NAME,
      (job) => this.process(job),
      { connection: createRedisConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Backup job ${job?.id} failed: ${err.message}`),
    );
    await this.sync().catch((e) =>
      this.logger.error(`Initial schedule sync failed: ${e.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  listSchedules(kind: BackupKind, refId: string) {
    return this.db
      .select()
      .from(backupSchedules)
      .where(
        and(eq(backupSchedules.kind, kind), eq(backupSchedules.refId, refId)),
      );
  }

  async createSchedule(dto: {
    kind: BackupKind;
    refId: string;
    cron: string;
    keepLast?: number;
  }) {
    const [row] = await this.db
      .insert(backupSchedules)
      .values({
        kind: dto.kind,
        refId: dto.refId,
        cron: dto.cron,
        keepLast: dto.keepLast ?? 7,
      })
      .returning();
    await this.sync();
    return row;
  }

  async removeSchedule(id: string) {
    await this.db.delete(backupSchedules).where(eq(backupSchedules.id, id));
    await this.sync();
    return { ok: true };
  }

  /** Rebuilds repeatable jobs from the enabled schedules in the DB. */
  private async sync() {
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }
    const rows = await this.db
      .select()
      .from(backupSchedules)
      .where(eq(backupSchedules.enabled, true));
    for (const row of rows) {
      await this.queue.add(
        'run',
        { scheduleId: row.id },
        { repeat: { pattern: row.cron }, jobId: `sched-${row.id}` },
      );
    }
  }

  private async process(job: Job<BackupJobData>) {
    const [schedule] = await this.db
      .select()
      .from(backupSchedules)
      .where(eq(backupSchedules.id, job.data.scheduleId))
      .limit(1);
    if (!schedule || !schedule.enabled) return;

    await this.backups.create(schedule.kind, schedule.refId);
    await this.backups.applyRetention(
      schedule.kind,
      schedule.refId,
      schedule.keepLast,
    );
  }
}
