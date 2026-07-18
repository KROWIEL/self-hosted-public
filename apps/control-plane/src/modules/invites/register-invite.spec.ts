import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { EntitlementsService } from '../../common/licensing/entitlements.service';
import { InvitesService } from './invites.service';

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    incr: jest.fn(),
    pexpire: jest.fn(),
    del: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
  }));
});

describe('AuthService.register with invites', () => {
  const strongPassword = 'Abcd!efgh123456'; // meets policy
  let users: {
    findByEmail: jest.Mock;
    create: jest.Mock;
  };
  let invites: { consume: jest.Mock };
  let jwt: { signAsync: jest.Mock };
  let service: AuthService;
  const savedOpen = process.env.ALLOW_OPEN_REGISTRATION;

  beforeEach(() => {
    delete process.env.ALLOW_OPEN_REGISTRATION;
    users = {
      findByEmail: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'new@example.com',
        role: 'USER',
        tokenVersion: 0,
      }),
    };
    invites = {
      consume: jest.fn().mockResolvedValue({ role: 'USER' }),
    };
    jwt = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('access')
        .mockResolvedValueOnce('refresh'),
    };
    service = new AuthService(
      users as unknown as UsersService,
      jwt as unknown as JwtService,
      {} as CryptoService,
      { get: jest.fn() } as unknown as EntitlementsService,
      invites as unknown as InvitesService,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    if (savedOpen === undefined) delete process.env.ALLOW_OPEN_REGISTRATION;
    else process.env.ALLOW_OPEN_REGISTRATION = savedOpen;
  });

  it('requires an invite token when open registration is off', async () => {
    await expect(
      service.register({ email: 'new@example.com', password: strongPassword }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(invites.consume).not.toHaveBeenCalled();
  });

  it('consumes the invite and creates the user when closed', async () => {
    await service.register({
      email: 'new@example.com',
      password: strongPassword,
      inviteToken: 'shinv_abc',
    });
    expect(invites.consume).toHaveBeenCalledWith(
      'shinv_abc',
      'new@example.com',
    );
    expect(users.create).toHaveBeenCalledWith(
      'new@example.com',
      strongPassword,
      'USER',
    );
  });

  it('ignores invite tokens when open registration is on', async () => {
    process.env.ALLOW_OPEN_REGISTRATION = '1';
    await service.register({
      email: 'new@example.com',
      password: strongPassword,
      inviteToken: 'shinv_ignored',
    });
    expect(invites.consume).not.toHaveBeenCalled();
    expect(users.create).toHaveBeenCalled();
  });
});
