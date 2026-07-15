import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import {
  alertEvents,
  alertRules,
  backups,
  deployments,
  managedDatabases,
  metricSamples,
  nodes,
  offsiteUploads,
  services,
  tunnels,
} from '../../db/schema';
import { EntitlementsService } from '../../common/licensing/entitlements.service';
import { createRedisConnection } from '../services/deploy.constants';
import { AlertsService } from './alerts.service';
import {
  ALERTS_QUEUE,
  ALERTS_QUEUE_NAME,
  AlertsJobData,
} from './alerts.constants';

/**
 * Periodically evaluates alert conditions and dispatches notifications. Runs as
 * a BullMQ repeatable job so it survives restarts and doesn't duplicate across
 * workers. Skips entirely when the `alerts` module isn't licensed.
 *
 * Every event is derived by polling existing state (no per-feature wiring), and
 * de-duplicated so each incident notifies exactly once (see `AlertsService`).
 */
@Injectable()
export class AlertsEvaluator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsEvaluator.name);
  private worker?: Worker<AlertsJobData>;

  private readonly intervalMs = numFromEnv('ALERTS_EVAL_INTERVAL_MS', 5 * 60_000);
  private readonly offlineMs = numFromEnv('ALERTS_NODE_OFFLINE_MS', 3 * 60_000);
  private readonly lookbackMs = numFromEnv('ALERTS_LOOKBACK_MS', 24 * 60 * 60_000);
  private readonly stuckMs = numFromEnv('ALERTS_DEPLOY_STUCK_MS', 30 * 60_000);
  // Resource thresholds (percent) + how fresh a sample must be + how often a
  // sustained breach re-notifies.
  private readonly cpuPct = numFromEnv('ALERTS_CPU_PCT', 90);
  private readonly memPct = numFromEnv('ALERTS_MEM_PCT', 90);
  private readonly diskPct = numFromEnv('ALERTS_DISK_PCT', 90);
  private readonly resourceFreshMs = numFromEnv('ALERTS_RESOURCE_FRESH_MS', 15 * 60_000);
  private readonly resourceRearmMs = numFromEnv('ALERTS_RESOURCE_REARM_MS', 60 * 60_000);
  private readonly licenseWarnMs = numFromEnv('ALERTS_LICENSE_EXPIRY_MS', 14 * 24 * 60 * 60_000);

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

    // Each handler is independent and best-effort: one failing check must not
    // stop the others.
    const checks: [boolean, () => Promise<void>][] = [
      [active.has('node.offline'), () => this.nodeOffline(now)],
      [active.has('node.online'), () => this.nodeOnline()],
      [
        active.has('node.cpu.high') ||
          active.has('node.mem.high') ||
          active.has('node.disk.high'),
        () => this.nodeResources(now, active),
      ],
      [active.has('deploy.failed'), () => this.deployFailed(since)],
      [active.has('deploy.succeeded'), () => this.deploySucceeded(since)],
      [active.has('deploy.stuck'), () => this.deployStuck(now)],
      [active.has('service.error'), () => this.serviceStatus('service.error', 'ERROR')],
      [active.has('service.stopped'), () => this.serviceStatus('service.stopped', 'STOPPED')],
      [active.has('database.error'), () => this.databaseStatus('database.error', 'ERROR')],
      [active.has('database.stopped'), () => this.databaseStatus('database.stopped', 'STOPPED')],
      [active.has('backup.failed'), () => this.backupStatus('backup.failed', 'FAILED', since)],
      [active.has('backup.succeeded'), () => this.backupStatus('backup.succeeded', 'SUCCESS', since)],
      [active.has('offsite.failed'), () => this.offsiteFailed(since)],
      [active.has('tunnel.offline'), () => this.tunnelOffline()],
      [active.has('tunnel.online'), () => this.tunnelOnline()],
      [active.has('license.expiring'), () => this.licenseExpiring(now)],
    ];

    for (const [enabled, run] of checks) {
      if (!enabled) continue;
      try {
        await run();
      } catch (e) {
        this.logger.warn(
          `Alert check failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  // ---- Nodes ----

  private async nodeOffline(now: number) {
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

  /** Fire once when a node that had an offline incident is back ONLINE. */
  private async nodeOnline() {
    const online = await this.db
      .select()
      .from(nodes)
      .where(eq(nodes.status, 'ONLINE'));
    if (online.length === 0) return;
    const latest = await this.latestIncidentKeys('node.offline');
    for (const n of online) {
      const offlineKey = latest.get(n.id);
      if (!offlineKey) continue;
      await this.alerts.dispatch(
        'node.online',
        offlineKey.replace(/^node\.offline:/, 'node.online:'),
        `Node recovered: ${n.name}`,
        `Node ${n.name} (${n.fqdn}) is back online.`,
      );
    }
  }

  private async nodeResources(now: number, active: Set<string>) {
    const fresh = new Date(now - this.resourceFreshMs);
    const rows = await this.db
      .select({
        nodeId: metricSamples.nodeId,
        cpuPct: metricSamples.cpuPct,
        memPct: metricSamples.memPct,
        diskPct: metricSamples.diskPct,
        createdAt: metricSamples.createdAt,
        name: nodes.name,
      })
      .from(metricSamples)
      .innerJoin(nodes, eq(nodes.id, metricSamples.nodeId))
      .where(gt(metricSamples.createdAt, fresh))
      .orderBy(desc(metricSamples.createdAt));

    // Keep only the most recent sample per node.
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.nodeId)) latest.set(r.nodeId, r);

    // Rate-limit sustained breaches to one notification per re-arm window.
    const bucket = Math.floor(now / this.resourceRearmMs);
    const kinds: [string, 'cpuPct' | 'memPct' | 'diskPct', number, string][] = [
      ['node.cpu.high', 'cpuPct', this.cpuPct, 'CPU'],
      ['node.mem.high', 'memPct', this.memPct, 'memory'],
      ['node.disk.high', 'diskPct', this.diskPct, 'disk'],
    ];
    for (const s of latest.values()) {
      for (const [event, field, threshold, label] of kinds) {
        if (!active.has(event)) continue;
        const val = s[field];
        if (val == null || val < threshold) continue;
        await this.alerts.dispatch(
          event,
          `${event}:${s.nodeId}:${bucket}`,
          `High ${label} on ${s.name}`,
          `${label} usage on node ${s.name} is ${val}% (threshold ${threshold}%).`,
        );
      }
    }
  }

  // ---- Deployments ----

  private async deployFailed(since: Date) {
    const rows = await this.db
      .select({
        id: deployments.id,
        serviceName: services.name,
        errorMsg: deployments.errorMsg,
      })
      .from(deployments)
      .innerJoin(services, eq(services.id, deployments.serviceId))
      .where(and(eq(deployments.status, 'FAILED'), gt(deployments.createdAt, since)));
    for (const d of rows) {
      await this.alerts.dispatch(
        'deploy.failed',
        `deploy.failed:${d.id}`,
        `Deploy failed: ${d.serviceName}`,
        d.errorMsg ?? 'A deployment failed.',
      );
    }
  }

  private async deploySucceeded(since: Date) {
    const rows = await this.db
      .select({
        id: deployments.id,
        serviceName: services.name,
        commitSha: deployments.commitSha,
      })
      .from(deployments)
      .innerJoin(services, eq(services.id, deployments.serviceId))
      .where(and(eq(deployments.status, 'SUCCESS'), gt(deployments.createdAt, since)));
    for (const d of rows) {
      await this.alerts.dispatch(
        'deploy.succeeded',
        `deploy.succeeded:${d.id}`,
        `Deploy succeeded: ${d.serviceName}`,
        `A new version of ${d.serviceName}${
          d.commitSha ? ` (${d.commitSha.slice(0, 7)})` : ''
        } is live.`,
      );
    }
  }

  private async deployStuck(now: number) {
    const cutoff = new Date(now - this.stuckMs);
    const rows = await this.db
      .select({
        id: deployments.id,
        serviceName: services.name,
        status: deployments.status,
        createdAt: deployments.createdAt,
      })
      .from(deployments)
      .innerJoin(services, eq(services.id, deployments.serviceId))
      .where(
        and(
          inArray(deployments.status, ['QUEUED', 'BUILDING', 'DEPLOYING']),
          isNull(deployments.finishedAt),
          lt(deployments.createdAt, cutoff),
        ),
      );
    for (const d of rows) {
      await this.alerts.dispatch(
        'deploy.stuck',
        `deploy.stuck:${d.id}`,
        `Deploy stuck: ${d.serviceName}`,
        `A deployment of ${d.serviceName} has been in "${d.status}" since ${d.createdAt.toISOString()} without finishing.`,
      );
    }
  }

  // ---- Services ----

  private async serviceStatus(event: string, status: 'ERROR' | 'STOPPED') {
    const rows = await this.db
      .select()
      .from(services)
      .where(eq(services.status, status));
    for (const s of rows) {
      await this.alerts.dispatch(
        event,
        `${event}:${s.id}:${s.updatedAt.toISOString()}`,
        `Service ${status === 'ERROR' ? 'error' : 'stopped'}: ${s.name}`,
        `Service ${s.name} is in status ${status}.`,
      );
    }
  }

  // ---- Databases ----

  private async databaseStatus(event: string, status: 'ERROR' | 'STOPPED') {
    const rows = await this.db
      .select()
      .from(managedDatabases)
      .where(eq(managedDatabases.status, status));
    for (const d of rows) {
      await this.alerts.dispatch(
        event,
        `${event}:${d.id}:${d.updatedAt.toISOString()}`,
        `Database ${status === 'ERROR' ? 'error' : 'stopped'}: ${d.name}`,
        `Managed database ${d.name} (${d.engine}) is in status ${status}.`,
      );
    }
  }

  // ---- Backups ----

  private async backupStatus(
    event: string,
    status: 'FAILED' | 'SUCCESS',
    since: Date,
  ) {
    const rows = await this.db
      .select()
      .from(backups)
      .where(and(eq(backups.status, status), gt(backups.createdAt, since)));
    for (const b of rows) {
      const ok = status === 'SUCCESS';
      await this.alerts.dispatch(
        event,
        `${event}:${b.id}`,
        ok ? 'Backup completed' : 'Backup failed',
        ok
          ? `Backup ${b.fileName} completed successfully.`
          : `Backup ${b.fileName} failed${b.errorMsg ? `: ${b.errorMsg}` : '.'}`,
      );
    }
  }

  private async offsiteFailed(since: Date) {
    const rows = await this.db
      .select()
      .from(offsiteUploads)
      .where(and(eq(offsiteUploads.status, 'failed'), gt(offsiteUploads.createdAt, since)));
    for (const u of rows) {
      await this.alerts.dispatch(
        'offsite.failed',
        `offsite.failed:${u.id}`,
        'Off-site upload failed',
        `Uploading backup object "${u.key}" to off-site storage failed${
          u.error ? `: ${u.error}` : '.'
        }`,
      );
    }
  }

  // ---- Networking ----

  private async tunnelOffline() {
    const rows = await this.db
      .select()
      .from(tunnels)
      .where(and(eq(tunnels.enabled, true), eq(tunnels.status, 'OFFLINE')));
    for (const t of rows) {
      const stamp = (t.lastSeen ?? t.updatedAt).toISOString();
      await this.alerts.dispatch(
        'tunnel.offline',
        `tunnel.offline:${t.id}:${stamp}`,
        `Tunnel down: ${t.name}`,
        `Reverse tunnel ${t.name} (${t.serverHost}) is enabled but disconnected.`,
      );
    }
  }

  private async tunnelOnline() {
    const online = await this.db
      .select()
      .from(tunnels)
      .where(eq(tunnels.status, 'ONLINE'));
    if (online.length === 0) return;
    const latest = await this.latestIncidentKeys('tunnel.offline');
    for (const t of online) {
      const offlineKey = latest.get(t.id);
      if (!offlineKey) continue;
      await this.alerts.dispatch(
        'tunnel.online',
        offlineKey.replace(/^tunnel\.offline:/, 'tunnel.online:'),
        `Tunnel recovered: ${t.name}`,
        `Reverse tunnel ${t.name} (${t.serverHost}) is back online.`,
      );
    }
  }

  // ---- Licensing ----

  private async licenseExpiring(now: number) {
    const ent = await this.entitlements.get();
    if (!ent.licensed || !ent.expiresAt) return;
    const expMs = ent.expiresAt * 1000;
    if (expMs <= now) return; // already expired (handled by degrading to Free)
    if (expMs - now > this.licenseWarnMs) return;
    const day = Math.ceil((expMs - now) / (24 * 60 * 60_000));
    await this.alerts.dispatch(
      'license.expiring',
      `license.expiring:${ent.expiresAt}`,
      'License expiring soon',
      `Your ${ent.tier} license expires on ${new Date(expMs).toISOString()} (~${day} day(s) left). Renew to keep paid modules unlocked.`,
    );
  }

  // ---- Helpers ----

  /**
   * Map of resourceId → most-recent dedupeKey for a state event whose keys are
   * shaped `${event}:${uuid}:${extra}`. Used to fire "recovered" notifications
   * keyed to the original incident (so recovery fires once per down→up flip).
   */
  private async latestIncidentKeys(event: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ dedupeKey: alertEvents.dedupeKey })
      .from(alertEvents)
      .where(eq(alertEvents.event, event))
      .orderBy(desc(alertEvents.createdAt))
      .limit(500);
    const re = new RegExp(`^${escapeRe(event)}:([0-9a-f-]{36}):`);
    const map = new Map<string, string>();
    for (const r of rows) {
      const m = r.dedupeKey.match(re);
      if (m && !map.has(m[1])) map.set(m[1], r.dedupeKey);
    }
    return map;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
