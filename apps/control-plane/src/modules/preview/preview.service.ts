import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import {
  deployments,
  domains,
  envVars,
  prPreviewLinks,
  previewEnvironments,
  services,
} from '../../db/schema';
import { Actor, MembersService } from '../members/members.service';
import { ServicesService } from '../services/services.service';
import { CreatePreviewDto } from './dto/preview.dto';

const DEFAULT_TTL_HOURS = numFromEnv('PREVIEW_DEFAULT_TTL_HOURS', 72);

/**
 * Preview environments (Pro: preview-envs). A preview is a disposable *child
 * service* cloned from a parent: same node/template/repo/env, but built from a
 * chosen branch and routed to its own optional subdomain. It reuses the whole
 * build/deploy pipeline (nothing agent-side changes) and is torn down manually
 * or automatically once its TTL lapses.
 */
@Injectable()
export class PreviewService {
  private readonly logger = new Logger(PreviewService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly services: ServicesService,
    private readonly members: MembersService,
  ) {}

  /** Create + deploy a preview for `parentServiceId` from a branch. */
  async create(parentServiceId: string, dto: CreatePreviewDto) {
    const parent = await this.services.getDetail(parentServiceId);
    if (parent.previewOf) {
      throw new BadRequestException(
        'Cannot create a preview of a preview environment.',
      );
    }

    const branch = dto.branch.trim();
    const slug = branchSlug(branch);
    const name = `${parent.name}-${slug}`.slice(0, 60);

    // Clone the parent service (quota is enforced inside ServicesService.create).
    const child = await this.services.create(parent.projectId, {
      name,
      type: parent.type,
      nodeId: parent.nodeId,
      templateId: parent.templateId ?? undefined,
      deployKind: parent.deployKind ?? 'git',
      repoUrl: parent.repoUrl ?? undefined,
      image: parent.image ?? undefined,
      composeFile: parent.composeFile ?? undefined,
      composeYaml: parent.composeYaml ?? undefined,
      branch,
      gitCredId: parent.gitCredId ?? undefined,
      useRepoDockerfile: parent.useRepoDockerfile,
      buildCommand: parent.buildCommand ?? undefined,
      runCommand: parent.runCommand ?? undefined,
      port: parent.port ?? undefined,
      cpuLimit: parent.cpuLimit,
      memLimit: parent.memLimit,
    });

    // Flag it as a preview so it's hidden from normal service listings.
    await this.db
      .update(services)
      .set({ previewOf: parentServiceId })
      .where(eq(services.id, child.id));

    // Copy env vars verbatim (preserving encryption + secret flags).
    const parentEnv = await this.db
      .select()
      .from(envVars)
      .where(eq(envVars.serviceId, parentServiceId));
    if (parentEnv.length) {
      await this.db.insert(envVars).values(
        parentEnv.map((e) => ({
          serviceId: child.id,
          key: e.key,
          valueEnc: e.valueEnc,
          isSecret: e.isSecret,
        })),
      );
    }

    const host = dto.host?.trim() || null;
    if (host) {
      await this.services.setDomain(child.id, {
        host,
        https: parent.domain?.https ?? true,
      });
    }

    const ttlHours = dto.ttlHours ?? DEFAULT_TTL_HOURS;
    const expiresAt =
      ttlHours > 0 ? new Date(Date.now() + ttlHours * 3_600_000) : null;

    const [pe] = await this.db
      .insert(previewEnvironments)
      .values({
        parentServiceId,
        serviceId: child.id,
        branch,
        host,
        status: 'CREATING',
        expiresAt,
      })
      .returning();

    // Kick off the first build/deploy.
    await this.services.deploy(child.id);

    return this.enrich(pe);
  }

  /** All previews of a single parent service. */
  async listForService(parentServiceId: string) {
    const rows = await this.db
      .select()
      .from(previewEnvironments)
      .where(eq(previewEnvironments.parentServiceId, parentServiceId))
      .orderBy(desc(previewEnvironments.createdAt));
    return Promise.all(rows.map((pe) => this.enrich(pe)));
  }

