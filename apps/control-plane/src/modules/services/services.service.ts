import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { PowerAction } from '@selfhosted/shared';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import {
  deployments,
  domains,
  envVars,
  nodes,
  projects,
  services,
  templates,
  volumes,
} from '../../db/schema';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AgentClient } from '../nodes/agent.client';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { SetDomainDto, SetEnvDto } from './dto/set-env.dto';
import {
  DEPLOY_QUEUE,
  DEPLOY_LOCK_TTL_MS,
  DeployJobData,
  composeProjectName,
  deployLockKey,
} from './deploy.constants';

@Injectable()
export class ServicesService implements OnModuleDestroy {
  private readonly logger = new Logger(ServicesService.name);
  private readonly lockRedis: Redis;
  private webhookSecretWarned = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly agent: AgentClient,
    @Inject(DEPLOY_QUEUE) private readonly deployQueue: Queue<DeployJobData>,
  ) {
    this.lockRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  }

  onModuleDestroy() {
    this.lockRedis.disconnect();
  }

  /**
   * Guards against concurrent deploys of the same service (double-click, webhook
   * + manual overlap). Atomic SET NX; the worker releases the lock when done and
   * a TTL guarantees eventual recovery if the worker crashes.
   */
  private async acquireDeployLock(serviceId: string): Promise<void> {
    const ok = await this.lockRedis.set(
      deployLockKey(serviceId),
      '1',
      'PX',
      DEPLOY_LOCK_TTL_MS,
      'NX',
    );
    if (ok !== 'OK') {
      throw new ConflictException(
        'A deployment is already in progress for this service.',
      );
    }
  }

  private async node(nodeId: string) {
    const rows = await this.db
      .select()
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Node not found');
    return rows[0];
  }

  async create(projectId: string, dto: CreateServiceDto) {
    await this.ensureProjectQuota(projectId, dto.cpuLimit ?? 100, dto.memLimit ?? 512);
    const deployKind = dto.deployKind ?? 'git';
    if (deployKind === 'git' && !dto.templateId) {
      throw new BadRequestException('templateId is required for git deploys');
    }
    if (deployKind === 'git' && !dto.repoUrl) {
      throw new BadRequestException('repoUrl is required for git deploys');
    }
    if (deployKind === 'image' && !dto.image) {
      throw new BadRequestException('image is required for image deploys');
    }
    if (
      deployKind === 'compose' &&
      !dto.composeYaml &&
      !dto.repoUrl
    ) {
      throw new BadRequestException(
        'repoUrl or composeYaml is required for compose deploys',
      );
    }

    const rows = await this.db
      .insert(services)
      .values({
        name: dto.name,
        type: dto.type,
        projectId,
        nodeId: dto.nodeId,
        templateId: deployKind === 'git' ? dto.templateId! : null,
        deployKind,
        repoUrl: dto.repoUrl ?? null,
        image: dto.image ?? null,
        composeFile: dto.composeFile ?? 'docker-compose.yml',
        composeYaml: dto.composeYaml ?? null,
        branch: dto.branch ?? 'main',
        gitCredId: dto.gitCredId,
        ...resolveBuildFields(dto.buildMode, dto.useRepoDockerfile),
        buildCommand: dto.buildCommand,
        runCommand: dto.runCommand,
        port: dto.port,
        cpuLimit: dto.cpuLimit ?? 100,
        memLimit: dto.memLimit ?? 512,
      })
      .returning();
    const service = rows[0];

    if (dto.env) {
      await this.setEnv(service.id, {
        vars: Object.entries(dto.env).map(([key, value]) => ({ key, value })),
      });
    }

    return service;
  }

  async get(id: string) {
    const rows = await this.db
      .select()
      .from(services)
      .where(eq(services.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Service not found');
    return rows[0];
  }

  /** Service enriched with its node, template and domain — for the detail page. */
  async getDetail(id: string) {
    const service = await this.get(id);
    const [node] = await this.db
      .select()
      .from(nodes)
      .where(eq(nodes.id, service.nodeId))
      .limit(1);
    const [template] = service.templateId
      ? await this.db
          .select()
          .from(templates)
          .where(eq(templates.id, service.templateId))
          .limit(1)
      : [undefined];
    const [domain] = await this.db
      .select()
      .from(domains)
      .where(eq(domains.serviceId, id))
      .limit(1);
    return {
      ...service,
      node: node
        ? {
            id: node.id,
            name: node.name,
            fqdn: node.fqdn,
            agentPort: node.agentPort,
          }
        : null,
      template: template
        ? {
            id: template.id,
            name: template.name,
            defaultPort: template.defaultPort,
            type: template.type,
          }
        : null,
      domain: domain ? { host: domain.host, https: domain.https } : null,
    };
  }

  /** Updates editable service settings. Takes effect on the next deploy. */
  async update(id: string, dto: UpdateServiceDto) {
    const current = await this.get(id);
    // Zero-downtime runs two app containers at once. That's unsafe for a service
    // with a read-write volume — both would mount the same Docker volume and can
    // corrupt data. Block enabling it while volumes are attached.
    if (dto.zeroDowntime === true) {
      const vols = await this.db
        .select()
        .from(volumes)
        .where(eq(volumes.serviceId, id));
      if (vols.length > 0) {
        throw new BadRequestException(
          'Zero-downtime deploy is not available while the service has ' +
            'persistent volumes (two instances would share the same volume). ' +
            'Remove the volumes first, or keep the classic in-place deploy.',
        );
      }
    }
    const set: Partial<typeof services.$inferInsert> = {};
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.repoUrl !== undefined) set.repoUrl = dto.repoUrl;
    if (dto.branch !== undefined) set.branch = dto.branch;
    if (dto.port !== undefined) set.port = dto.port;
    if (dto.image !== undefined) set.image = dto.image || null;
    if (dto.composeFile !== undefined) set.composeFile = dto.composeFile;
    if (dto.composeYaml !== undefined) set.composeYaml = dto.composeYaml || null;
    if (dto.gitCredId !== undefined) set.gitCredId = dto.gitCredId || null;
    if (dto.buildMode !== undefined) {
      const fields = resolveBuildFields(dto.buildMode, undefined);
      set.buildMode = fields.buildMode;
      set.useRepoDockerfile = fields.useRepoDockerfile;
    } else if (dto.useRepoDockerfile !== undefined) {
      set.useRepoDockerfile = dto.useRepoDockerfile;
      if (dto.useRepoDockerfile) {
        set.buildMode = 'dockerfile';
      } else if (current.buildMode === 'dockerfile') {
        set.buildMode = 'template';
      }
    }
    if (dto.cpuLimit !== undefined || dto.memLimit !== undefined) {
      const nextCpu = dto.cpuLimit ?? current.cpuLimit;
      const nextMem = dto.memLimit ?? current.memLimit;
      await this.ensureProjectQuota(current.projectId, nextCpu, nextMem, id);
      set.cpuLimit = nextCpu;
      set.memLimit = nextMem;
    }
    if (dto.zeroDowntime !== undefined) set.zeroDowntime = dto.zeroDowntime;
    if (dto.healthcheckPath !== undefined) {
      set.healthcheckPath = dto.healthcheckPath || null;
    }
    if (dto.healthTimeoutS !== undefined) {
      set.healthTimeoutS = dto.healthTimeoutS;
    }
    const rows = await this.db
      .update(services)
      .set(set)
      .where(eq(services.id, id))
      .returning();
    return rows[0];
  }

  /** Opens the runtime log stream for a service from its node's agent. */
  async openLogStream(id: string, signal?: AbortSignal) {
    const service = await this.get(id);
    const node = await this.node(service.nodeId);
    return this.agent.streamLogs(node, id, signal);
  }

  /** Returns the node row (incl. encrypted daemon token) hosting a service. */
  async getNodeRow(id: string) {
    const service = await this.get(id);
    return this.node(service.nodeId);
  }

  /** Live resource + health stats for a service container. */
  async stats(id: string) {
    const service = await this.get(id);
    const node = await this.node(service.nodeId);
    try {
      return await this.agent.getStats(node, id);
    } catch (e) {
      // Log agent internals server-side; return only a generic flag (L5).
      this.logger.warn(
        `stats(${id}) failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        running: false,
        state: 'unreachable',
        error: 'unreachable',
      };
    }
  }

  /** Project-level resource allocation + best-effort live usage summary. */
  async projectResourceSummary(projectId: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException('Project not found');
    const rows = await this.db
      .select()
      .from(services)
      .where(eq(services.projectId, projectId));
    const allocatedCpu = rows.reduce((sum, s) => sum + s.cpuLimit, 0);
    const allocatedMemMb = rows.reduce((sum, s) => sum + s.memLimit, 0);
    const running = rows.filter((s) => s.status === 'RUNNING');

    let currentCpuPerc = 0;
    let currentMemMb = 0;
    const unavailable: { serviceId: string; name: string; error: string }[] = [];
    const nodeCache = new Map<string, typeof nodes.$inferSelect>();

    for (const svc of running) {
      try {
        let node = nodeCache.get(svc.nodeId);
        if (!node) {
          node = await this.node(svc.nodeId);
          nodeCache.set(svc.nodeId, node);
        }
        const stats = await this.agent.getStats(node, svc.id);
        currentCpuPerc += parsePercent(stats.cpuPerc);
        currentMemMb += parseMemoryMb(stats.memUsage);
      } catch (e) {
        this.logger.warn(
          `resource summary: service ${svc.id} stats failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        unavailable.push({
          serviceId: svc.id,
          name: svc.name,
          error: 'unreachable',
        });
      }
    }

    return {
      servicesTotal: rows.length,
      servicesRunning: running.length,
      allocatedCpu,
      allocatedMemMb,
      cpuLimit: project.cpuLimit,
      memLimit: project.memLimit,
      availableCpu: Math.max(0, project.cpuLimit - allocatedCpu),
      availableMemMb: Math.max(0, project.memLimit - allocatedMemMb),
      currentCpuPerc: Number(currentCpuPerc.toFixed(2)),
      currentMemMb: Number(currentMemMb.toFixed(1)),
      partial: unavailable.length > 0,
      unavailable,
    };
  }

  private async ensureProjectQuota(
    projectId: string,
    cpuLimit: number,
    memLimit: number,
    excludeServiceId?: string,
  ) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException('Project not found');

    const rows = await this.db
      .select()
      .from(services)
      .where(eq(services.projectId, projectId));
    const siblings = rows.filter((s) => s.id !== excludeServiceId);
    const allocatedCpu = siblings.reduce((sum, s) => sum + s.cpuLimit, 0);
    const allocatedMemMb = siblings.reduce((sum, s) => sum + s.memLimit, 0);

    if (allocatedCpu + cpuLimit > project.cpuLimit) {
      throw new BadRequestException(
        'Service CPU limit exceeds available project CPU quota.',
      );
    }
    if (allocatedMemMb + memLimit > project.memLimit) {
      throw new BadRequestException(
        'Service memory limit exceeds available project memory quota.',
      );
    }
  }

  async remove(id: string) {
    const service = await this.get(id);
    try {
      const node = await this.node(service.nodeId);
      if (service.deployKind === 'compose') {
        await this.agent.composeDown(node, id, {
          projectName: composeProjectName(id),
          removeVolumes: false,
        });
      } else {
        await this.agent.remove(node, id);
        // Reclaim disk: drop every image of this service (empty keepImage).
        await this.agent.gc(node, id, '');
      }
    } catch {
      // Best-effort: still remove the record even if the agent is unreachable.
    }
    await this.db.delete(services).where(eq(services.id, id));
    return { ok: true };
  }

  async setEnv(id: string, dto: SetEnvDto) {
    await this.get(id);
    for (const v of dto.vars) {
      await this.db
        .insert(envVars)
        .values({
          serviceId: id,
          key: v.key,
          valueEnc: this.crypto.encrypt(v.value),
          isSecret: v.isSecret ?? false,
        })
        .onConflictDoUpdate({
          target: [envVars.serviceId, envVars.key],
          set: {
            valueEnc: this.crypto.encrypt(v.value),
            isSecret: v.isSecret ?? false,
          },
        });
    }
    return this.listEnv(id);
  }

  async deleteEnv(id: string, key: string) {
    await this.get(id);
    await this.db
      .delete(envVars)
      .where(and(eq(envVars.serviceId, id), eq(envVars.key, key)));
    return this.listEnv(id);
  }

  async listEnv(id: string) {
    const rows = await this.db
      .select()
      .from(envVars)
      .where(eq(envVars.serviceId, id));
    return rows.map((v) => ({
      key: v.key,
      value: v.isSecret ? '••••••' : this.crypto.decrypt(v.valueEnc),
      isSecret: v.isSecret,
    }));
  }

  /** Decrypts all env vars; used by the build/run pipeline only. */
  async resolveEnv(id: string): Promise<Record<string, string>> {
    const rows = await this.db
      .select()
      .from(envVars)
      .where(eq(envVars.serviceId, id));
    return Object.fromEntries(
      rows.map((v) => [v.key, this.crypto.decrypt(v.valueEnc)]),
    );
  }

  /** Persistent volumes mounted into the service container (survive redeploys). */
  async listVolumes(id: string) {
    await this.get(id);
    return this.db
      .select()
      .from(volumes)
      .where(eq(volumes.serviceId, id))
      .orderBy(volumes.mountPath);
  }

  async addVolume(id: string, mountPath: string) {
    await this.get(id);
    const path = mountPath.trim();
    if (!path.startsWith('/')) {
      throw new BadRequestException('Mount path must be absolute (start with /)');
    }
    const name = `vol-${randomUUID().slice(0, 8)}`;
    const rows = await this.db
      .insert(volumes)
      .values({ serviceId: id, name, mountPath: path })
      .returning();
    return rows[0];
  }

  async removeVolume(id: string, volumeId: string) {
    const [vol] = await this.db
      .select()
      .from(volumes)
      .where(eq(volumes.id, volumeId))
      .limit(1);
    if (!vol || vol.serviceId !== id) {
      throw new NotFoundException('Volume not found');
    }
    // Best-effort: drop the Docker volume on the node (no-op if still in use).
    try {
      const service = await this.get(id);
      const node = await this.node(service.nodeId);
      await this.agent.removeVolume(node, vol.name);
    } catch {
      // ignore — the row is removed regardless; data can be GC'd later.
    }
    await this.db.delete(volumes).where(eq(volumes.id, volumeId));
    return { ok: true };
  }

  async setDomain(id: string, dto: SetDomainDto) {
    await this.get(id);
    const rows = await this.db
      .insert(domains)
      .values({ serviceId: id, host: dto.host, https: dto.https ?? true })
      .onConflictDoUpdate({
        target: domains.serviceId,
        set: { host: dto.host, https: dto.https ?? true },
      })
      .returning();
    return rows[0];
  }

  /**
   * Record a Deployment and enqueue a BullMQ job. The DeployWorker drives the
   * build + run pipeline on the target node and updates the rows as it goes.
   */
  async deploy(id: string) {
    await this.get(id);
    await this.acquireDeployLock(id);
    try {
      const rows = await this.db
        .insert(deployments)
        .values({ serviceId: id, status: 'QUEUED' })
        .returning();
      const deployment = rows[0];
      await this.deployQueue.add(
        'deploy',
        { deploymentId: deployment.id, serviceId: id },
        { removeOnComplete: 50, removeOnFail: 100 },
      );
      return deployment;
    } catch (e) {
      await this.lockRedis.del(deployLockKey(id)).catch(() => undefined);
      throw e;
    }
  }

  /**
   * Redeploys a previous successful deployment's image without rebuilding.
   * Creates a new deployment row and enqueues a rollback job.
   */
  async rollback(deploymentId: string) {
    const source = await this.getDeployment(deploymentId);
    if (!source) throw new NotFoundException('Deployment not found');
    if (source.status !== 'SUCCESS' || !source.imageTag) {
      throw new BadRequestException(
        'Only a successful deployment with a built image can be rolled back to',
      );
    }
    await this.get(source.serviceId);
    await this.acquireDeployLock(source.serviceId);
    try {
      const rows = await this.db
        .insert(deployments)
        .values({
          serviceId: source.serviceId,
          status: 'QUEUED',
          commitSha: source.commitSha,
          imageTag: source.imageTag,
        })
        .returning();
      const deployment = rows[0];
      await this.deployQueue.add(
        'deploy',
        {
          deploymentId: deployment.id,
          serviceId: source.serviceId,
          rollbackImageTag: source.imageTag,
          rollbackCommitSha: source.commitSha ?? undefined,
        },
        { removeOnComplete: 50, removeOnFail: 100 },
      );
      return deployment;
    } catch (e) {
      await this.lockRedis
        .del(deployLockKey(source.serviceId))
        .catch(() => undefined);
      throw e;
    }
  }

  /** Deterministic webhook token for a service (HMAC, no DB column needed). */
  webhookToken(id: string): string {
    return createHmac('sha256', this.webhookSecret())
      .update(id)
      .digest('hex')
      .slice(0, 32);
  }

  /**
   * Dedicated secret for signing deploy-webhook tokens. Intentionally NOT
   * derived from JWT_SECRET so rotating one doesn't affect the other. Required
   * in production (fail closed); a warned, insecure fallback is used only in
   * development to keep the local flow working.
   */
  private webhookSecret(): string {
    const s = process.env.WEBHOOK_SECRET?.trim();
    if (s) return s;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'WEBHOOK_SECRET is not set — refusing to sign deploy webhooks with a predictable key.',
      );
    }
    if (!this.webhookSecretWarned) {
      this.logger.warn(
        'WEBHOOK_SECRET is not set; using an insecure development fallback. ' +
          'Set WEBHOOK_SECRET before deploying to production.',
      );
      this.webhookSecretWarned = true;
    }
    return 'dev-only-insecure-webhook-secret';
  }

  /** Returns the auto-deploy webhook URL + token for a service. */
  async getWebhook(id: string) {
    await this.get(id);
    const token = this.webhookToken(id);
    return { token, path: `/webhooks/services/${id}/${token}` };
  }

  /** Validates a webhook token and triggers a deploy (used by the public hook). */
  async deployViaWebhook(id: string, token: string) {
    const expected = this.webhookToken(id);
    if (
      token.length !== expected.length ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    ) {
      throw new NotFoundException('Invalid webhook token');
    }
    return this.deploy(id);
  }

  listDeployments(id: string) {
    return this.db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceId, id))
      .orderBy(desc(deployments.createdAt));
  }

  /** Returns a single deployment row (or undefined). */
  async getDeployment(id: string) {
    return (
      await this.db
        .select()
        .from(deployments)
        .where(eq(deployments.id, id))
        .limit(1)
    )[0];
  }

  /** Power action (start/stop/restart/kill) — proxied to the node agent. */
  async power(id: string, action: PowerAction) {
    const service = await this.get(id);
    const node = await this.node(service.nodeId);
    if (service.deployKind === 'compose') {
      const mapped =
        action === PowerAction.KILL ? PowerAction.STOP : action;
      await this.agent.composePower(
        node,
        id,
        mapped,
        composeProjectName(id),
      );
    } else {
      await this.agent.power(node, id, action);
    }
    const status =
      action === PowerAction.STOP || action === PowerAction.KILL
        ? 'STOPPED'
        : 'RUNNING';
    await this.db
      .update(services)
      .set({ status })
      .where(eq(services.id, service.id));
    return this.get(service.id);
  }
}

