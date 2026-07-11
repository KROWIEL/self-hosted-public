import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
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

  /** Hashes and stores a new password. */
  async updatePassword(userId: string, newPassword: string) {
    const hash = await bcrypt.hash(newPassword, 12);
    await this.db
      .update(users)
      .set({ password: hash, updatedAt: new Date() })
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
