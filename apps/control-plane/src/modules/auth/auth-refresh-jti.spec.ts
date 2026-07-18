import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService, refreshJtiTtlMs } from './auth.service';
import { UsersService } from '../users/users.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { EntitlementsService } from '../../common/licensing/entitlements.service';

const redisStore = new Map<string, string>();
const setCalls: Array<{ key: string; nx: boolean }> = [];

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set: jest.fn(
      async (
        key: string,
        _val: string,
        ...rest: Array<string | number>
      ): Promise<'OK' | null> => {
        const nx = rest.includes('NX');
        setCalls.push({ key, nx });
        if (nx && redisStore.has(key)) return null;
        redisStore.set(key, '1');
        return 'OK';
      },
    ),
    get: jest.fn().mockResolvedValue(null),
    incr: jest.fn(),
    pexpire: jest.fn(),
    del: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
  }));
});

describe('refreshJtiTtlMs', () => {
  it('returns remaining lifetime from exp (seconds → ms)', () => {
    const exp = Math.floor(Date.now() / 1000) + 120;
    const ttl = refreshJtiTtlMs(exp);
    expect(ttl).toBeGreaterThan(100_000);
    expect(ttl).toBeLessThanOrEqual(120_000);
  });

  it('floors to at least 1s when already expired', () => {
    expect(refreshJtiTtlMs(Math.floor(Date.now() / 1000) - 10)).toBe(1_000);
  });

  it('falls back to ~7d when exp is missing', () => {
    expect(refreshJtiTtlMs(undefined)).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('AuthService.refresh jti reuse detection', () => {
  const user = {
    id: 'user-1',
    email: 'a@b.co',
    role: 'USER',
    tokenVersion: 3,
  };

  let users: {
    findById: jest.Mock;
    bumpTokenVersion: jest.Mock;
  };
  let jwt: { verifyAsync: jest.Mock; signAsync: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    redisStore.clear();
    setCalls.length = 0;
    users = {
      findById: jest.fn().mockResolvedValue(user),
      bumpTokenVersion: jest.fn().mockResolvedValue(undefined),
    };
    jwt = {
      verifyAsync: jest.fn(),
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('access.jwt')
        .mockResolvedValueOnce('refresh.jwt'),
    };

    service = new AuthService(
      users as unknown as UsersService,
      jwt as unknown as JwtService,
      {} as CryptoService,
      { get: jest.fn() } as unknown as EntitlementsService,
      { consume: jest.fn() } as never,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('issues new tokens and marks the refresh jti used on first redeem', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    jwt.verifyAsync.mockResolvedValue({
      sub: user.id,
      tv: user.tokenVersion,
      jti: 'jti-1',
      exp,
    });

    const tokens = await service.refresh('old-refresh');
    expect(tokens).toEqual({
      accessToken: 'access.jwt',
      refreshToken: 'refresh.jwt',
    });
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].key).toBe('auth:refresh:jti:jti-1');
    expect(setCalls[0].nx).toBe(true);
    expect(users.bumpTokenVersion).not.toHaveBeenCalled();
  });

  it('rejects reuse of the same jti and bumps tokenVersion', async () => {
    redisStore.set('auth:refresh:jti:jti-stolen', '1');
    jwt.verifyAsync.mockResolvedValue({
      sub: user.id,
      tv: user.tokenVersion,
      jti: 'jti-stolen',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    await expect(service.refresh('replayed')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(users.bumpTokenVersion).toHaveBeenCalledWith(user.id);
  });

  it('rejects refresh tokens that lack a jti claim', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: user.id,
      tv: user.tokenVersion,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    await expect(service.refresh('legacy')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(setCalls).toHaveLength(0);
  });

  it('rejects when tokenVersion (tv) is stale', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: user.id,
      tv: 1,
      jti: 'jti-old',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    await expect(service.refresh('stale-tv')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(setCalls).toHaveLength(0);
  });
});
