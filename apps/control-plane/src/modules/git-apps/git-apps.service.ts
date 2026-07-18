import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { gitAppInstallations, services } from '../../db/schema';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  GitAppProvider,
  SetGitAppConfigDto,
} from './dto/git-apps.dto';

export interface ReqLike {
  headers?: Record<string, string | string[] | undefined>;
  protocol?: string;
}

/**
 * Admin CRUD for GitHub/GitLab App (webhook) installs used by PR-triggered
 * preview environments (Pro: preview-envs).
 */
@Injectable()
export class GitAppsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  private originFromReq(req: ReqLike | null): string {
    const h = req?.headers ?? {};
    const xfProto = String(h['x-forwarded-proto'] ?? '')
      .split(',')[0]
      .trim();
    const proto = xfProto || req?.protocol || 'http';
    const host = String(h['x-forwarded-host'] ?? h['host'] ?? 'localhost:3001')
      .split(',')[0]
      .trim();
    return `${proto}://${host}`;
  }

  /** Public API base used to build copyable webhook URLs. */
  apiBase(req: ReqLike | null): string {
    const envApi = process.env.PUBLIC_API_URL?.trim();
    if (envApi) return envApi.replace(/\/+$/, '');
    return `${this.originFromReq(req)}/api/v1`;
  }

  webhookUrl(provider: GitAppProvider, req: ReqLike | null): string {
    return `${this.apiBase(req)}/webhooks/git/${provider}`;
  }

  private async row(provider: GitAppProvider) {
    const [r] = await this.db
      .select()
      .from(gitAppInstallations)
      .where(eq(gitAppInstallations.id, provider))
      .limit(1);
    return r ?? null;
  }

  private async ensureRow(provider: GitAppProvider) {
    const existing = await this.row(provider);
    if (existing) return existing;
    const [created] = await this.db
      .insert(gitAppInstallations)
      .values({ id: provider })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    return (await this.row(provider))!;
  }

  async list(req: ReqLike | null) {
    const providers: GitAppProvider[] = ['github', 'gitlab'];
    return Promise.all(providers.map((p) => this.getConfig(p, req)));
  }

  async getConfig(provider: GitAppProvider, req: ReqLike | null) {
    const r = await this.ensureRow(provider);
    let parentName: string | null = null;
    if (r.parentServiceId) {
      const [svc] = await this.db
        .select({ name: services.name })
        .from(services)
        .where(eq(services.id, r.parentServiceId))
        .limit(1);
      parentName = svc?.name ?? null;
    }
    return {
      provider,
      enabled: r.enabled,
      hasWebhookSecret: !!r.webhookSecretEnc,
      hasAccessToken: !!r.accessTokenEnc,
      githubAppId: r.githubAppId ?? '',
      hasGithubPrivateKey: !!r.githubPrivateKeyEnc,
      parentServiceId: r.parentServiceId,
      parentServiceName: parentName,
      repoAllowlist: r.repoAllowlist ?? '',
      defaultTtlHours: r.defaultTtlHours,
      commentOnPr: r.commentOnPr,
      webhookUrl: this.webhookUrl(provider, req),
    };
  }

  async setConfig(
    provider: GitAppProvider,
    dto: SetGitAppConfigDto,
    req: ReqLike | null,
  ) {
    const existing = await this.ensureRow(provider);

    let webhookSecretEnc = existing.webhookSecretEnc ?? '';
    if (dto.webhookSecret !== undefined && dto.webhookSecret !== '') {
      webhookSecretEnc = this.crypto.encrypt(dto.webhookSecret);
    }

    let accessTokenEnc = existing.accessTokenEnc ?? '';
    if (dto.accessToken !== undefined && dto.accessToken !== '') {
      accessTokenEnc = this.crypto.encrypt(dto.accessToken);
    }

    let githubPrivateKeyEnc = existing.githubPrivateKeyEnc ?? null;
    if (dto.githubPrivateKey !== undefined && dto.githubPrivateKey !== '') {
      githubPrivateKeyEnc = this.crypto.encrypt(dto.githubPrivateKey);
    }

    let parentServiceId =
      dto.parentServiceId !== undefined
        ? dto.parentServiceId?.trim() || null
        : existing.parentServiceId;
    if (parentServiceId) {
      const [svc] = await this.db
        .select({ id: services.id })
        .from(services)
        .where(eq(services.id, parentServiceId))
        .limit(1);
      if (!svc) throw new NotFoundException('Parent service not found');
    }

    const values = {
      id: provider,
      enabled: dto.enabled ?? existing.enabled,
      webhookSecretEnc,
      accessTokenEnc,
      githubAppId:
        dto.githubAppId !== undefined
          ? dto.githubAppId.trim() || null
          : existing.githubAppId,
      githubPrivateKeyEnc,
      parentServiceId: parentServiceId ?? null,
      repoAllowlist:
        dto.repoAllowlist !== undefined
          ? dto.repoAllowlist.trim()
          : existing.repoAllowlist,
      defaultTtlHours:
        dto.defaultTtlHours !== undefined
          ? dto.defaultTtlHours
          : existing.defaultTtlHours,
      commentOnPr:
        dto.commentOnPr !== undefined ? dto.commentOnPr : existing.commentOnPr,
      updatedAt: new Date(),
    };

    await this.db
      .insert(gitAppInstallations)
      .values(values)
      .onConflictDoUpdate({
        target: gitAppInstallations.id,
        set: {
          enabled: values.enabled,
          webhookSecretEnc: values.webhookSecretEnc,
          accessTokenEnc: values.accessTokenEnc,
          githubAppId: values.githubAppId,
          githubPrivateKeyEnc: values.githubPrivateKeyEnc,
          parentServiceId: values.parentServiceId,
          repoAllowlist: values.repoAllowlist,
          defaultTtlHours: values.defaultTtlHours,
          commentOnPr: values.commentOnPr,
          updatedAt: values.updatedAt,
        },
      });

    return this.getConfig(provider, req);
  }

  /** Internal: load decryptable install row (or null). */
  async getRaw(provider: GitAppProvider) {
    return this.row(provider);
  }

  decryptSecret(enc: string | null | undefined): string {
    if (!enc) return '';
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return '';
    }
  }
}
