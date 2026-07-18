import { Injectable, Logger, OnModuleDestroy, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { CryptoService } from '../../common/crypto/crypto.service';
import { EntitlementsService } from '../../common/licensing/entitlements.service';
import { AuthErrors } from '../../common/errors/app-errors';
import { isStrongPassword } from '../../common/validation/password';
import { UsersService } from '../users/users.service';
import { InvitesService } from '../invites/invites.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { OnboardingDto } from './dto/onboarding.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Enable2faDto } from './dto/enable-2fa.dto';
import { Disable2faDto } from './dto/disable-2fa.dto';

const TOTP_ISSUER = process.env.TOTP_ISSUER ?? 'Self-Hosted Panel';
const REFRESH_JTI_PREFIX = 'auth:refresh:jti:';

/**
 * Self-service registration toggle (H1). Disabled by default so a fresh panel is
 * not open to anonymous account creation; an operator sets ALLOW_OPEN_REGISTRATION
 * to a truthy value to allow public sign-up. When off, register still works with
 * a valid admin-issued invite token.
 */
function isOpenRegistrationEnabled(): boolean {
  const v = process.env.ALLOW_OPEN_REGISTRATION?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

// Per-account brute-force backoff: after this many consecutive failed login /
// TOTP attempts, the account is locked for LOGIN_LOCKOUT_MS.
const MAX_FAILED_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const LOCKOUT_KEY_PREFIX = 'auth:lockout:';

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Durable, cluster-wide per-account failed-attempt tracker backed by Redis
   * (reuses the shared ioredis connection). Unlike the previous in-memory map it
   * survives restarts and is shared across replicas. It complements the IP-based
   * throttler; if Redis is briefly unavailable we fail open on the *check* (so a
   * Redis blip can't lock everyone out) and rely on the IP throttler meanwhile.
   */
  private readonly lockRedis: Redis;

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly entitlements: EntitlementsService,
    private readonly invites: InvitesService,
  ) {
    this.lockRedis = new Redis(
      process.env.REDIS_URL ?? 'redis://localhost:6379',
      { maxRetriesPerRequest: null },
    );
    // ioredis emits 'error' asynchronously; swallow to a warning so a transient
    // Redis outage doesn't crash the process (auth degrades to IP throttling).
    this.lockRedis.on('error', (e) =>
      this.logger.warn(`lockout Redis error: ${e.message}`),
    );
  }

  onModuleDestroy(): void {
    this.lockRedis.disconnect();
  }

  private countKey(key: string): string {
    return `${LOCKOUT_KEY_PREFIX}count:${key}`;
  }

  private lockKey(key: string): string {
    return `${LOCKOUT_KEY_PREFIX}until:${key}`;
  }

  private async assertNotLocked(key: string): Promise<void> {
    let locked: string | null = null;
    try {
      locked = await this.lockRedis.get(this.lockKey(key));
    } catch (e) {
      // Fail open on transport errors so a Redis blip can't lock everyone out;
      // the IP throttler still applies.
      this.logger.warn(
        `lockout check unavailable (allowing attempt): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return;
    }
    if (locked) throw AuthErrors.tooManyAttempts();
  }

  private async recordFailure(key: string): Promise<void> {
    try {
      const count = await this.lockRedis.incr(this.countKey(key));
      if (count === 1) {
        // Start the counting window on the first failure.
        await this.lockRedis.pexpire(this.countKey(key), LOGIN_LOCKOUT_MS);
      }
      if (count >= MAX_FAILED_ATTEMPTS) {
        // Trip the lock and reset the counter so a fresh window starts after it.
        await this.lockRedis.set(
          this.lockKey(key),
          '1',
          'PX',
          LOGIN_LOCKOUT_MS,
        );
        await this.lockRedis.del(this.countKey(key));
      }
    } catch (e) {
      this.logger.warn(
        `could not record login failure: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  private async clearFailures(key: string): Promise<void> {
    try {
      await this.lockRedis.del(this.countKey(key), this.lockKey(key));
    } catch (e) {
      this.logger.warn(
        `could not clear login failures: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /** Stage 1: create the account and sign the user in so they can onboard. */
  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const open = isOpenRegistrationEnabled();

    if (!isStrongPassword(dto.password)) {
      throw AuthErrors.weakPassword();
    }
    if (await this.users.findByEmail(email)) {
      throw AuthErrors.emailTaken();
    }

    // When open registration is OFF, a valid unused invite is required (H1).
    // When ON, any inviteToken is ignored so public sign-up stays simple.
    let role: 'ADMIN' | 'USER' = 'USER';
    if (!open) {
      if (!dto.inviteToken?.trim()) throw AuthErrors.inviteRequired();
      const invite = await this.invites.consume(dto.inviteToken, email);
      role = invite.role === 'ADMIN' ? 'ADMIN' : 'USER';
    }

    const user = await this.users.create(email, dto.password, role);
    const tokens = await this.issueTokens(
      user.id,
      user.email,
      user.role,
      user.tokenVersion,
    );
    return { ...tokens, needsOnboarding: true };
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    // Reject early if this account is in a brute-force lockout window.
    await this.assertNotLocked(email);

    const user = await this.users.findByEmail(email);
    if (!user) {
      await this.recordFailure(email);
      throw AuthErrors.invalidCredentials();
    }
    const ok = await this.users.verifyPassword(dto.password, user.password);
    if (!ok) {
      await this.recordFailure(email);
      throw AuthErrors.invalidCredentials();
    }

    // Enforce TOTP once 2FA has been enabled for the account.
    if (user.totpSecret) {
      if (!dto.totp) throw AuthErrors.totpRequired();
      const secret = this.crypto.decrypt(user.totpSecret);
      if (!authenticator.check(dto.totp, secret)) {
        await this.recordFailure(email);
        throw AuthErrors.totpInvalid();
      }
    }

    // Successful authentication — clear any accumulated failure state.
    await this.clearFailures(email);

    // Soft-enforce the current password policy: flag weak passwords so the UI
    // can force a change on next use, without ever blocking sign-in.
    const mustChangePassword = !isStrongPassword(dto.password);
    if (mustChangePassword !== user.mustChangePassword) {
      await this.users.setMustChangePassword(user.id, mustChangePassword);
    }

    const tokens = await this.issueTokens(
      user.id,
      user.email,
      user.role,
      user.tokenVersion,
    );
    return {
      ...tokens,
      needsOnboarding: !user.onboardedAt,
      mustChangePassword,
    };
  }

  /**
   * Stage 2 helper: mints a fresh TOTP secret + QR for the user to scan. The
   * secret isn't persisted until they confirm a code in `completeOnboarding`.
   */
  async begin2fa(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, TOTP_ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    return { secret, otpauthUrl, qrDataUrl };
  }

  /** Stage 2: verify the TOTP code, then persist personal data + enable 2FA. */
  async completeOnboarding(userId: string, dto: OnboardingDto) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    if (user.onboardedAt) throw AuthErrors.alreadyOnboarded();

    if (!authenticator.check(dto.totpCode, dto.totpSecret)) {
      throw AuthErrors.totpInvalid();
    }

    await this.users.completeOnboarding(userId, {
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      totpSecretEnc: this.crypto.encrypt(dto.totpSecret),
    });
    return { ok: true };
  }

  /** Settings: update personal data on an already-onboarded account. */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    await this.users.updateProfile(userId, {
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
    });
    return { ok: true };
  }

  /** Settings: change password after verifying the current one. */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    const ok = await this.users.verifyPassword(
      dto.currentPassword,
      user.password,
    );
    if (!ok) throw AuthErrors.currentPasswordInvalid();
    if (!isStrongPassword(dto.newPassword)) {
      throw AuthErrors.weakPassword();
    }
    await this.users.updatePassword(userId, dto.newPassword);
    await this.users.setMustChangePassword(userId, false);
    return { ok: true };
  }

  /** Settings: enable 2FA by confirming a code for the freshly issued secret. */
  async enable2fa(userId: string, dto: Enable2faDto) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    if (user.totpSecret) throw AuthErrors.twoFactorAlreadyEnabled();
    if (!authenticator.check(dto.totpCode, dto.totpSecret)) {
      throw AuthErrors.totpInvalid();
    }
    await this.users.setTotpSecret(userId, this.crypto.encrypt(dto.totpSecret));
    return { ok: true };
  }

  /** Settings: disable 2FA after re-verifying the account password. */
  async disable2fa(userId: string, dto: Disable2faDto) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    if (!user.totpSecret) throw AuthErrors.twoFactorNotEnabled();
    const ok = await this.users.verifyPassword(dto.password, user.password);
    if (!ok) throw AuthErrors.currentPasswordInvalid();
    await this.users.setTotpSecret(userId, null);
    // Disabling a second factor is a downgrade of account security — invalidate
    // every existing session so a stolen token can't ride along.
    await this.users.bumpTokenVersion(userId);
    return { ok: true };
  }

  /**
   * Explicit server-side logout: bumps tokenVersion so the caller's access and
   * refresh tokens (and any other live sessions for the account) stop working.
   */
  async logout(userId: string) {
    await this.users.bumpTokenVersion(userId);
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      twoFactor: !!user.totpSecret,
      onboardedAt: user.onboardedAt,
      needsOnboarding: !user.onboardedAt,
      mustChangePassword: user.mustChangePassword,
      entitlements: await this.entitlements.get(),
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        tv?: number;
        jti?: string;
        exp?: number;
      }>(refreshToken, { secret: process.env.JWT_REFRESH_SECRET });
      const user = await this.users.findById(payload.sub);
      if (!user) throw AuthErrors.invalidRefresh();
      // Reject a refresh token minted before the account's session epoch was
      // bumped (password change, 2FA disable, logout).
      if (payload.tv !== user.tokenVersion) throw AuthErrors.invalidRefresh();
      // Rotation with reuse detection (M1): every refresh JWT carries a unique
      // jti. The first redeem marks it used in Redis; a second redeem of the
      // same jti is treated as theft and kills every session for the account.
      if (!payload.jti) throw AuthErrors.invalidRefresh();
      const remainingMs = refreshJtiTtlMs(payload.exp);
      const outcome = await this.consumeRefreshJti(payload.jti, remainingMs);
      if (outcome === 'reuse') {
        await this.users.bumpTokenVersion(user.id);
        throw AuthErrors.invalidRefresh();
      }
      // Rotate: issue a brand-new access AND refresh token on every refresh.
      return this.issueTokens(
        user.id,
        user.email,
        user.role,
        user.tokenVersion,
      );
    } catch (e) {
      // Re-throw coded AuthErrors (invalidRefresh, etc.) so a reuse bump isn't
      // swallowed into a generic "invalid refresh" without the side effects
      // having already run. Unknown verify failures still map to invalidRefresh.
      if (e instanceof HttpException) throw e;
      throw AuthErrors.invalidRefresh();
    }
  }

  /**
   * Atomically mark a refresh jti as consumed. Returns:
   *  - 'ok'     — first use; jti stored with TTL ≈ remaining refresh lifetime
   *  - 'reuse'  — jti was already consumed (replay / theft)
   *  - 'skip'   — Redis unavailable; fail open so a blip can't lock everyone out
   */
  private async consumeRefreshJti(
    jti: string,
    ttlMs: number,
  ): Promise<'ok' | 'reuse' | 'skip'> {
    try {
      const result = await this.lockRedis.set(
        `${REFRESH_JTI_PREFIX}${jti}`,
        '1',
        'PX',
        Math.max(ttlMs, 1_000),
        'NX',
      );
      return result === null ? 'reuse' : 'ok';
    } catch (e) {
      this.logger.warn(
        `refresh jti check unavailable (allowing rotate): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return 'skip';
    }
  }

  /**
   * Mint a panel session for an already-authenticated principal (e.g. after a
   * successful SSO / OIDC sign-in). The caller is responsible for verifying the
   * external identity before calling this.
   */
  issueSessionFor(user: {
    id: string;
    email: string;
    role: string;
    tokenVersion: number;
  }) {
    return this.issueTokens(user.id, user.email, user.role, user.tokenVersion);
  }

  private async issueTokens(
    sub: string,
    email: string,
    role: string,
    tokenVersion: number,
  ) {
    // `tv` binds the token to the account's current session epoch; jwt.strategy
    // and the refresh/exec paths reject tokens whose tv is stale.
    const payload = { sub, email, role, tv: tokenVersion };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    });
    // Refresh tokens carry a unique jti so rotation can detect reuse (M1).
    // Put jti only in the payload — passing `jwtid` as a sign option as well
    // makes jsonwebtoken throw ("payload already has an jti property").
    const jti = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { ...payload, jti },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
      },
    );
    return { accessToken, refreshToken };
  }
}

/** TTL for the used-jti Redis key: remaining JWT lifetime, floored to ≥1s. */
export function refreshJtiTtlMs(exp?: number): number {
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    // Fallback ≈ default refresh lifetime when exp is missing.
    return 7 * 24 * 60 * 60 * 1000;
  }
  return Math.max(Math.floor(exp * 1000 - Date.now()), 1_000);
}
