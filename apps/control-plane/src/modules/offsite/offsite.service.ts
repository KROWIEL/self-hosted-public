import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'node:stream';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { CryptoService } from '../../common/crypto/crypto.service';
import { backups, offsiteConfig, offsiteUploads } from '../../db/schema';
import { BackupsService } from '../backups/backups.service';
import { SetOffsiteConfigDto } from './dto/offsite.dto';

type ConfigRow = typeof offsiteConfig.$inferSelect;

/** Only push backups from the last N days; older ones are considered rotated. */
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Mirrors local backups to an S3-compatible bucket (AWS S3, MinIO, R2, …).
 * Credentials are encrypted at rest; the secret is never returned to the UI.
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

  async getConfig() {
    const row = await this.getConfigRow();
    return {
      enabled: row?.enabled ?? false,
      endpoint: row?.endpoint ?? '',
      region: row?.region ?? 'us-east-1',
      bucket: row?.bucket ?? '',
      prefix: row?.prefix ?? '',
      accessKeyId: row?.accessKeyId ?? '',
      forcePathStyle: row?.forcePathStyle ?? true,
      secretKeySet: !!row?.secretKeyEnc,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async setConfig(dto: SetOffsiteConfigDto) {
    const existing = await this.getConfigRow();
    const secretKeyEnc = dto.secretKey
      ? this.crypto.encrypt(dto.secretKey)
      : existing?.secretKeyEnc ?? '';
    const values = {
      id: 'default',
      enabled: dto.enabled ?? existing?.enabled ?? false,
      endpoint: dto.endpoint ?? existing?.endpoint ?? '',
      region: dto.region ?? existing?.region ?? 'us-east-1',
      bucket: dto.bucket ?? existing?.bucket ?? '',
      prefix: dto.prefix ?? existing?.prefix ?? '',
      accessKeyId: dto.accessKeyId ?? existing?.accessKeyId ?? '',
      secretKeyEnc,
      forcePathStyle: dto.forcePathStyle ?? existing?.forcePathStyle ?? true,
      updatedAt: new Date(),
    };
    await this.db
      .insert(offsiteConfig)
      .values(values)
      .onConflictDoUpdate({ target: offsiteConfig.id, set: values });
    return this.getConfig();
  }

  private async client(): Promise<{ row: ConfigRow; s3: S3Client }> {
    const row = await this.getConfigRow();
    if (!row || !row.endpoint || !row.bucket || !row.accessKeyId || !row.secretKeyEnc) {
      throw new BadRequestException('Offsite destination is not fully configured');
    }
    const s3 = new S3Client({
      endpoint: row.endpoint,
      region: row.region,
      forcePathStyle: row.forcePathStyle,
      credentials: {
        accessKeyId: row.accessKeyId,
        secretAccessKey: this.crypto.decrypt(row.secretKeyEnc),
      },
    });
    return { row, s3 };
  }

  private joinKey(prefix: string, name: string): string {
    const p = (prefix || '').replace(/^\/+|\/+$/g, '');
    return p ? `${p}/${name}` : name;
  }

  /** Round-trips a tiny object to verify credentials + bucket access. */
  async testConfig() {
    const { row, s3 } = await this.client();
    const key = this.joinKey(row.prefix, `.offsite-test-${Date.now()}`);
    await s3.send(
      new PutObjectCommand({ Bucket: row.bucket, Key: key, Body: 'ok' }),
    );
    await s3.send(new DeleteObjectCommand({ Bucket: row.bucket, Key: key }));
    return { ok: true };
  }

  async uploadBackup(
    backupId: string,
  ): Promise<{ ok: boolean; key?: string; error?: string }> {
    const backup = await this.backups.get(backupId);
    if (backup.status !== 'SUCCESS') {
      throw new BadRequestException('Only successful backups can be uploaded');
    }
    const { row, s3 } = await this.client();
    const key = this.joinKey(row.prefix, backup.fileName);
    try {
      const { res } = await this.backups.openDownload(backupId);
      if (!res.body) throw new Error('empty backup stream from node');
      const body = Readable.fromWeb(res.body as never);
      const upload = new Upload({
        client: s3,
        params: { Bucket: row.bucket, Key: key, Body: body },
      });
      await upload.done();
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
