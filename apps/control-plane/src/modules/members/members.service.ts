import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { MemberRole } from '@selfhosted/shared';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { MemberErrors } from '../../common/errors/app-errors';
import { projectMembers, projects, users } from '../../db/schema';

/** Higher number = more privilege. Used for min-role comparisons. */
const RANK: Record<MemberRole, number> = {
  [MemberRole.VIEWER]: 1,
  [MemberRole.MEMBER]: 2,
  [MemberRole.ADMIN]: 3,
  [MemberRole.OWNER]: 4,
};

export interface Actor {
  id: string;
  role: string; // global role: 'ADMIN' | 'USER'
}

@Injectable()
export class MembersService implements OnModuleInit {
  private readonly logger = new Logger(MembersService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Backfill: ensure every project's owner has an OWNER membership row. */
  async onModuleInit() {
    try {
      const rows = await this.db
        .select({ id: projects.id, ownerId: projects.ownerId })
        .from(projects);
      for (const p of rows) {
        await this.db
          .insert(projectMembers)
          .values({ projectId: p.id, userId: p.ownerId, role: 'OWNER' })
          .onConflictDoNothing();
      }
    } catch (e) {
      // Table may not exist yet before the first db:push — don't crash boot.
      this.logger.warn(
        `owner membership backfill skipped: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /**
   * Effective role of a user on a project. Global admins act as implicit OWNER
   * on every project so the single-admin setup keeps working unchanged.
   */
  async roleFor(actor: Actor, projectId: string): Promise<MemberRole | null> {
    if (actor.role === 'ADMIN') return MemberRole.OWNER;
    const row = (
      await this.db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, actor.id),
          ),
        )
        .limit(1)
    )[0];
    return (row?.role as MemberRole) ?? null;
  }

  /** Throws ForbiddenException unless the actor meets the minimum role. */
  async assertRole(
    actor: Actor,
    projectId: string,
    min: MemberRole,
  ): Promise<MemberRole> {
    const role = await this.roleFor(actor, projectId);
    if (!role || RANK[role] < RANK[min]) {
      // Coded + meta so the UI can localize with the actual role names.
      throw new ForbiddenException({
        code: 'members.forbidden',
        message: `Requires ${min} role on this project (you have ${role ?? 'none'}).`,
        meta: { min, role: role ?? 'NONE' },
      });
    }
    return role;
  }

  /** Project ids the actor can see (all for global admins). */
  async accessibleProjectIds(actor: Actor): Promise<string[] | 'ALL'> {
    if (actor.role === 'ADMIN') return 'ALL';
    const rows = await this.db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, actor.id));
    return rows.map((r) => r.projectId);
  }

  /** Ensures a user has an OWNER row on a project (called on project create). */
  async ensureOwner(projectId: string, userId: string) {
    await this.db
      .insert(projectMembers)
      .values({ projectId, userId, role: 'OWNER' })
      .onConflictDoNothing();
  }

  async list(projectId: string) {
    return this.db
      .select({
        userId: projectMembers.userId,
        role: projectMembers.role,
        email: users.email,
        createdAt: projectMembers.createdAt,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId));
  }

  async addByEmail(projectId: string, email: string, role: MemberRole) {
    if (role === MemberRole.OWNER) {
      throw MemberErrors.ownerReserved();
    }
    const user = (
      await this.db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1)
    )[0];
    if (!user) {
      throw MemberErrors.userNotFound();
    }
    const rows = await this.db
      .insert(projectMembers)
      .values({ projectId, userId: user.id, role })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: { role },
      })
      .returning();
    return { ...rows[0], email: user.email };
  }

  async updateRole(projectId: string, userId: string, role: MemberRole) {
    if (role === MemberRole.OWNER) {
      throw MemberErrors.ownerReserved();
    }
    const target = await this.requireMember(projectId, userId);
    if (target.role === 'OWNER') {
      throw MemberErrors.ownerImmutable();
    }
    const rows = await this.db
      .update(projectMembers)
      .set({ role })
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
        ),
      )
      .returning();
    return rows[0];
  }

  async remove(projectId: string, userId: string) {
    const target = await this.requireMember(projectId, userId);
    if (target.role === 'OWNER') {
      throw MemberErrors.ownerRemoval();
    }
    await this.db
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
        ),
      );
    return { ok: true };
  }

  private async requireMember(projectId: string, userId: string) {
    const row = (
      await this.db
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, userId),
          ),
        )
        .limit(1)
    )[0];
    if (!row) throw new NotFoundException('Member not found');
    return row;
  }
}
