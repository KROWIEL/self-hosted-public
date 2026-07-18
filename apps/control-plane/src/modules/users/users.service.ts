import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { DRIZZLE, Database } from '../../db/database.module';
import { users } from '../../db/schema';

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findByEmail(email: string) {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(email: string, password: string, role: 'ADMIN' | 'USER' = 'USER') {
    const hash = await bcrypt.hash(password, 12);
    const rows = await this.db
      .insert(users)
      .values({ email: email.toLowerCase(), password: hash, role })
      .returning();
    return rows[0];
  }

  /**
   * Provision a local account for a user authenticated via an external IdP
   * (SSO). No usable password is set (a random one is stored so the column
   * stays non-null) and the account is marked onboarded — external auth stands
   * in for the local password + 2FA onboarding steps.
   */
  async createSso(
    email: string,
    data: { firstName?: string; lastName?: string } = {},
  ) {
    const randomPassword = randomBytes(24).toString('base64');
    const hash = await bcrypt.hash(randomPassword, 12);
    const rows = await this.db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        password: hash,
        role: 'USER',
        firstName: data.firstName?.trim() || null,
        lastName: data.lastName?.trim() || null,
        onboardedAt: new Date(),
      })
      .returning();
    return rows[0];
  }

  /** Saves stage-2 personal data + 2FA secret and marks onboarding complete. */
  async completeOnboarding(
    userId: string,
    data: { firstName: string; lastName: string; totpSecretEnc: string },
  ) {
    const rows = await this.db
      .update(users)
      .set({
        firstName: data.firstName,
        lastName: data.lastName,
        totpSecret: data.totpSecretEnc,
        onboardedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return rows[0];
  }

  /** Updates personal data for an existing account. */
  async updateProfile(
    userId: string,
    data: { firstName: string; lastName: string },
  ) {
    const rows = await this.db
      .update(users)
      .set({
        firstName: data.firstName,
        lastName: data.lastName,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return rows[0];
  }

  /**
   * Hashes and stores a new password. Bumps tokenVersion so every existing
   * access/refresh token for the account is invalidated on the next request.
   */
  async updatePassword(userId: string, newPassword: string) {
    const hash = await bcrypt.hash(newPassword, 12);
    await this.db
      .update(users)
      .set({
        password: hash,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  /**
   * Increments the account's session epoch (tokenVersion), invalidating all
   * previously issued access/refresh tokens. Used on logout and 2FA disable.
   */
  async bumpTokenVersion(userId: string) {
    await this.db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  /** Flags/unflags the account as needing a password change at next use. */
  async setMustChangePassword(userId: string, value: boolean) {
    await this.db
      .update(users)
      .set({ mustChangePassword: value, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  /** Enables (encrypted secret) or disables (null) TOTP two-factor auth. */
  async setTotpSecret(userId: string, totpSecretEnc: string | null) {
    await this.db
      .update(users)
      .set({ totpSecret: totpSecretEnc, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  verifyPassword(plain: string, hash: string) {
    return bcrypt.compare(plain, hash);
  }
}
