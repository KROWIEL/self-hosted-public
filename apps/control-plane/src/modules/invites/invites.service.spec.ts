import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { AuthErrors } from '../../common/errors/app-errors';

describe('InvitesService', () => {
  const adminId = 'admin-1';
  let rows: Array<Record<string, unknown>>;
  let db: {
    insert: jest.Mock;
    select: jest.Mock;
    delete: jest.Mock;
    update: jest.Mock;
  };
  let svc: InvitesService;

  beforeEach(() => {
    rows = [];
    db = {
      insert: jest.fn(),
      select: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    };

    // Chainable drizzle-style mocks.
    db.insert.mockImplementation(() => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const row = {
            id: 'inv-1',
            email: v.email ?? null,
            tokenHash: v.tokenHash,
            createdBy: v.createdBy,
            role: v.role ?? 'USER',
            expiresAt: v.expiresAt,
            usedAt: null,
            createdAt: new Date(),
          };
          rows.push(row);
          return [row];
        },
      }),
    }));
    db.select.mockImplementation(() => ({
      from: () => ({
        orderBy: async () => rows,
      }),
    }));
    db.delete.mockImplementation(() => ({
      where: () => ({
        returning: async () => {
          const [gone] = rows.splice(0, 1);
          return gone ? [gone] : [];
        },
      }),
    }));
    db.update.mockImplementation(() => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const row = rows.find((r) => !r.usedAt) as
              | Record<string, unknown>
              | undefined;
            if (!row) return [];
            // Simulate WHERE: unused + not expired (caller passes those).
            if (
              row.expiresAt instanceof Date &&
              row.expiresAt.getTime() <= Date.now()
            ) {
              return [];
            }
            Object.assign(row, patch);
            return [row];
          },
        }),
      }),
    }));

    svc = new InvitesService(db as never);
  });

  it('creates an invite and returns the raw token once', async () => {
    const result = await svc.create(adminId, {}, 'https://panel.example');
    expect(result.token).toMatch(/^shinv_/);
    expect(result.url).toContain('invite=');
    expect(result.invite.status).toBe('pending');
    expect(rows[0].tokenHash).toBe(
      createHash('sha256').update(result.token).digest('hex'),
    );
  });

  it('consumes a valid invite exactly once', async () => {
    const { token } = await svc.create(adminId, {});
    const first = await svc.consume(token, 'user@example.com');
    expect(first.usedAt).toBeTruthy();
    await expect(svc.consume(token, 'user@example.com')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects expired invites', async () => {
    const { token } = await svc.create(adminId, {});
    rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.consume(token, 'user@example.com')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'auth.inviteInvalid' }),
    });
  });

  it('rejects email-bound invites for the wrong address', async () => {
    const { token } = await svc.create(adminId, { email: 'bound@example.com' });
    // Ensure the consume path sees the bound email on the row.
    rows[0].email = 'bound@example.com';
    await expect(svc.consume(token, 'other@example.com')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'auth.inviteEmailMismatch' }),
    });
  });

  it('AuthErrors helpers produce coded invite failures', () => {
    expect(() => {
      throw AuthErrors.inviteRequired();
    }).toThrow(ForbiddenException);
    expect(() => {
      throw AuthErrors.inviteInvalid();
    }).toThrow(BadRequestException);
  });
});