function parsePercent(value?: string): number {
  if (!value) return 0;
  const n = Number(value.replace('%', '').trim());
  return Number.isFinite(n) ? n : 0;
}

function parseMemoryMb(value?: string): number {
  if (!value) return 0;
  const used = value.split('/')[0]?.trim();
  if (!used) return 0;
  const match = used.match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  const unit = match[2].toUpperCase();
  if (unit === 'B') return amount / 1024 / 1024;
  if (unit === 'KB' || unit === 'KIB') return amount / 1024;
  if (unit === 'MB' || unit === 'MIB') return amount;
  if (unit === 'GB' || unit === 'GIB') return amount * 1024;
  if (unit === 'TB' || unit === 'TIB') return amount * 1024 * 1024;
  return 0;
}

/** Resolve buildMode + keep useRepoDockerfile in sync for back-compat. */
function resolveBuildFields(
  buildMode?: string,
  useRepoDockerfile?: boolean,
): { buildMode: string; useRepoDockerfile: boolean } {
  let mode = buildMode;
  if (!mode) {
    mode = useRepoDockerfile ? 'dockerfile' : 'template';
  }
  if (mode !== 'template' && mode !== 'dockerfile' && mode !== 'nixpacks') {
    mode = 'template';
  }
  return {
    buildMode: mode,
    useRepoDockerfile: mode === 'dockerfile',
  };
}
