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
  composeProjectName,
  createRedisConnection,
  deployLockKey,
} from './deploy.constants';

export { composeProjectName };

/**
 * Consumes deploy jobs and drives the full pipeline on the target node:
 * build image from git -> run container -> update service/deployment rows.
 * Also handles image-pull and docker-compose deploy kinds.
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

    const kind = svc.deployKind ?? 'git';

    // Image/compose do not use language-stack templates.
    let tpl: typeof templates.$inferSelect | null = null;
    if (kind === 'git') {
      if (!svc.templateId) throw new Error('templateId required for git deploy');
      tpl = (
        await this.db
          .select()
          .from(templates)
          .where(eq(templates.id, svc.templateId))
          .limit(1)
      )[0];
      if (!tpl) throw new Error(`template ${svc.templateId} not found`);
    }

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
    void gitUsername; // reserved for future clone auth variants

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

    try {
      if (kind === 'compose') {
        await this.deployCompose({
          deploymentId,
          serviceId,
          svc,
          node,
          env,
          domainRow,
          patToken,
        });
      } else if (kind === 'image') {
        await this.deployImage({
          deploymentId,
          serviceId,
          svc,
          node,
          env,
          domainRow,
          volumeRows,
        });
      } else {
        await this.deployGit({
          deploymentId,
          serviceId,
          svc,
          node,
          tpl: tpl!,
          env,
          domainRow,
          volumeRows,
          patToken,
          rollbackImageTag,
          rollbackCommitSha,
        });
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
      await this.lockRedis
        .del(deployLockKey(serviceId))
        .catch(() => undefined);
    }
  }

  private async deployCompose(ctx: {
    deploymentId: string;
    serviceId: string;
    svc: typeof services.$inferSelect;
    node: typeof nodes.$inferSelect;
    env: Record<string, string>;
    domainRow: typeof domains.$inferSelect | undefined;
    patToken?: string;
  }) {
    const { deploymentId, serviceId, svc, node, env, domainRow, patToken } = ctx;
    const projectName = composeProjectName(serviceId);

    await this.setDeploy(deploymentId, { status: 'BUILDING', phase: 'build' });
    await this.setService(serviceId, { status: 'BUILDING' });

    const result = await this.agent.composeUp(
      node,
      {
        serviceId,
        repoUrl: svc.repoUrl ?? undefined,
        branch: svc.branch,
        composeFile: svc.composeFile ?? 'docker-compose.yml',
        composeYaml: svc.composeYaml ?? undefined,
        patToken,
        env,
        projectName,
        domain: domainRow?.host,
        https: domainRow?.https,
      },
      (chunk) => void this.buildLog.publish(deploymentId, chunk),
    );

    await this.setDeploy(deploymentId, {
      status: 'DEPLOYING',
      imageTag: `compose:${projectName}`,
      buildLog: result.buildLog,
      phase: 'run',
    });
    await this.setService(serviceId, {
      status: 'RUNNING',
      containerId: projectName,
      currentImage: `compose:${projectName}`,
      activeColor: null,
    });
    await this.setDeploy(deploymentId, {
      status: 'SUCCESS',
      finishedAt: new Date(),
    });
  }

  private async deployImage(ctx: {
    deploymentId: string;
    serviceId: string;
    svc: typeof services.$inferSelect;
    node: typeof nodes.$inferSelect;
    env: Record<string, string>;
    domainRow: typeof domains.$inferSelect | undefined;
    volumeRows: (typeof volumes.$inferSelect)[];
  }) {
    const { deploymentId, serviceId, svc, node, env, domainRow, volumeRows } =
      ctx;
    if (!svc.image) throw new Error('image is required for image deploy');

    await this.setDeploy(deploymentId, {
      status: 'DEPLOYING',
      phase: 'run',
      imageTag: svc.image,
      buildLog: `Pulling image ${svc.image}`,
    });
    await this.setService(serviceId, { status: 'BUILDING' });
    await this.buildLog.publish(
      deploymentId,
      `>> deploying image ${svc.image}\n`,
    );

    const port = svc.port ?? 80;
    const volumeMounts = volumeRows.map((v) => ({
      name: v.name,
      mountPath: v.mountPath,
    }));

    await this.setDeploy(deploymentId, { phase: 'run' });
    await this.ensureCustomCert(node, domainRow);
    const run = await this.agent.runImage(node, {
      serviceId,
      image: svc.image,
      port,
      cpuLimit: svc.cpuLimit,
      memLimit: svc.memLimit,
      env,
      domain: domainRow?.host,
      https: domainRow?.https,
      customTls: this.isCustomTls(domainRow),
      volumes: volumeMounts,
    });
    if (!run.ok) {
      throw new Error(run.error ?? 'agent run-image failed');
    }
    if (run.log) {
      await this.buildLog.publish(deploymentId, run.log);
    }

    await this.setService(serviceId, {
      status: 'RUNNING',
      containerId: run.containerId,
      currentImage: svc.image,
      activeColor: null,
    });
    await this.setDeploy(deploymentId, {
      status: 'SUCCESS',
      finishedAt: new Date(),
    });
  }

  private async deployGit(ctx: {
    deploymentId: string;
    serviceId: string;
    svc: typeof services.$inferSelect;
    node: typeof nodes.$inferSelect;
    tpl: typeof templates.$inferSelect;
    env: Record<string, string>;
    domainRow: typeof domains.$inferSelect | undefined;
    volumeRows: (typeof volumes.$inferSelect)[];
    patToken?: string;
    rollbackImageTag?: string;
    rollbackCommitSha?: string;
  }) {
    const {
      deploymentId,
      serviceId,
      svc,
      node,
      tpl,
      env,
      domainRow,
      volumeRows,
      patToken,
      rollbackImageTag,
      rollbackCommitSha,
    } = ctx;

    if (!svc.repoUrl) throw new Error('repoUrl is required for git deploy');

    const isRollback = !!rollbackImageTag;
    const imageTag =
      rollbackImageTag ??
      `svc-${serviceId.slice(0, 8)}:${deploymentId.slice(0, 8)}`;

    if (isRollback) {
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
          buildImage: tpl.installImage,
          runImage: tpl.baseImage,
          dockerfile: tpl.dockerfilePath ?? undefined,
          useRepoDockerfile: svc.useRepoDockerfile,
          buildMode: svc.buildMode ?? undefined,
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

    if (svc.zeroDowntime && volumeRows.length > 0) {
      await this.buildLog.publish(
        deploymentId,
        '>> note: zero-downtime skipped — service has persistent volumes; ' +
          'using in-place deploy\n',
      );
    }
    if (svc.zeroDowntime && domainRow?.host && volumeRows.length === 0) {
      await this.ensureCustomCert(node, domainRow);
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
        customTls: this.isCustomTls(domainRow),
        volumes: volumeMounts,
      });
    } else {
      await this.setDeploy(deploymentId, { phase: 'run' });
      await this.ensureCustomCert(node, domainRow);
      const run = await this.agent.run(node, {
        serviceId,
        image: imageTag,
        port,
        cpuLimit: svc.cpuLimit,
        memLimit: svc.memLimit,
        env,
        domain: domainRow?.host,
        https: domainRow?.https,
        customTls: this.isCustomTls(domainRow),
        volumes: volumeMounts,
      });
      if (!run.ok) {
        throw new Error(run.error ?? 'agent run failed');
      }
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

    try {
      await this.agent.gc(node, serviceId, imageTag);
    } catch (gcErr) {
      this.logger.warn(
        `GC for ${serviceId} failed: ${
          gcErr instanceof Error ? gcErr.message : String(gcErr)
        }`,
      );
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
    customTls?: boolean;
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
      customTls: ctx.customTls ?? false,
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

  private isCustomTls(domainRow?: typeof domains.$inferSelect): boolean {
    return domainRow?.certSource === 'custom' && !!domainRow.customCertEnc;
  }

  /** Re-push encrypted custom PEMs to the node before deploy (best-effort). */
  private async ensureCustomCert(
    node: typeof nodes.$inferSelect,
    domainRow?: typeof domains.$inferSelect,
  ) {
    if (
      !domainRow ||
      domainRow.certSource !== 'custom' ||
      !domainRow.customCertEnc ||
      !domainRow.customKeyEnc
    ) {
      return;
    }
    await this.agent.putCert(node, {
      host: domainRow.host,
      certPem: this.crypto.decrypt(domainRow.customCertEnc),
      keyPem: this.crypto.decrypt(domainRow.customKeyEnc),
    });
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
