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
import { createRedisConnection } from '../services/deploy.constants';
import { NodesService } from './nodes.service';
import {
  DAEMON_TOKEN_ROTATION_CHECK_MS,
  DAEMON_TOKEN_ROTATION_QUEUE,
  DAEMON_TOKEN_ROTATION_QUEUE_NAME,
  DaemonTokenRotationJobData,
  isDueForDaemonTokenRotation,
  parseDaemonTokenRotationDays,
} from './daemon-token-rotation.constants';

/**
 * Periodically rotates long-lived daemon tokens for online nodes that have
 * reached `DAEMON_TOKEN_ROTATION_DAYS` since their last rotation (or creation).
 *
 * Reuses {@link NodesService.rotateDaemonToken} so the agent must confirm the
 * new secret before the panel switches — a failed push never locks a node out.
 * One node failing does not abort the rest of the cycle.
 *
 * Set `DAEMON_TOKEN_ROTATION_DAYS=0` to disable.
 */
@Injectable()
export class DaemonTokenRotationScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DaemonTokenRotationScheduler.name);
  private worker?: Worker<DaemonTokenRotationJobData>;
  private readonly intervalDays = parseDaemonTokenRotationDays(
    process.env.DAEMON_TOKEN_ROTATION_DAYS,
  );
  private readonly checkEveryMs = numFromEnv(
    'DAEMON_TOKEN_ROTATION_CHECK_MS',
    DAEMON_TOKEN_ROTATION_CHECK_MS,
  );

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(DAEMON_TOKEN_ROTATION_QUEUE)
    private readonly queue: Queue<DaemonTokenRotationJobData>,
    private readonly nodes: NodesService,
  ) {}

  async onModuleInit() {
    if (this.intervalDays <= 0) {
      this.logger.log(
        'Daemon token auto-rotation disabled (DAEMON_TOKEN_ROTATION_DAYS=0)',
      );
      // Clear any leftover repeatable jobs from a previous config.
      await this.clearRepeatable().catch((e) =>
        this.logger.warn(
          `Failed to clear daemon-token rotation jobs: ${(e as Error).message}`,
        ),
      );
      return;
    }

    this.logger.log(
      `Daemon token auto-rotation every ${this.intervalDays} day(s) (check every ${Math.round(this.checkEveryMs / 60_000)}m)`,
    );

    this.worker = new Worker<DaemonTokenRotationJobData>(
      DAEMON_TOKEN_ROTATION_QUEUE_NAME,
      () => this.run(),
      { connection: createRedisConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(
        `Daemon token rotation job ${job?.id} failed: ${err.message}`,
      ),
    );

    await this.sync().catch((e) =>
      this.logger.error(
        `Daemon token rotation schedule sync failed: ${(e as Error).message}`,
      ),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async clearRepeatable() {
    const existing = await this.queue.getRepeatableJobs();
    for (const j of existing) await this.queue.removeRepeatableByKey(j.key);
  }

  private async sync() {
    await this.clearRepeatable();
    await this.queue.add(
      'rotate',
      {},
      {
        repeat: { every: this.checkEveryMs },
        jobId: 'daemon-token-rotation',
      },
    );
  }

  /** Visible for tests. */
  async run() {
    if (this.intervalDays <= 0) return;

    const rows = await this.db.select().from(nodes);
    const now = Date.now();
    let attempted = 0;
    let rotated = 0;
    let failed = 0;

    for (const node of rows) {
      if (
        !isDueForDaemonTokenRotation(
          {
            status: node.status,
            daemonTokenPrev: node.daemonTokenPrev,
            daemonTokenRotatedAt: node.daemonTokenRotatedAt,
            createdAt: node.createdAt,
          },
          now,
          this.intervalDays,
        )
      ) {
        continue;
      }

      attempted += 1;
      try {
        await this.nodes.rotateDaemonToken(node.id);
        rotated += 1;
        this.logger.log(
          `Auto-rotated daemon token for node ${node.id} (${node.name})`,
        );
      } catch (e) {
        failed += 1;
        this.logger.warn(
          `Auto-rotate skipped/failed for node ${node.id} (${node.name}): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    if (attempted > 0) {
      this.logger.log(
        `Daemon token rotation cycle: ${rotated} rotated, ${failed} failed/skipped of ${attempted} due`,
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
