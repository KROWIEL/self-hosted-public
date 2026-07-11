import { Inject, Injectable } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import type { Entitlements, LicenseModule } from '@selfhosted/shared';
import { DRIZZLE, Database } from '../../db/database.module';
import { licenses } from '../../db/schema';
import { LicenseErrors } from '../errors/app-errors';
import {
  entitlementsFromKey,
  isLicenseUsable,
  verifyLicenseKey,
} from './license';

/**
 * Resolves and caches the installation's effective entitlements. The active
 * license key is read from the `licenses` table (a singleton row) and falls
 * back to the `LICENSE_KEY` env var for immutable / air-gapped deployments.
 */
@Injectable()
export class EntitlementsService {
  private cache: Entitlements | null = null;
  private cachedAt = 0;
  private readonly ttlMs = 15_000;

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private async currentKey(): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(licenses)
      .orderBy(desc(licenses.createdAt))
      .limit(1);
    if (rows[0]?.key) return rows[0].key;
    const env = process.env.LICENSE_KEY?.trim();
    return env ? env : null;
  }

  /** Effective entitlements (cached for a short TTL). */
  async get(force = false): Promise<Entitlements> {
    const now = Date.now();
    if (!force && this.cache && now - this.cachedAt < this.ttlMs) {
      return this.cache;
    }
    const key = await this.currentKey();
    const ent = entitlementsFromKey(key);
    this.cache = ent;
    this.cachedAt = now;
    return ent;
  }

  async hasModule(module: LicenseModule): Promise<boolean> {
    const ent = await this.get();
    return ent.modules.includes(module);
  }

  /** Validate and persist a new license key, replacing any existing one. */
  async setKey(key: string): Promise<Entitlements> {
    const trimmed = (key ?? '').trim();
    if (!verifyLicenseKey(trimmed)) throw LicenseErrors.invalidKey();
    if (!isLicenseUsable(trimmed)) throw LicenseErrors.expiredKey();

    await this.db.delete(licenses);
    await this.db.insert(licenses).values({ key: trimmed });
    this.cache = null;
    return this.get(true);
  }

  /** Remove any stored license key (env fallback, if set, still applies). */
  async clear(): Promise<Entitlements> {
    await this.db.delete(licenses);
    this.cache = null;
    return this.get(true);
  }
}
