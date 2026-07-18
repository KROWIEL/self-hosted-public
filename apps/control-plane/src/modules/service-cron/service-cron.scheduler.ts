import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { nodes, serviceCrons, services } from '../../db/schema';
import { AgentClient } from '../nodes/agent.client';
import { createRedisConnection } from '../services/deploy.constants';
import {
  SERVICE_CRON_OUTPUT_MAX,
  SERVICE_CRON_QUEUE,
  SERVICE_CRON_QUEUE_NAME,
  ServiceCronJobData,
} from './service-cron.constants';
import {
  CreateServiceCronDto,
  UpdateServiceCronDto,
} from './dto/service-cron.dto';

/**
 * CRUD + BullMQ driver for per-service cron jobs (Home-Lab: service-cron).
 * Mirrors BackupScheduler: rebuilds repeatable jobs from the DB on every change.
 */
@Injectable()
export class ServiceCronScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServiceCronScheduler.name);
  private worker?: Worker<ServiceCronJobData>;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(SERVICE_CRON_QUEUE)
    private readonly queue: Queue<ServiceCronJobData>,
    private readonly agent: AgentClient,
  ) {}

  async onModuleInit() {
    this.worker = new Worker<ServiceCronJobData>(
      SERVICE_CRON_QUEUE_NAME,
      (job) => this.process(job),
      { connection: createRedisConnection(), concurrency: 2 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Service cron job ${job?.id} failed: ${err.message}`),
    );
    await this.sync().catch((e) =>
      this.logger.error(`Initial service-cron sync failed: ${e.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  list(serviceId: string) {
    return this.db
      .select()
      .from(serviceCrons)
      .where(eq(serviceCrons.serviceId, serviceId));
  }

  async create(serviceId: string, dto: CreateServiceCronDto) {
    await this.assertService(serviceId);
    const [row] = await this.db
      .insert(serviceCrons)
      .values({
        serviceId,
        name: dto.name,
        cron: dto.cron,
        command: dto.command,
        enabled: dto.enabled ?? true,
        timeoutSec: dto.timeoutSec ?? 300,
      })
      .returning();
    try {
      await this.sync();
    } catch (e) {
      await this.db.delete(serviceCrons).where(eq(serviceCrons.id, row.id));
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Invalid cron expression',
      );
    }
    return row;
  }

  async update(serviceId: string, id: string, dto: UpdateServiceCronDto) {
    const existing = await this.getOwned(serviceId, id);
    const [row] = await this.db
      .update(serviceCrons)
      .set({
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.cron !== undefined ? { cron: dto.cron } : {}),
        ...(dto.command !== undefined ? { command: dto.command } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.timeoutSec !== undefined
          ? { timeoutSec: dto.timeoutSec }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(serviceCrons.id, existing.id))
      .returning();
    try {
      await this.sync();
    } catch (e) {
      // Roll cron expression back if BullMQ rejects it.
      if (dto.cron !== undefined) {
        await this.db
          .update(serviceCrons)
          .set({ cron: existing.cron, updatedAt: new Date() })
          .where(eq(serviceCrons.id, existing.id));
        await this.sync().catch(() => undefined);
      }
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Invalid cron expression',
      );
    }
    return row;
  }

  async remove(serviceId: string, id: string) {
    await this.getOwned(serviceId, id);
    await this.db.delete(serviceCrons).where(eq(serviceCrons.id, id));
    await this.sync();
    return { ok: true };
  }

  /** Rebuilds repeatable jobs from enabled rows in the DB. */
  async sync() {
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }
    const rows = await this.db
      .select()
      .from(serviceCrons)
      .where(eq(serviceCrons.enabled, true));
    for (const row of rows) {
      await this.queue.add(
        'run',
        { cronId: row.id },
        { repeat: { pattern: row.cron }, jobId: `svc-cron-${row.id}` },
      );
    }
  }

  private async process(job: Job<ServiceCronJobData>) {
    const [cron] = await this.db
      .select()
      .from(serviceCrons)
      .where(eq(serviceCrons.id, job.data.cronId))
      .limit(1);
    if (!cron || !cron.enabled) return;

    const [svc] = await this.db
      .select()
      .from(services)
      .where(eq(services.id, cron.serviceId))
      .limit(1);
    if (!svc) return;

    if (svc.status !== 'RUNNING') {
      await this.record(cron.id, 'skipped', 'service not RUNNING');
      return;
    }

    // Compose stacks have no single target container for cron today.
    if (svc.deployKind === 'compose') {
      await this.record(
        cron.id,
        'skipped',
        'compose services do not support per-service cron yet',
      );
      return;
    }

    if (!svc.containerId) {
      await this.record(cron.id, 'skipped', 'no container');
      return;
    }

    const [node] = await this.db
      .select()
      .from(nodes)
      .where(eq(nodes.id, svc.nodeId))
      .limit(1);
    if (!node) {
      await this.record(cron.id, 'error', 'node not found');
      return;
    }

    try {
      // Leave container empty so the agent resolves live blue/green name.
      const result = await this.agent.execCmd(node, svc.id, {
        command: cron.command,
        timeoutSec: cron.timeoutSec,
      });
      const output = truncateOutput(
        [result.stdout, result.stderr].filter(Boolean).join('\n'),
      );
      const status =
        result.exitCode === 0 ? 'ok' : `exit ${result.exitCode}`;
      await this.record(cron.id, status, output);
    } catch (e) {
      await this.record(
        cron.id,
        'error',
        truncateOutput(e instanceof Error ? e.message : String(e)),
      );
    }
  }

  private async record(id: string, status: string, output: string) {
    await this.db
      .update(serviceCrons)
      .set({
        lastRunAt: new Date(),
        lastStatus: status,
        lastOutput: output,
        updatedAt: new Date(),
      })
      .where(eq(serviceCrons.id, id));
  }

  private async assertService(serviceId: string) {
    const [svc] = await this.db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);
    if (!svc) throw new NotFoundException('Service not found');
  }

  private async getOwned(serviceId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(serviceCrons)
      .where(
        and(eq(serviceCrons.id, id), eq(serviceCrons.serviceId, serviceId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Cron not found');
    return row;
  }
}

function truncateOutput(s: string): string {
  if (s.length <= SERVICE_CRON_OUTPUT_MAX) return s;
  return s.slice(0, SERVICE_CRON_OUTPUT_MAX) + '…';
}
