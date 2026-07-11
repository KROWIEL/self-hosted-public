import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import {
  deployments,
  domains,
  envVars,
  gitCredentials,
  nodes,
  services,
  templates,
  volumes,
} from '../../db/schema';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AgentClient } from '../nodes/agent.client';
import { BuildLogService } from './build-log.service';
import {
  DEPLOY_QUEUE_NAME,
  DeployJobData,
  createRedisConnection,
  deployLockKey,
} from './deploy.constants';

/**
 * Consumes deploy jobs and drives the full pipeline on the target node:
 * build image from git -> run container -> update service/deployment rows.
 */
@Injectable()
export class DeployWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeployWorker.name);
  private worker?: Worker<DeployJobData>;
  private readonly lockRedis: Redis;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly agent: AgentClient,
    private readonly buildLog: BuildLogService,
  ) {
    this.lockRedis = new Redis(
      process.env.REDIS_URL ?? 'redis://localhost:6379',
      { maxRetriesPerRequest: null },
    );
  }

  onModuleInit() {
    this.worker = new Worker<DeployJobData>(
      DEPLOY_QUEUE_NAME,
      (job) => this.process(job),
      { connection: createRedisConnection(), concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Deploy ${job?.id} failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    this.lockRedis.disconnect();
  }

  private async process(job: Job<DeployJobData>) {
    const { deploymentId, serviceId, rollbackImageTag, rollbackCommitSha } =
      job.data;

    const svc = (
      await this.db
        .select()
        .from(services)
        .where(eq(services.id, serviceId))
        .limit(1)
    )[0];
    if (!svc) throw new Error(`service ${serviceId} not found`);

    const node = (
      await this.db.select().from(nodes).where(eq(nodes.id, svc.nodeId)).limit(1)
    )[0];
    if (!node) throw new Error(`node ${svc.nodeId} not found`);

    const tpl = (
      await this.db
        .select()
        .from(templates)
        .where(eq(templates.id, svc.templateId))
        .limit(1)
    )[0];
    if (!tpl) throw new Error(`template ${svc.templateId} not found`);

    let patToken: string | undefined;
    let gitUsername: string | undefined;
    if (svc.gitCredId) {
      const cred = (
        await this.db
          .select()
          .from(gitCredentials)
          .where(eq(gitCredentials.id, svc.gitCredId))
          .limit(1)
      )[0];
      if (cred) {
        patToken = this.crypto.decrypt(cred.patEnc);
        gitUsername = cred.username ?? undefined;
      }
    }

    const env = await this.resolveEnv(serviceId);
    const domainRow = (
      await this.db
        .select()
        .from(domains)
        .where(eq(domains.serviceId, serviceId))
        .limit(1)
    )[0];
    const volumeRows = await this.db
      .select()
      .from(volumes)
      .where(eq(volumes.serviceId, serviceId));

    const isRollback = !!rollbackImageTag;
    const imageTag =
      rollbackImageTag ??
      `svc-${serviceId.slice(0, 8)}:${deploymentId.slice(0, 8)}`;

    try {
      if (isRollback) {
        // Reuse a previously built image — no clone/build step.
        await this.buildLog.publish(
          deploymentId,
          `>> rollback: redeploying existing image ${imageTag}\n`,
        );
        await this.setDeploy(deploymentId, {
          status: 'DEPLOYING',
          commitSha: rollbackCommitSha,
          imageTag,
          buildLog: `Rollback: reused image ${imageTag}`,
        });
        await this.setService(serviceId, { status: 'BUILDING' });
      } else {
        await this.setDeploy(deploymentId, { status: 'BUILDING', phase: 'build' });
        await this.setService(serviceId, { status: 'BUILDING' });

        const build = await this.agent.build(
          node,
          {
            serviceId,
            repoUrl: svc.repoUrl,
            branch: svc.branch,
            patToken,
            gitUsername,
            buildImage: tpl.installImage,
            runImage: tpl.baseImage,
            dockerfile: tpl.dockerfilePath ?? undefined,
            useRepoDockerfile: svc.useRepoDockerfile,
            imageTag,
          },
          (chunk) => void this.buildLog.publish(deploymentId, chunk),
        );

        await this.setDeploy(deploymentId, {
          status: 'DEPLOYING',
          commitSha: build.commitSha,
          imageTag,
          buildLog: build.buildLog,
        });
      }

      const port = svc.port ?? tpl.defaultPort;
      const volumeMounts = volumeRows.map((v) => ({
        name: v.name,
        mountPath: v.mountPath,
      }));

      // Zero-downtime needs a domain (Traefik does the smooth switchover) and is
      // unsafe with volumes (two instances would share the same RW volume), so
      // any such service falls back to the classic replace-in-place run.
      if (svc.zeroDowntime && volumeRows.length > 0) {
        await this.buildLog.publish(
          deploymentId,
          '>> note: zero-downtime skipped — service has persistent volumes; ' +
            'using in-place deploy\n',
        );
      }
      if (svc.zeroDowntime && domainRow?.host && volumeRows.length === 0) {
        await this.zeroDowntimeDeploy({
          node,
          svc,
          tpl,
          deploymentId,
          imageTag,
          port,
          env,
          domain: domainRow.host,
          https: domainRow.https,
          volumes: volumeMounts,
        });
      } else {
        await this.setDeploy(deploymentId, { phase: 'run' });
        const run = await this.agent.run(node, {
          serviceId,
          image: imageTag,
          port,
          cpuLimit: svc.cpuLimit,
          memLimit: svc.memLimit,
          env,
          domain: domainRow?.host,
          https: domainRow?.https,
          volumes: volumeMounts,
        });
        if (!run.ok) {
          throw new Error(run.error ?? 'agent run failed');
        }
        // Sweep any leftover blue-green instances from a prior ZDD run.
        try {
          await this.agent.promote(node, serviceId, '');
        } catch {
          // best-effort cleanup
        }
        await this.setService(serviceId, {
          status: 'RUNNING',
          containerId: run.containerId,
          currentImage: imageTag,
          activeColor: null,
        });
      }

      await this.setDeploy(deploymentId, {
        status: 'SUCCESS',
        finishedAt: new Date(),
      });

      // Housekeeping: drop older images of this service to reclaim disk.
      // Best-effort — never fail a successful deploy over cleanup.
      try {
        await this.agent.gc(node, serviceId, imageTag);
      } catch (gcErr) {
        this.logger.warn(
          `GC for ${serviceId} failed: ${
            gcErr instanceof Error ? gcErr.message : String(gcErr)
          }`,
        );
      }
    } catch (e) {
      const err = e as Error & { buildLog?: string };
      await this.buildLog.publish(deploymentId, `\nERROR: ${err.message}\n`);
      await this.setService(serviceId, { status: 'ERROR' });
      await this.setDeploy(deploymentId, {
        status: 'FAILED',
        errorMsg: err.message,
        ...(err.buildLog ? { buildLog: err.buildLog } : {}),
        finishedAt: new Date(),
      });
      throw err;
    } finally {
      await this.buildLog.end(deploymentId);
      // Release the per-service deploy lock so the next deploy can proceed.
      await this.lockRedis
        .del(deployLockKey(serviceId))
        .catch(() => undefined);
    }
  }

  /**
   * Blue-green switchover: start the opposite color, health-gate it, then retire
   * the old color. On health failure the new color is removed and the old one is
   * left serving (auto-rollback, deployment marked FAILED by the caller).
   */
  private async zeroDowntimeDeploy(ctx: {
    node: typeof nodes.$inferSelect;
    svc: typeof services.$inferSelect;
    tpl: typeof templates.$inferSelect;
    deploymentId: string;
    imageTag: string;
    port: number;
    env: Record<string, string>;
    domain: string;
    https: boolean;
    volumes: { name: string; mountPath: string }[];
  }) {
    const { node, svc, tpl, deploymentId, imageTag, port, env } = ctx;
    const newColor = svc.activeColor === 'blue' ? 'green' : 'blue';
    const healthPath = svc.healthcheckPath ?? tpl.healthcheckPath ?? '/';
    const timeoutS = svc.healthTimeoutS ?? 60;

    await this.setDeploy(deploymentId, { phase: 'start' });
    await this.buildLog.publish(
      deploymentId,
      `>> zero-downtime: starting ${newColor} instance\n`,
    );
    const run = await this.agent.run(node, {
      serviceId: svc.id,
      image: imageTag,
      port,
      cpuLimit: svc.cpuLimit,
      memLimit: svc.memLimit,
      env,
      domain: ctx.domain,
      https: ctx.https,
      volumes: ctx.volumes,
      color: newColor,
      healthPath,
    });
    if (!run.ok) {
      throw new Error(run.error ?? 'agent run failed');
    }

    await this.setDeploy(deploymentId, { phase: 'health' });
    await this.buildLog.publish(
      deploymentId,
      `>> health-gating ${newColor} at ${healthPath} (timeout ${timeoutS}s)\n`,
    );
    const healthy = await this.waitHealthy(
      node,
      svc.id,
      newColor,
      port,
      healthPath,
      timeoutS,
      deploymentId,
    );
    if (!healthy) {
      await this.buildLog.publish(
        deploymentId,
        `!! ${newColor} did not become healthy — rolling back, old instance kept\n`,
      );
      try {
        await this.agent.removeColor(node, svc.id, newColor);
      } catch {
        // best-effort cleanup of the failed color
      }
      throw new Error(`health check failed for ${newColor} instance`);
    }

    await this.setDeploy(deploymentId, { phase: 'switch' });
    await this.buildLog.publish(
      deploymentId,
      `>> ${newColor} healthy — switching traffic and retiring old instance\n`,
    );
    await this.agent.promote(node, svc.id, newColor);

    await this.setService(svc.id, {
      status: 'RUNNING',
      containerId: run.containerId,
      currentImage: imageTag,
      activeColor: newColor,
    });
  }

  /** Polls the agent health probe until the color is healthy or timeout. */
  private async waitHealthy(
    node: typeof nodes.$inferSelect,
    serviceId: string,
    color: string,
    port: number,
    path: string,
    timeoutS: number,
    deploymentId: string,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutS * 1000;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt++;
      try {
        const res = await this.agent.health(node, {
          serviceId,
          color,
          port,
          path,
          timeoutS: 5,
        });
        if (res.healthy) {
          await this.buildLog.publish(
            deploymentId,
            `   health OK (HTTP ${res.code}) after ${attempt} attempt(s)\n`,
          );
          return true;
        }
        await this.buildLog.publish(
          deploymentId,
          `   attempt ${attempt}: HTTP ${res.code || 'no response'}\n`,
        );
      } catch (e) {
        await this.buildLog.publish(
          deploymentId,
          `   attempt ${attempt}: ${e instanceof Error ? e.message : String(e)}\n`,
        );
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    return false;
  }

  private async resolveEnv(serviceId: string): Promise<Record<string, string>> {
    const rows = await this.db
      .select()
      .from(envVars)
      .where(eq(envVars.serviceId, serviceId));
    return Object.fromEntries(
      rows.map((v) => [v.key, this.crypto.decrypt(v.valueEnc)]),
    );
  }

  private setDeploy(
    id: string,
    set: Partial<typeof deployments.$inferInsert>,
  ) {
    return this.db.update(deployments).set(set).where(eq(deployments.id, id));
  }

  private setService(id: string, set: Partial<typeof services.$inferInsert>) {
    return this.db.update(services).set(set).where(eq(services.id, id));
  }
}
