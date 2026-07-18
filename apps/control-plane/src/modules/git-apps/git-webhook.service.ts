import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import {
  domains,
  gitAppInstallations,
  prPreviewLinks,
  previewEnvironments,
  services,
} from '../../db/schema';
import { EntitlementsService } from '../../common/licensing/entitlements.service';
import { PreviewService } from '../preview/preview.service';
import { GitAppProvider } from './dto/git-apps.dto';
import { GitAppsService } from './git-apps.service';
import {
  previewCommentBody,
  upsertPrComment,
} from './pr-comment';
import {
  branchSlug,
  normalizeRepoKey,
  repoAllowed,
} from './repo-normalize';
import {
  verifyGithubSignature,
  verifyGitlabToken,
} from './webhook-signature';

export type WebhookResult =
  | { ok: true; action: string; previewId?: string }
  | { ok: true; ignored: true; reason: string };

interface ParsedPrEvent {
  action: 'upsert' | 'delete' | 'ignore';
  repo: string;
  prNumber: number;
  prUrl: string | null;
  branch: string;
  headSha: string | null;
}

/**
 * Handles GitHub / GitLab PR/MR webhooks: verify signature, map to a parent
 * service, create/redeploy/delete previews via {@link PreviewService}.
 */
@Injectable()
export class GitWebhookService {
  private readonly logger = new Logger(GitWebhookService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly entitlements: EntitlementsService,
    private readonly gitApps: GitAppsService,
    private readonly previews: PreviewService,
  ) {}

