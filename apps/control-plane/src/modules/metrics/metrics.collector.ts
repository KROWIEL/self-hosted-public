import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { DRIZZLE, Database } from '../../db/database.module';
import { nodes } from '../../db/schema';
import { EntitlementsService } from '../../common/licensing/entitlements.service';
import { createRedisConnection } from '../services/deploy.constants';
import { MetricsService } from './metrics.service';
import {
  METRICS_QUEUE,
  METRICS_QUEUE_NAME,
  MetricsJobData,
} from './metrics.constants';

/**
 * Periodically samples every node's host metrics into the time-series table and
 * prunes old data. Runs as a BullMQ repeatable job; no-ops unless the
 * `metrics-history` module is licensed.
 */
@Injectable()
export class MetricsCollector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsCollector.name);
  private worker?: Worker<MetricsJobData>;
  private readonly intervalMs = numFromEnv('METRICS_SAMPLE_INTERVAL_MS', 5 * 60_000);
  private readonly retentionMs = numFromEnv(
    'METRICS_RETENTION_MS',
    30 * 24 * 60 * 60_000,
  );

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(METRICS_QUEUE) private readonly queue: Queue<MetricsJobData>,
    private readonly metrics: MetricsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async onModuleInit() {
    this.worker = new Worker<MetricsJobData>(
      METRICS_QUEUE_NAME,
      () => this.run(),
      { connection: createRedisConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Metrics job ${job?.id} failed: ${err.message}`),
    );
    await this.sync().catch((e) =>
      this.logger.error(`Metrics schedule sync failed: ${e.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async sync() {
    const existing = await this.queue.getRepeatableJobs();
    for (const j of existing) await this.queue.removeRepeatableByKey(j.key);
    await this.queue.add(
      'sample',
      {},
      { repeat: { every: this.intervalMs }, jobId: 'metrics-sample' },
    );
  }

  private async run() {
    if (!(await this.entitlements.hasModule('metrics-history'))) return;
    const rows = await this.db.select().from(nodes);
    for (const node of rows) {
      try {
        await this.metrics.sample(node);
      } catch {
        // Node unreachable — skip this cycle.
      }
    }
    await this.metrics.prune(this.retentionMs).catch(() => undefined);
  }
}

function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
