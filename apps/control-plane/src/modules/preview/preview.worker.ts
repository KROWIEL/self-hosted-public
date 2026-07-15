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
import { PreviewService } from './preview.service';
import {
  PREVIEW_QUEUE,
  PREVIEW_QUEUE_NAME,
  PreviewJobData,
} from './preview.constants';

/**
 * Periodically tears down expired preview environments. Runs as a BullMQ
 * repeatable job; no-ops unless the `preview-envs` module is licensed.
 */
@Injectable()
export class PreviewWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PreviewWorker.name);
  private worker?: Worker<PreviewJobData>;
  private readonly intervalMs = numFromEnv(
    'PREVIEW_CLEANUP_INTERVAL_MS',
    15 * 60_000,
  );

  constructor(
    @Inject(PREVIEW_QUEUE) private readonly queue: Queue<PreviewJobData>,
    private readonly preview: PreviewService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async onModuleInit() {
    this.worker = new Worker<PreviewJobData>(
      PREVIEW_QUEUE_NAME,
      () => this.run(),
      { connection: createRedisConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Preview cleanup ${job?.id} failed: ${err.message}`),
    );
    await this.sync().catch((e) =>
      this.logger.error(`Preview schedule sync failed: ${e.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async sync() {
    const existing = await this.queue.getRepeatableJobs();
    for (const j of existing) await this.queue.removeRepeatableByKey(j.key);
    await this.queue.add(
      'cleanup',
      {},
      { repeat: { every: this.intervalMs }, jobId: 'preview-cleanup' },
    );
  }

  private async run() {
    if (!(await this.entitlements.hasModule('preview-envs'))) return;
    const removed = await this.preview.cleanupExpired().catch((e) => {
      this.logger.error(`Preview cleanup failed: ${(e as Error).message}`);
      return 0;
    });
    if (removed > 0) {
      this.logger.log(`Tore down ${removed} expired preview environment(s).`);
    }
  }
}

function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
