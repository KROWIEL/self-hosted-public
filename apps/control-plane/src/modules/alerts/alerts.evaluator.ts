import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { and, eq, gt, isNotNull, lt } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { alertRules, backups, deployments, nodes, services } from '../../db/schema';
import { EntitlementsService } from '../../common/licensing/entitlements.service';
import { createRedisConnection } from '../services/deploy.constants';
import { AlertsService } from './alerts.service';
import {
  ALERTS_QUEUE,
  ALERTS_QUEUE_NAME,
  AlertsJobData,
} from './alerts.constants';

/**
 * Periodically evaluates alert conditions (node offline / deploy failed /
 * backup failed) and dispatches notifications. Runs as a BullMQ repeatable job
 * so it survives restarts and doesn't duplicate across workers. Skips entirely
 * when the `alerts` module isn't licensed.
 */
@Injectable()
export class AlertsEvaluator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsEvaluator.name);
  private worker?: Worker<AlertsJobData>;

  private readonly intervalMs = numFromEnv('ALERTS_EVAL_INTERVAL_MS', 5 * 60_000);
  private readonly offlineMs = numFromEnv('ALERTS_NODE_OFFLINE_MS', 3 * 60_000);
  private readonly lookbackMs = numFromEnv(
    'ALERTS_LOOKBACK_MS',
    24 * 60 * 60_000,
  );

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(ALERTS_QUEUE) private readonly queue: Queue<AlertsJobData>,
    private readonly alerts: AlertsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async onModuleInit() {
    this.worker = new Worker<AlertsJobData>(
      ALERTS_QUEUE_NAME,
      () => this.evaluate(),
      { connection: createRedisConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Alerts job ${job?.id} failed: ${err.message}`),
    );
    await this.sync().catch((e) =>
      this.logger.error(`Alerts schedule sync failed: ${e.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  /** Rebuild the single repeatable evaluation job. */
  private async sync() {
    const existing = await this.queue.getRepeatableJobs();
    for (const j of existing) await this.queue.removeRepeatableByKey(j.key);
    await this.queue.add(
      'evaluate',
      {},
      { repeat: { every: this.intervalMs }, jobId: 'alerts-eval' },
    );
  }

  async evaluate() {
    if (!(await this.entitlements.hasModule('alerts'))) return;

    const rules = await this.db
      .select()
      .from(alertRules)
      .where(eq(alertRules.enabled, true));
    if (rules.length === 0) return;
    const active = new Set(rules.map((r) => r.event));
    const now = Date.now();
    const since = new Date(now - this.lookbackMs);

    if (active.has('node.offline')) {
      const cutoff = new Date(now - this.offlineMs);
      const rows = await this.db
        .select()
        .from(nodes)
        .where(
          and(
            eq(nodes.status, 'OFFLINE'),
            isNotNull(nodes.lastSeen),
            lt(nodes.lastSeen, cutoff),
          ),
        );
      for (const n of rows) {
        const seen = n.lastSeen as Date;
        await this.alerts.dispatch(
          'node.offline',
          `node.offline:${n.id}:${seen.toISOString()}`,
          `Node offline: ${n.name}`,
          `Node ${n.name} (${n.fqdn}) has been offline since ${seen.toISOString()}.`,
        );
      }
    }

    if (active.has('deploy.failed')) {
      const rows = await this.db
        .select({
          id: deployments.id,
          serviceName: services.name,
          errorMsg: deployments.errorMsg,
        })
        .from(deployments)
        .innerJoin(services, eq(services.id, deployments.serviceId))
        .where(
          and(eq(deployments.status, 'FAILED'), gt(deployments.createdAt, since)),
        );
      for (const d of rows) {
        await this.alerts.dispatch(
          'deploy.failed',
          `deploy.failed:${d.id}`,
          `Deploy failed: ${d.serviceName}`,
          d.errorMsg ?? 'A deployment failed.',
        );
      }
    }

    if (active.has('backup.failed')) {
      const rows = await this.db
        .select()
        .from(backups)
        .where(and(eq(backups.status, 'FAILED'), gt(backups.createdAt, since)));
      for (const b of rows) {
        await this.alerts.dispatch(
          'backup.failed',
          `backup.failed:${b.id}`,
          'Backup failed',
          `Backup ${b.fileName} failed${b.errorMsg ? `: ${b.errorMsg}` : '.'}`,
        );
      }
    }
  }
}

function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