  /** All previews across the projects the actor can access (for the nav page). */
  async listAll(actor: Actor) {
    const accessible = await this.members.accessibleProjectIds(actor);
    if (accessible !== 'ALL' && accessible.length === 0) return [];

    const joined = await this.db
      .select({ pe: previewEnvironments, projectId: services.projectId })
      .from(previewEnvironments)
      .innerJoin(services, eq(previewEnvironments.serviceId, services.id))
      .orderBy(desc(previewEnvironments.createdAt));

    const visible =
      accessible === 'ALL'
        ? joined
        : joined.filter((r) => accessible.includes(r.projectId));

    return Promise.all(visible.map((r) => this.enrich(r.pe)));
  }

  private async get(previewId: string) {
    const [pe] = await this.db
      .select()
      .from(previewEnvironments)
      .where(eq(previewEnvironments.id, previewId))
      .limit(1);
    if (!pe) throw new NotFoundException('Preview environment not found');
    return pe;
  }

  /** Rebuild + redeploy an existing preview (e.g. after new commits). */
  async redeploy(previewId: string) {
    const pe = await this.get(previewId);
    await this.services.deploy(pe.serviceId);
    await this.db
      .update(previewEnvironments)
      .set({ status: 'CREATING', updatedAt: new Date() })
      .where(eq(previewEnvironments.id, previewId));
    return this.enrich({ ...pe, status: 'CREATING' });
  }

  /** Tear down a preview: removes its child service (container + image + rows). */
  async remove(previewId: string) {
    const pe = await this.get(previewId);
    // Deleting the child service cascades away the preview row (serviceId FK).
    await this.services.remove(pe.serviceId);
    return { ok: true };
  }

  /**
   * Remove every preview whose TTL has lapsed. Called by the cleanup worker.
   * Returns the number of previews torn down.
   */
  async cleanupExpired(): Promise<number> {
    const now = Date.now();
    // Preview counts are small — fetch and filter in JS to keep this trivial.
    const all = await this.db.select().from(previewEnvironments);
    const expired = all.filter(
      (pe) => pe.expiresAt !== null && pe.expiresAt.getTime() <= now,
    );
    let removed = 0;
    for (const pe of expired) {
      try {
        await this.services.remove(pe.serviceId);
        removed++;
      } catch (e) {
        this.logger.warn(
          `Failed to tear down expired preview ${pe.id}: ${(e as Error).message}`,
        );
      }
    }
    return removed;
  }

  /** Attach the parent name, child service status, latest deploy, and optional PR link. */
  private async enrich(pe: typeof previewEnvironments.$inferSelect) {
    const [child] = await this.db
      .select()
      .from(services)
      .where(eq(services.id, pe.serviceId))
      .limit(1);
    const [parent] = await this.db
      .select({ name: services.name })
      .from(services)
      .where(eq(services.id, pe.parentServiceId))
      .limit(1);
    const [domain] = await this.db
      .select()
      .from(domains)
      .where(eq(domains.serviceId, pe.serviceId))
      .limit(1);
    const [lastDeploy] = await this.db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceId, pe.serviceId))
      .orderBy(desc(deployments.createdAt))
      .limit(1);
    const [prLink] = await this.db
      .select()
      .from(prPreviewLinks)
      .where(eq(prPreviewLinks.previewId, pe.id))
      .limit(1);

    return {
      id: pe.id,
      parentServiceId: pe.parentServiceId,
      parentName: parent?.name ?? null,
      serviceId: pe.serviceId,
      serviceName: child?.name ?? null,
      branch: pe.branch,
      host: domain?.host ?? pe.host ?? null,
      https: domain?.https ?? true,
      serviceStatus: child?.status ?? null,
      latestDeployStatus: lastDeploy?.status ?? null,
      latestDeployPhase: lastDeploy?.phase ?? null,
      expiresAt: pe.expiresAt,
      createdAt: pe.createdAt,
      pr: prLink
        ? {
            provider: prLink.provider,
            repo: prLink.repo,
            number: prLink.prNumber,
            url: prLink.prUrl,
          }
        : null,
    };
  }
}

function branchSlug(branch: string): string {
  return (
    branch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'preview'
  );
}

function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
