import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { invites } from '../../db/schema';
import { AuthErrors } from '../../common/errors/app-errors';
import { CreateInviteDto } from './dto/invite.dto';

const INVITE_PREFIX = 'shinv_';
const DEFAULT_EXPIRES_DAYS = 7;

@Injectable()
export class InvitesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Create an invite. Returns the raw token ONCE (never stored in clear) plus
   * a ready-to-share register URL when `origin` is provided.
   */
  async create(adminId: string, dto: CreateInviteDto, origin?: string) {
    const secret = randomBytes(24).toString('hex');
    const raw = `${INVITE_PREFIX}${secret}`;
    const days = dto.expiresInDays ?? DEFAULT_EXPIRES_DAYS;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const email = dto.email?.trim().toLowerCase() || null;
    const role = dto.role ?? 'USER';

    const [row] = await this.db
      .insert(invites)
      .values({
        email,
        tokenHash: this.hash(raw),
        createdBy: adminId,
        role,
        expiresAt,
      })
      .returning();

    const base = (origin ?? '').replace(/\/$/, '');
    const url = base
      ? `${base}/register?invite=${encodeURIComponent(raw)}`
      : undefined;

    return {
      token: raw,
      url,
      invite: this.view(row),
    };
  }

  async list() {
    const rows = await this.db
      .select()
      .from(invites)
      .orderBy(desc(invites.createdAt));
    return rows.map((r) => this.view(r));
  }

  async revoke(id: string) {
    const [row] = await this.db
      .delete(invites)
      .where(eq(invites.id, id))
      .returning();
    if (!row) throw new NotFoundException('Invite not found');
    return { ok: true };
  }

  /**
   * Atomically consume a valid unused non-expired invite. Returns the invite
   * row (including the role to assign) or throws a coded AuthError.
   *
   * Email-bound invites: if the register email does not match, the consume is
   * rolled back so the intended recipient can still use the invite.
   */
  async consume(rawToken: string, registerEmail: string) {
    const tokenHash = this.hash(rawToken.trim());
    const now = new Date();
    const [row] = await this.db
      .update(invites)
      .set({ usedAt: now })
      .where(
        and(
          eq(invites.tokenHash, tokenHash),
          isNull(invites.usedAt),
          gt(invites.expiresAt, now),
        ),
      )
      .returning();

    if (!row) throw AuthErrors.inviteInvalid();

    if (row.email && row.email !== registerEmail.toLowerCase()) {
      await this.db
        .update(invites)
        .set({ usedAt: null })
        .where(eq(invites.id, row.id));
      throw AuthErrors.inviteEmailMismatch();
    }
    return row;
  }

  private view(row: typeof invites.$inferSelect) {
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      createdBy: row.createdBy,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      createdAt: row.createdAt,
      status: row.usedAt
        ? 'used'
        : row.expiresAt.getTime() <= Date.now()
          ? 'expired'
          : 'pending',
    };
  }
}
