import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  assertLanSafeHost,
  SsrfBlockedError,
} from '../../common/net/ssrf-guard';
import { backups, offsiteConfig, offsiteUploads } from '../../db/schema';
import { BackupsService } from '../backups/backups.service';
import { SetOffsiteConfigDto } from './dto/offsite.dto';
import {
  asProviderConfig,
  GCS_S3_ENDPOINT,
  isOffsiteProvider,
  joinRemoteKey,
  validateOffsiteConfig,
  type OffsiteProvider,
  type ProviderConfig,
} from './offsite.providers';
import { buildUploader } from './offsite.uploader';

type ConfigRow = typeof offsiteConfig.$inferSelect;

/** Only push backups from the last N days; older ones are considered rotated. */
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Mirrors local backups to an offsite destination (S3, GCS via S3-compat,
 * Azure Blob, or SFTP). Credentials are encrypted at rest; secrets are never
 * returned to the UI.
 */
@Injectable()
export class OffsiteService {
  private readonly logger = new Logger(OffsiteService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly backups: BackupsService,
  ) {}

  private async getConfigRow(): Promise<ConfigRow | null> {
    const [row] = await this.db
      .select()
      .from(offsiteConfig)
      .where(eq(offsiteConfig.id, 'default'))
      .limit(1);
    return row ?? null;
  }

  private providerOf(row: ConfigRow | null): OffsiteProvider {
    const p = row?.provider ?? 's3';
    return isOffsiteProvider(p) ? p : 's3';
  }

  private providerConfigOf(row: ConfigRow | null): ProviderConfig {
    return asProviderConfig(row?.providerConfig ?? {});
  }

