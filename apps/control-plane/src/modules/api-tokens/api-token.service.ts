import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { apiTokens, users } from '../../db/schema';
import { EntitlementsService } from '../../common/licensing/entitlements.service';
import {
  API_TOKEN_PREFIX,
  LAST_USED_THROTTLE_MS,
} from './api-tokens.constants';

export interface AuthedUser {
  id: string;
  email: string;
  role: string;
}

@Injectable()
export class ApiTokenService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly entitlements: EntitlementsService,
  ) {}

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Creates a token, returning the raw value ONCE (never stored in clear). */
  async create(userId: string, name: string, expiresInDays?: number) {
    const secret = randomBytes(24).toString('hex');
    const raw = `${API_TOKEN_PREFIX}${secret}`;
    const preview = `${API_TOKEN_PREFIX}${secret.slice(0, 6)}…`;
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    const [row] = await this.db
      .insert(apiTokens)
      .values({ userId, name, tokenHash: this.hash(raw), preview, expiresAt })
      .returning();
    return { token: raw, item: this.view(row) };
  }

  async list(userId: string) {
    const rows = await this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId))
      .orderBy(desc(apiTokens.createdAt));
    return rows.map((r) => this.view(r));
  }

  async revoke(userId: string, id: string) {
    const [row] = await this.db
      .delete(apiTokens)
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
      .returning();
    if (!row) throw new NotFoundException('token not found');
    return { ok: true };
  }

  private view(row: typeof apiTokens.$inferSelect) {
    return {
      id: row.id,
      name: row.name,
      preview: row.preview,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }

  /**
   * Resolves the user behind a raw PAT, or null if it's invalid, expired, or the
   * `api-cli` module isn't licensed (so tokens die with a downgrade).
   */
  async validateRaw(raw: string): Promise<AuthedUser | null> {
    if (!raw.startsWith(API_TOKEN_PREFIX)) return null;
    const [row] = await this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, this.hash(raw)))
      .limit(1);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
    if (!(await this.entitlements.hasModule('api-cli'))) return null;

    const [user] = await this.db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);
    if (!user) return null;

    const now = Date.now();
    if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      await this.db
        .update(apiTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiTokens.id, row.id));
    }
    return { id: user.id, email: user.email, role: user.role };
  }
}
