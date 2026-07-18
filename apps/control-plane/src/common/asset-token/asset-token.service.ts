import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { CryptoService } from '../crypto/crypto.service';

/** Kinds embedded in the sealed payload so tokens can't be cross-used. */
export type AssetTokenKind = 'tunnel-asset' | 'node-asset';

const USED_KEY_PREFIX = 'asset:used:';

/**
 * Short-lived, single-use (per download path) tokens that gate anonymous
 * artifact delivery for tunnel relays and remote node agents (L9).
 *
 * Token = AES-256-GCM sealed `{t, n, exp}` (base64url). On consume the nonce
 * is marked used in Redis for that (kind, path) so the same URL can't be
 * replayed; distinct paths (install.sh vs bin/…) each get one redeem so the
 * copy-paste install flow (script + binary) still works with one minted token.
 */
@Injectable()
export class AssetTokenService implements OnModuleDestroy {
  private readonly logger = new Logger(AssetTokenService.name);
  private readonly redis: Redis;
  private readonly ttlMs: number;

  constructor(private readonly crypto: CryptoService) {
    this.ttlMs = assetTokenTtlMs();
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    this.redis.on('error', (e) =>
      this.logger.warn(`asset-token Redis error: ${e.message}`),
    );
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  /** Mint a fresh token for the given artifact family. */
  mint(kind: AssetTokenKind): string {
    const payload = JSON.stringify({
      t: kind,
      n: randomBytes(16).toString('hex'),
      exp: Date.now() + this.ttlMs,
    });
    return this.crypto
      .encrypt(payload)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Validate + atomically consume a token for one download path.
   * Returns false for missing/expired/wrong-kind/already-used tokens.
   * Fails closed when Redis is unavailable (can't prove single-use).
   */
  async consume(
    token: string | undefined | null,
    kind: AssetTokenKind,
    path: string,
  ): Promise<boolean> {
    if (!token || !path) return false;
    let data: { t?: string; n?: string; exp?: number };
    try {
      let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      data = JSON.parse(this.crypto.decrypt(b64)) as typeof data;
    } catch {
      return false;
    }
    if (
      data?.t !== kind ||
      typeof data.n !== 'string' ||
      !data.n ||
      typeof data.exp !== 'number' ||
      data.exp <= Date.now()
    ) {
      return false;
    }
    const remainingMs = Math.max(data.exp - Date.now(), 1_000);
    const key = `${USED_KEY_PREFIX}${kind}:${data.n}:${sanitizePath(path)}`;
    try {
      const result = await this.redis.set(key, '1', 'PX', remainingMs, 'NX');
      return result !== null;
    } catch (e) {
      this.logger.warn(
        `asset-token consume unavailable (denying): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return false;
    }
  }
}

/** Keep Redis keys safe; paths are short route segments we control. */
export function sanitizePath(path: string): string {
  return path.replace(/[^A-Za-z0-9._/-]/g, '_').slice(0, 128);
}

/**
 * Asset-token lifetime. Override with ASSET_TOKEN_TTL_MS, or the legacy
 * NODE_ASSET_TOKEN_TTL_MS / TUNNEL_ASSET_TOKEN_TTL_MS (default 30 minutes).
 */
export function assetTokenTtlMs(): number {
  const raw =
    process.env.ASSET_TOKEN_TTL_MS ??
    process.env.NODE_ASSET_TOKEN_TTL_MS ??
    process.env.TUNNEL_ASSET_TOKEN_TTL_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30 * 60 * 1000;
}