  async getConfig() {
    const row = await this.getConfigRow();
    const provider = this.providerOf(row);
    return {
      enabled: row?.enabled ?? false,
      provider,
      endpoint:
        row?.endpoint ||
        (provider === 'gcs' ? GCS_S3_ENDPOINT : ''),
      region: row?.region ?? 'us-east-1',
      bucket: row?.bucket ?? '',
      prefix: row?.prefix ?? '',
      accessKeyId: row?.accessKeyId ?? '',
      forcePathStyle: row?.forcePathStyle ?? true,
      providerConfig: this.providerConfigOf(row),
      secretKeySet: !!row?.secretKeyEnc,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async setConfig(dto: SetOffsiteConfigDto) {
    const existing = await this.getConfigRow();
    const provider: OffsiteProvider =
      dto.provider && isOffsiteProvider(dto.provider)
        ? dto.provider
        : this.providerOf(existing);

    const secretKeyEnc = dto.secretKey
      ? this.crypto.encrypt(dto.secretKey)
      : existing?.secretKeyEnc ?? '';

    const prevCfg = this.providerConfigOf(existing);
    const nextCfg: ProviderConfig = dto.providerConfig
      ? { ...prevCfg, ...asProviderConfig(dto.providerConfig) }
      : prevCfg;

    let endpoint = dto.endpoint ?? existing?.endpoint ?? '';
    if (provider === 'gcs' && !endpoint.trim()) {
      endpoint = GCS_S3_ENDPOINT;
    }

    const values = {
      id: 'default' as const,
      enabled: dto.enabled ?? existing?.enabled ?? false,
      provider,
      endpoint,
      region: dto.region ?? existing?.region ?? 'us-east-1',
      bucket: dto.bucket ?? existing?.bucket ?? '',
      prefix: dto.prefix ?? existing?.prefix ?? '',
      accessKeyId: dto.accessKeyId ?? existing?.accessKeyId ?? '',
      secretKeyEnc,
      forcePathStyle: dto.forcePathStyle ?? existing?.forcePathStyle ?? true,
      providerConfig: nextCfg,
      updatedAt: new Date(),
    };

    const validation = validateOffsiteConfig({
      provider,
      endpoint: values.endpoint,
      region: values.region,
      bucket: values.bucket,
      accessKeyId: values.accessKeyId,
      secretKeySet: !!values.secretKeyEnc,
      providerConfig: nextCfg,
    });
    // Allow saving a partial draft when disabled; require full config when enabling.
    if (values.enabled && validation.length) {
      throw new BadRequestException(
        `Offsite destination incomplete: ${validation.join('; ')}`,
      );
    }

    if (values.enabled) {
      await this.assertDestinationSafe(provider, values.endpoint, nextCfg, secretKeyEnc
        ? this.crypto.decrypt(secretKeyEnc)
        : '');
    }

    await this.db
      .insert(offsiteConfig)
      .values(values)
      .onConflictDoUpdate({ target: offsiteConfig.id, set: values });
    return this.getConfig();
  }

  /**
   * Blocks loopback / link-local / cloud-metadata destinations while still
   * allowing RFC-1918 MinIO and LAN SFTP (common self-hosted setups).
   */
  private async assertDestinationSafe(
    provider: OffsiteProvider,
    endpoint: string,
    cfg: ProviderConfig,
    secret: string,
  ): Promise<void> {
    try {
      if (provider === 's3' || provider === 'gcs') {
        const raw = (endpoint || (provider === 'gcs' ? GCS_S3_ENDPOINT : '')).trim();
        if (!raw) return;
        let host: string;
        try {
          host = new URL(raw).hostname;
        } catch {
          throw new BadRequestException('endpoint must be a valid URL');
        }
        await assertLanSafeHost(host);
        return;
      }
      if (provider === 'sftp') {
        const host = (cfg.host || '').trim();
        if (host) await assertLanSafeHost(host);
        return;
      }
      if (provider === 'azure') {
        if (cfg.useConnectionString) {
          const host = assertAzureConnectionStringSafe(secret);
          if (host) await assertLanSafeHost(host);
        } else {
          const account = (cfg.accountName || '').trim();
          if (account) {
            await assertLanSafeHost(`${account}.blob.core.windows.net`);
          }
        }
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      if (e instanceof SsrfBlockedError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
  }

  private async uploader() {
    const row = await this.getConfigRow();
    if (!row) {
      throw new BadRequestException('Offsite destination is not configured');
    }
    const provider = this.providerOf(row);
    const providerConfig = this.providerConfigOf(row);
    const secretKey = row.secretKeyEnc
      ? this.crypto.decrypt(row.secretKeyEnc)
      : '';
    const errs = validateOffsiteConfig({
      provider,
      endpoint: row.endpoint,
      region: row.region,
      bucket: row.bucket,
      accessKeyId: row.accessKeyId,
      secretKeySet: !!secretKey,
      providerConfig,
    });
    if (errs.length) {
      throw new BadRequestException(
        `Offsite destination is not fully configured: ${errs.join('; ')}`,
      );
    }
    await this.assertDestinationSafe(
      provider,
      row.endpoint,
      providerConfig,
      secretKey,
    );
    return {
      row,
      uploader: buildUploader({
        provider,
        endpoint: row.endpoint || (provider === 'gcs' ? GCS_S3_ENDPOINT : ''),
        region: row.region,
        bucket: row.bucket,
        accessKeyId: row.accessKeyId,
        secretKey,
        forcePathStyle: row.forcePathStyle,
        providerConfig,
      }),
    };
  }

  /** Round-trips a tiny object to verify credentials + destination access. */
  async testConfig() {
    const { row, uploader } = await this.uploader();
    await uploader.test(row.prefix);
    return { ok: true };
  }

  async uploadBackup(
    backupId: string,
  ): Promise<{ ok: boolean; key?: string; error?: string }> {
    const backup = await this.backups.get(backupId);
    if (backup.status !== 'SUCCESS') {
      throw new BadRequestException('Only successful backups can be uploaded');
    }
    const { row, uploader } = await this.uploader();
    const key = joinRemoteKey(row.prefix, backup.fileName);
    try {
      const { res } = await this.backups.openDownload(backupId);
      if (!res.body) throw new Error('empty backup stream from node');
      const body = Readable.fromWeb(res.body as never);
      await uploader.upload(body, key);
      await this.recordUpload(backupId, key, 'uploaded', backup.sizeBytes ?? null, null);
      return { ok: true, key };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.recordUpload(backupId, key, 'failed', null, msg.slice(0, 1000));
      this.logger.warn(`Offsite upload of ${backupId} failed: ${msg}`);
      return { ok: false, key, error: msg };
    }
  }

  private async recordUpload(
    backupId: string,
    key: string,
    status: 'uploaded' | 'failed',
    sizeBytes: number | null,
    error: string | null,
  ) {
    await this.db
      .insert(offsiteUploads)
      .values({ backupId, key, status, sizeBytes, error })
      .onConflictDoUpdate({
        target: offsiteUploads.backupId,
        set: { key, status, sizeBytes, error, createdAt: new Date() },
      });
  }

  listUploads(limit = 100) {
    return this.db
      .select({
        id: offsiteUploads.id,
        backupId: offsiteUploads.backupId,
        key: offsiteUploads.key,
        status: offsiteUploads.status,
        sizeBytes: offsiteUploads.sizeBytes,
        error: offsiteUploads.error,
        createdAt: offsiteUploads.createdAt,
        fileName: backups.fileName,
      })
      .from(offsiteUploads)
      .leftJoin(backups, eq(backups.id, offsiteUploads.backupId))
      .orderBy(desc(offsiteUploads.createdAt))
      .limit(Math.min(Math.max(limit, 1), 500));
  }

  /**
   * Pushes recent successful backups that aren't offsite yet (or previously
   * failed). Best-effort and bounded per run. No-op unless enabled.
   */
  async uploadPending(maxBatch = 20): Promise<{ uploaded: number; failed: number }> {
    const row = await this.getConfigRow();
    if (!row || !row.enabled) return { uploaded: 0, failed: 0 };

    const since = new Date(Date.now() - LOOKBACK_MS);
    const candidates = await this.db
      .select({ id: backups.id })
      .from(backups)
      .leftJoin(offsiteUploads, eq(offsiteUploads.backupId, backups.id))
      .where(
        and(
          eq(backups.status, 'SUCCESS'),
          gt(backups.createdAt, since),
          or(isNull(offsiteUploads.id), eq(offsiteUploads.status, 'failed')),
        ),
      )
      .orderBy(desc(backups.createdAt))
      .limit(maxBatch);

    let uploaded = 0;
    let failed = 0;
    for (const c of candidates) {
      const r = await this.uploadBackup(c.id);
      if (r.ok) uploaded++;
      else failed++;
    }
    return { uploaded, failed };
  }
}

/** Reject Azure connection strings that clearly target metadata/loopback. */
function assertAzureConnectionStringSafe(cs: string): string | null {
  const lower = cs.toLowerCase();
  if (
    /169\.254\.|127\.0\.0\.|0\.0\.0\.0|localhost|\[::1\]/.test(lower)
  ) {
    throw new BadRequestException(
      'Azure connection string must not target loopback or link-local addresses',
    );
  }
  const m = cs.match(/BlobEndpoint=([^;]+)/i);
  if (!m?.[1]) return null;
  try {
    const u = new URL(m[1].trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new BadRequestException('Azure BlobEndpoint must be http(s)');
    }
    return u.hostname;
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException('Azure BlobEndpoint is not a valid URL');
  }
}
