import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { EntitlementsService } from '../../common/licensing/entitlements.service';
import { createRedisConnection } from '../services/deploy.constants';
import { OffsiteService } from './offsite.service';
import {
  OFFSITE_QUEUE,
  OFFSITE_QUEUE_NAME,
  OffsiteJobData,
} from './offsite.constants';

/**
 * Periodically mirrors new local backups to the offsite destination. Runs as a
 * BullMQ repeatable job so it survives restarts; no-ops unless the
 * `offsite-backups` module is licensed and a destination is enabled.
 */
@Injectable()
export class OffsiteWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OffsiteWorker.name);
  private worker?: Worker<OffsiteJobData>;
  private readonly intervalMs = numFromEnv(
    'OFFSITE_SYNC_INTERVAL_MS',
    10 * 60_000,
  );

  constructor(
    @Inject(OFFSITE_QUEUE) private readonly queue: Queue<OffsiteJobData>,
    private readonly offsite: OffsiteService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async onModuleInit() {
    this.worker = new Worker<OffsiteJobData>(
      OFFSITE_QUEUE_NAME,
      () => this.run(),
      { connection: createRedisConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Offsite job ${job?.id} failed: ${err.message}`),
    );
    await this.sync().catch((e) =>
      this.logger.error(`Offsite schedule sync failed: ${e.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async sync() {
    const existing = await this.queue.getRepeatableJobs();
    for (const j of existing) await this.queue.removeRepeatableByKey(j.key);
    await this.queue.add(
      'sync',
      {},
      { repeat: { every: this.intervalMs }, jobId: 'offsite-sync' },
    );
  }

  private async run() {
    if (!(await this.entitlements.hasModule('offsite-backups'))) return;
    const res = await this.offsite.uploadPending();
    if (res.uploaded || res.failed) {
      this.logger.log(
        `Offsite sync: ${res.uploaded} uploaded, ${res.failed} failed`,
      );
    }
  }
}

function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
