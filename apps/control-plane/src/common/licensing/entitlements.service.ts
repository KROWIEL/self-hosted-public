import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import {
  TIER_LIMITS,
  type ActivationStatus,
  type Entitlements,
  type LicenseModule,
} from '@selfhosted/shared';
import { DRIZZLE, Database } from '../../db/database.module';
import { installation, licenses } from '../../db/schema';
import { LicenseErrors } from '../errors/app-errors';
import {
  entitlementsFromKey,
  isLicenseUsable,
  isUsingDevLicenseKey,
  verifyLicenseKey,
} from './license';

/** Heartbeat outcomes that mean "definitely not licensed" (lock immediately). */
const DEFINITIVE_DENY = new Set([
  'revoked',
  'rejected',
  'expired',
  'seat_limit',
  'http_401',
  'http_403',
]);

/**
 * Resolves the installation's effective entitlements from the active license
 * key, and — when an activation server is configured — enforces online
 * activation: paid modules stay unlocked only while a recent heartbeat has
 * succeeded. With no `LICENSE_ACTIVATION_URL` the instance runs offline /
 * key-only (signature + expiry are still verified locally).
 */
@Injectable()
export class EntitlementsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EntitlementsService.name);

  private cache: Entitlements | null = null;
  private cachedAt = 0;
  private readonly ttlMs = 15_000;

  // Online-activation state.
  private readonly activationUrl = process.env.LICENSE_ACTIVATION_URL?.trim() || '';
  private readonly intervalMs = numFromEnv('LICENSE_HEARTBEAT_INTERVAL_MS', 6 * 60 * 60 * 1000);
  private readonly maxAgeMs = numFromEnv('LICENSE_ACTIVATION_MAX_AGE_MS', 72 * 60 * 60 * 1000);
  private lastOkAt = 0;
  private lastAttempt: { ok: boolean; at: number; reason?: string } | null = null;
  private timer: NodeJS.Timeout | null = null;
  // Start of the current grace window (service start or last key change). Used so
  // a freshly-activated license isn't locked out before its first heartbeat lands.
  private activationBaselineAt = Date.now();

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  onModuleInit(): void {
    if (isUsingDevLicenseKey()) {
      this.logger.warn(
        'Licensing is using the throwaway DEV public key — the matching private ' +
          'key is public, so anyone could mint valid license keys. Rotate to your ' +
          'production keypair (or set LICENSE_PUBLIC_KEY) before selling licenses ' +
          '(see docs/LICENSING.md).',
      );
    }
    if (!this.activationUrl) {
      this.logger.log('License activation: offline / key-only mode (no LICENSE_ACTIVATION_URL).');
      return;
    }
    this.logger.log(
      `License activation: online mode via ${this.activationUrl} (grace ${Math.round(this.maxAgeMs / 3_600_000)}h).`,
    );
    void this.heartbeat();
    this.timer = setInterval(() => void this.heartbeat(), this.intervalMs);
    // Don't keep the event loop alive just for the heartbeat.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

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

  /** Stable per-installation id used as the activation "seat" identifier. */
  private async instanceId(): Promise<string> {
    const existing = await this.db
      .select()
      .from(installation)
      .where(eq(installation.id, 'default'))
      .limit(1);
    if (existing[0]) return existing[0].instanceId;
    const inserted = await this.db
      .insert(installation)
      .values({ id: 'default' })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return inserted[0].instanceId;
    const again = await this.db
      .select()
      .from(installation)
      .where(eq(installation.id, 'default'))
      .limit(1);
    return again[0]?.instanceId ?? 'unknown';
  }

  /** One activation heartbeat against the license server. Never throws. */
  private async heartbeat(): Promise<void> {
    if (!this.activationUrl) return;
    try {
      const key = await this.currentKey();
      if (!key) {
        // Free instance: nothing to activate.
        this.lastAttempt = { ok: true, at: Date.now() };
        this.cache = null;
        return;
      }
      const instanceId = await this.instanceId();
      const res = await fetch(this.activationUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key,
          instanceId,
          product: 'self-hosted',
          version: process.env.APP_VERSION ?? '0',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.lastAttempt = { ok: false, at: Date.now(), reason: `http_${res.status}` };
        return;
      }
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; reason?: string }
        | null;
      if (data?.ok) {
        this.lastOkAt = Date.now();
        this.lastAttempt = { ok: true, at: this.lastOkAt };
      } else {
        this.lastAttempt = { ok: false, at: Date.now(), reason: data?.reason ?? 'rejected' };
        this.logger.warn(`License activation rejected: ${this.lastAttempt.reason}`);
      }
    } catch {
      // Transient (network/timeout): keep the last successful timestamp so the
      // grace window is measured from the last success, not from this failure.
      this.lastAttempt = { ok: false, at: Date.now(), reason: 'unreachable' };
    } finally {
      this.cache = null;
    }
  }

  private activationOk(): boolean {
    const reason = this.lastAttempt?.reason;
    // Hard denials (revoked / rejected / expired / seat limit / auth) lock
    // immediately, regardless of any grace window.
    if (this.lastAttempt && !this.lastAttempt.ok && reason && DEFINITIVE_DENY.has(reason)) {
      return false;
    }
    const now = Date.now();
    // Normal case: a recent successful heartbeat keeps modules unlocked.
    if (this.lastOkAt > 0) return now - this.lastOkAt < this.maxAgeMs;
    // Never succeeded yet (fresh key / first contact / server briefly down):
    // stay unlocked during the initial grace window measured from the baseline,
    // so a just-activated license isn't blocked before its first heartbeat lands.
    return now - this.activationBaselineAt < this.maxAgeMs;
  }

  private activationStatus(ok: boolean): ActivationStatus {
    return {
      required: !!this.activationUrl,
      ok,
      lastCheckAt: this.lastOkAt ? Math.floor(this.lastOkAt / 1000) : null,
      reason: ok ? undefined : this.lastAttempt?.reason ?? 'pending',
    };
  }

  /** Effective entitlements (cached for a short TTL). */
  async get(force = false): Promise<Entitlements> {
    const now = Date.now();
    if (!force && this.cache && now - this.cachedAt < this.ttlMs) {
      return this.cache;
    }
    const key = await this.currentKey();
    const base = entitlementsFromKey(key);

    let ent: Entitlements;
    if (!this.activationUrl) {
      // Offline / key-only mode: no online enforcement.
      ent = { ...base, activation: { required: false, ok: true, lastCheckAt: null } };
    } else {
      const ok = this.activationOk();
      const status = this.activationStatus(ok);
      if (base.tier === 'free' || !base.licensed || ok) {
        ent = { ...base, activation: status };
      } else {
        // Licensed but not currently activated → lock paid modules and drop
        // quantitative caps back to the Free tier.
        ent = {
          tier: base.tier,
          modules: [],
          limits: TIER_LIMITS.free,
          expiresAt: base.expiresAt,
          licensed: false,
          subject: base.subject,
          name: base.name,
          activation: status,
        };
      }
    }

    this.cache = ent;
    this.cachedAt = now;
    return ent;
  }

  async hasModule(module: LicenseModule): Promise<boolean> {
    const ent = await this.get();
    return ent.modules.includes(module);
  }

  /** Current tier's quantitative caps (nodes, tunnels, …). */
  async limits(): Promise<Entitlements['limits']> {
    const ent = await this.get();
    return ent.limits;
  }

  /** Validate and persist a new license key, replacing any existing one. */
  async setKey(key: string): Promise<Entitlements> {
    const trimmed = (key ?? '').trim();
    if (!verifyLicenseKey(trimmed)) throw LicenseErrors.invalidKey();
    if (!isLicenseUsable(trimmed)) throw LicenseErrors.expiredKey();

    await this.db.delete(licenses);
    await this.db.insert(licenses).values({ key: trimmed });
    this.cache = null;
    this.lastOkAt = 0;
    this.lastAttempt = null;
    // New key → fresh grace window so activation can't lock a just-entered key.
    this.activationBaselineAt = Date.now();
    // Re-activate immediately so the UI reflects the new key without waiting.
    if (this.activationUrl) await this.heartbeat();
    return this.get(true);
  }

  /** Remove any stored license key (env fallback, if set, still applies). */
  async clear(): Promise<Entitlements> {
    await this.db.delete(licenses);
    this.cache = null;
    this.lastOkAt = 0;
    this.lastAttempt = null;
    this.activationBaselineAt = Date.now();
    return this.get(true);
  }
}

function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