  async handle(
    provider: GitAppProvider,
    opts: {
      rawBody: Buffer;
      body: unknown;
      githubSignature?: string;
      gitlabToken?: string;
      githubEvent?: string;
      gitlabEvent?: string;
    },
  ): Promise<WebhookResult> {
    if (!(await this.entitlements.hasModule('preview-envs'))) {
      return { ok: true, ignored: true, reason: 'not_licensed' };
    }

    const install = await this.gitApps.getRaw(provider);
    if (!install?.enabled) {
      return { ok: true, ignored: true, reason: 'disabled' };
    }

    const secret = this.gitApps.decryptSecret(install.webhookSecretEnc);
    if (!secret) {
      return { ok: true, ignored: true, reason: 'no_webhook_secret' };
    }

    const valid =
      provider === 'github'
        ? verifyGithubSignature(opts.rawBody, opts.githubSignature, secret)
        : verifyGitlabToken(opts.gitlabToken, secret);
    if (!valid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = this.parseEvent(provider, opts);
    if (!event || event.action === 'ignore') {
      return { ok: true, ignored: true, reason: 'irrelevant_event' };
    }

    if (!repoAllowed(event.repo, install.repoAllowlist ?? '')) {
      return { ok: true, ignored: true, reason: 'repo_not_allowed' };
    }

    if (event.action === 'delete') {
      return this.destroyPreview(provider, event);
    }
    return this.upsertPreview(provider, install, event);
  }

  private parseEvent(
    provider: GitAppProvider,
    opts: {
      body: unknown;
      githubEvent?: string;
      gitlabEvent?: string;
    },
  ): ParsedPrEvent | null {
    if (provider === 'github') {
      return this.parseGithub(opts.githubEvent, opts.body);
    }
    return this.parseGitlab(opts.gitlabEvent, opts.body);
  }

  private parseGithub(
    eventName: string | undefined,
    body: unknown,
  ): ParsedPrEvent | null {
    if (eventName && eventName !== 'pull_request') {
      return { action: 'ignore', repo: '', prNumber: 0, prUrl: null, branch: '', headSha: null };
    }
    const b = body as {
      action?: string;
      number?: number;
      pull_request?: {
        html_url?: string;
        number?: number;
        head?: { ref?: string; sha?: string };
      };
      repository?: { full_name?: string };
    };
    const action = (b.action ?? '').toLowerCase();
    const repo = normalizeRepoKey(b.repository?.full_name ?? '') ?? '';
    const prNumber = b.pull_request?.number ?? b.number ?? 0;
    const branch = b.pull_request?.head?.ref?.trim() ?? '';
    const headSha = b.pull_request?.head?.sha ?? null;
    const prUrl = b.pull_request?.html_url ?? null;

    if (!repo || !prNumber || !branch) {
      return { action: 'ignore', repo, prNumber, prUrl, branch, headSha };
    }

    if (action === 'closed') {
      return { action: 'delete', repo, prNumber, prUrl, branch, headSha };
    }
    if (
      action === 'opened' ||
      action === 'synchronize' ||
      action === 'reopened' ||
      action === 'ready_for_review'
    ) {
      return { action: 'upsert', repo, prNumber, prUrl, branch, headSha };
    }
    return { action: 'ignore', repo, prNumber, prUrl, branch, headSha };
  }

  private parseGitlab(
    eventName: string | undefined,
    body: unknown,
  ): ParsedPrEvent | null {
    const ev = (eventName ?? '').toLowerCase();
    if (ev && ev !== 'merge_request' && ev !== 'merge request hook') {
      return {
        action: 'ignore',
        repo: '',
        prNumber: 0,
        prUrl: null,
        branch: '',
        headSha: null,
      };
    }
    const b = body as {
      object_kind?: string;
      event_type?: string;
      project?: { path_with_namespace?: string };
      object_attributes?: {
        action?: string;
        iid?: number;
        url?: string;
        source_branch?: string;
        last_commit?: { id?: string };
        state?: string;
      };
    };
    const kind = (b.object_kind ?? b.event_type ?? '').toLowerCase();
    if (kind && kind !== 'merge_request') {
      return {
        action: 'ignore',
        repo: '',
        prNumber: 0,
        prUrl: null,
        branch: '',
        headSha: null,
      };
    }

    const repo = normalizeRepoKey(b.project?.path_with_namespace ?? '') ?? '';
    const attrs = b.object_attributes ?? {};
    const prNumber = attrs.iid ?? 0;
    const branch = attrs.source_branch?.trim() ?? '';
    const headSha = attrs.last_commit?.id ?? null;
    const prUrl = attrs.url ?? null;
    const action = (attrs.action ?? '').toLowerCase();

    if (!repo || !prNumber || !branch) {
      return { action: 'ignore', repo, prNumber, prUrl, branch, headSha };
    }

    if (action === 'close' || action === 'merge') {
      return { action: 'delete', repo, prNumber, prUrl, branch, headSha };
    }
    if (
      action === 'open' ||
      action === 'reopen' ||
      action === 'update' ||
      action === 'approved'
    ) {
      return { action: 'upsert', repo, prNumber, prUrl, branch, headSha };
    }
    return { action: 'ignore', repo, prNumber, prUrl, branch, headSha };
  }

  private async findParentService(
    install: typeof gitAppInstallations.$inferSelect,
    repo: string,
  ): Promise<string | null> {
    if (install.parentServiceId) {
      const [svc] = await this.db
        .select({ id: services.id, previewOf: services.previewOf })
        .from(services)
        .where(eq(services.id, install.parentServiceId))
        .limit(1);
      if (svc && !svc.previewOf) return svc.id;
    }

    const rows = await this.db
      .select({ id: services.id, repoUrl: services.repoUrl })
      .from(services)
      .where(isNull(services.previewOf));

    const key = normalizeRepoKey(repo);
    if (!key) return null;
    for (const row of rows) {
      if (!row.repoUrl) continue;
      if (normalizeRepoKey(row.repoUrl) === key) return row.id;
    }
    return null;
  }

  private async suggestHost(
    parentServiceId: string,
    branch: string,
  ): Promise<string | undefined> {
    const [domain] = await this.db
      .select()
      .from(domains)
      .where(eq(domains.serviceId, parentServiceId))
      .limit(1);
    if (!domain?.host) return undefined;
    return `${branchSlug(branch)}.${domain.host}`;
  }

  private async upsertPreview(
    provider: GitAppProvider,
    install: typeof gitAppInstallations.$inferSelect,
    event: ParsedPrEvent,
  ): Promise<WebhookResult> {
    const parentId = await this.findParentService(install, event.repo);
    if (!parentId) {
      this.logger.warn(
        `No parent service for ${provider} repo ${event.repo} — configure parentServiceId or match repoUrl`,
      );
      return { ok: true, ignored: true, reason: 'no_parent_service' };
    }

    const [existing] = await this.db
      .select()
      .from(prPreviewLinks)
      .where(
        and(
          eq(prPreviewLinks.provider, provider),
          eq(prPreviewLinks.repo, event.repo),
          eq(prPreviewLinks.prNumber, event.prNumber),
        ),
      )
      .limit(1);

    let previewId = existing?.previewId ?? null;
    let previewServiceId = existing?.previewServiceId ?? null;

    // If the linked preview was torn down, clear and recreate.
    if (previewId) {
      const [pe] = await this.db
        .select({ id: previewEnvironments.id })
        .from(previewEnvironments)
        .where(eq(previewEnvironments.id, previewId))
        .limit(1);
      if (!pe) {
        previewId = null;
        previewServiceId = null;
      }
    }

    if (previewId) {
      await this.previews.redeploy(previewId);
      await this.db
        .update(prPreviewLinks)
        .set({
          branch: event.branch,
          headSha: event.headSha,
          prUrl: event.prUrl,
          updatedAt: new Date(),
        })
        .where(eq(prPreviewLinks.id, existing!.id));
    } else {
      const host = await this.suggestHost(parentId, event.branch);
      const pe = await this.previews.create(parentId, {
        branch: event.branch,
        host,
        ttlHours: install.defaultTtlHours,
      });
      previewId = pe.id;
      previewServiceId = pe.serviceId;

      if (existing) {
        await this.db
          .update(prPreviewLinks)
          .set({
            branch: event.branch,
            headSha: event.headSha,
            prUrl: event.prUrl,
            previewId,
            previewServiceId,
            updatedAt: new Date(),
          })
          .where(eq(prPreviewLinks.id, existing.id));
      } else {
        await this.db.insert(prPreviewLinks).values({
          installationId: install.id,
          provider,
          repo: event.repo,
          prNumber: event.prNumber,
          prUrl: event.prUrl,
          branch: event.branch,
          headSha: event.headSha,
          previewId,
          previewServiceId,
        });
      }
    }

    await this.maybeComment(provider, install, event, previewId!);

    return { ok: true, action: previewId && existing?.previewId ? 'redeployed' : 'created', previewId: previewId! };
  }

  private async destroyPreview(
    provider: GitAppProvider,
    event: ParsedPrEvent,
  ): Promise<WebhookResult> {
    const [existing] = await this.db
      .select()
      .from(prPreviewLinks)
      .where(
        and(
          eq(prPreviewLinks.provider, provider),
          eq(prPreviewLinks.repo, event.repo),
          eq(prPreviewLinks.prNumber, event.prNumber),
        ),
      )
      .limit(1);

    if (!existing) {
      return { ok: true, ignored: true, reason: 'no_link' };
    }

    if (existing.previewId) {
      try {
        await this.previews.remove(existing.previewId);
      } catch (e) {
        this.logger.warn(
          `Failed to remove preview ${existing.previewId}: ${(e as Error).message}`,
        );
      }
    }

    await this.db
      .delete(prPreviewLinks)
      .where(eq(prPreviewLinks.id, existing.id));

    return { ok: true, action: 'deleted', previewId: existing.previewId ?? undefined };
  }

  private async maybeComment(
    provider: GitAppProvider,
    install: typeof gitAppInstallations.$inferSelect,
    event: ParsedPrEvent,
    previewId: string,
  ) {
    if (!install.commentOnPr) return;
    const token = this.gitApps.decryptSecret(install.accessTokenEnc);
    if (!token) return;

    const [link] = await this.db
      .select()
      .from(prPreviewLinks)
      .where(
        and(
          eq(prPreviewLinks.provider, provider),
          eq(prPreviewLinks.repo, event.repo),
          eq(prPreviewLinks.prNumber, event.prNumber),
        ),
      )
      .limit(1);

    const [pe] = await this.db
      .select()
      .from(previewEnvironments)
      .where(eq(previewEnvironments.id, previewId))
      .limit(1);
    const [domain] = pe
      ? await this.db
          .select()
          .from(domains)
          .where(eq(domains.serviceId, pe.serviceId))
          .limit(1)
      : [null];

    const host = domain?.host ?? pe?.host ?? null;
    const https = domain?.https ?? true;
    const previewUrl = host ? `${https ? 'https' : 'http'}://${host}` : null;
    const appBase = process.env.APP_BASE_URL?.trim().replace(/\/+$/, '') || null;
    const panelUrl = appBase ? `${appBase}/previews` : null;

    const commentId = await upsertPrComment({
      provider,
      repo: event.repo,
      prNumber: event.prNumber,
      commentId: link?.commentId,
      accessToken: token,
      body: previewCommentBody({
        previewUrl,
        branch: event.branch,
        panelUrl,
      }),
    });

    if (commentId && link && commentId !== link.commentId) {
      await this.db
        .update(prPreviewLinks)
        .set({ commentId, updatedAt: new Date() })
        .where(eq(prPreviewLinks.id, link.id));
    }
  }
}
