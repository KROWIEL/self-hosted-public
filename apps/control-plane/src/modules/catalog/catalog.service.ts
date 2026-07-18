import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  TIER_RANK,
  type CatalogApp,
  type CatalogEnvDefault,
  type CatalogVolumeHint,
  type LicenseTier,
} from '@selfhosted/shared';
import { DRIZZLE, Database } from '../../db/database.module';
import { catalogApps } from '../../db/schema';
import { EntitlementsService } from '../../common/licensing/entitlements.service';
import { LicenseErrors } from '../../common/errors/app-errors';
import { ServicesService } from '../services/services.service';
import { InstallCatalogAppDto } from './dto/install-catalog.dto';

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly entitlements: EntitlementsService,
    private readonly services: ServicesService,
  ) {}

  async list(): Promise<(CatalogApp & { locked: boolean })[]> {
    const ent = await this.entitlements.get();
    const rows = await this.db.select().from(catalogApps).orderBy(catalogApps.name);
    return rows.map((row) => {
      const app = this.toApp(row);
      return {
        ...app,
        locked: TIER_RANK[ent.tier] < TIER_RANK[app.minTier as LicenseTier],
      };
    });
  }

  async get(slug: string): Promise<CatalogApp & { locked: boolean }> {
    const row = await this.bySlug(slug);
    const ent = await this.entitlements.get();
    const app = this.toApp(row);
    return {
      ...app,
      locked: TIER_RANK[ent.tier] < TIER_RANK[app.minTier as LicenseTier],
    };
  }

  async install(slug: string, dto: InstallCatalogAppDto) {
    const row = await this.bySlug(slug);
    const app = this.toApp(row);
    const ent = await this.entitlements.get();
    if (TIER_RANK[ent.tier] < TIER_RANK[app.minTier as LicenseTier]) {
      throw LicenseErrors.moduleLocked(
        `catalog:${app.slug}`,
        app.minTier === 'homelab' ? 'Home-Lab' : 'Pro',
      );
    }

    const env: Record<string, string> = { ...(dto.env ?? {}) };
    for (const def of app.envDefaults) {
      if (env[def.key] === undefined && def.value !== undefined) {
        env[def.key] = def.value;
      }
      if (def.required && !env[def.key]) {
        throw new BadRequestException(
          `Environment variable ${def.key} is required for ${app.name}`,
        );
      }
    }

    const service = await this.services.create(dto.projectId, {
      name: dto.name?.trim() || app.name,
      type: 'BACKEND',
      nodeId: dto.nodeId,
      deployKind: app.deployKind,
      repoUrl: app.composeGitUrl ?? undefined,
      image: app.image ?? undefined,
      composeFile: app.composeFile ?? 'docker-compose.yml',
      composeYaml: app.composeYaml ?? undefined,
      port: app.defaultPort ?? undefined,
      env,
    });

    for (const vol of app.recommendedVolumes) {
      if (vol.mountPath) {
        await this.services.addVolume(service.id, vol.mountPath);
      }
    }

    let deployment = null;
    if (dto.deploy !== false) {
      deployment = await this.services.deploy(service.id);
    }

    return { service, deployment };
  }

  private async bySlug(slug: string) {
    const [row] = await this.db
      .select()
      .from(catalogApps)
      .where(eq(catalogApps.slug, slug))
      .limit(1);
    if (!row) throw new NotFoundException(`Catalog app "${slug}" not found`);
    return row;
  }

  private toApp(row: typeof catalogApps.$inferSelect): CatalogApp {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      category: row.category,
      icon: row.icon,
      minTier: row.minTier,
      deployKind: row.deployKind,
      image: row.image,
      composeYaml: row.composeYaml,
      composeGitUrl: row.composeGitUrl,
      composeFile: row.composeFile,
      defaultPort: row.defaultPort,
      recommendedVolumes: (row.recommendedVolumes ?? []) as CatalogVolumeHint[],
      envDefaults: (row.envDefaults ?? []) as CatalogEnvDefault[],
    };
  }
}
