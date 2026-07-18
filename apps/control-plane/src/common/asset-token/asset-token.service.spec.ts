import { randomBytes } from 'node:crypto';
import {
  AssetTokenService,
  assetTokenTtlMs,
  sanitizePath,
} from './asset-token.service';
import { CryptoService } from '../crypto/crypto.service';

const redisStore = new Map<string, string>();

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set: jest.fn(
      async (
        key: string,
        _val: string,
        ...rest: Array<string | number>
      ): Promise<'OK' | null> => {
        if (rest.includes('NX') && redisStore.has(key)) return null;
        redisStore.set(key, '1');
        return 'OK';
      },
    ),
    disconnect: jest.fn(),
    on: jest.fn(),
  }));
});

describe('assetTokenTtlMs', () => {
  const keys = [
    'ASSET_TOKEN_TTL_MS',
    'NODE_ASSET_TOKEN_TTL_MS',
    'TUNNEL_ASSET_TOKEN_TTL_MS',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('defaults to 30 minutes', () => {
    expect(assetTokenTtlMs()).toBe(30 * 60 * 1000);
  });

  it('honors ASSET_TOKEN_TTL_MS override', () => {
    process.env.ASSET_TOKEN_TTL_MS = '900000';
    expect(assetTokenTtlMs()).toBe(900_000);
  });
});

describe('sanitizePath', () => {
  it('keeps simple route segments', () => {
    expect(sanitizePath('bin/linux-amd64')).toBe('bin/linux-amd64');
    expect(sanitizePath('install.sh')).toBe('install.sh');
  });

  it('strips unsafe characters', () => {
    expect(sanitizePath('bin/../etc')).toBe('bin/../etc');
    expect(sanitizePath('a b?c')).toBe('a_b_c');
  });
});

describe('AssetTokenService', () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  let crypto: CryptoService;
  let svc: AssetTokenService;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY = originalKey;
  });

  beforeEach(() => {
    redisStore.clear();
    crypto = new CryptoService();
    svc = new AssetTokenService(crypto);
  });

  afterEach(() => {
    svc.onModuleDestroy();
  });

  it('mints a consumable token and rejects replay on the same path', async () => {
    const token = svc.mint('node-asset');
    expect(await svc.consume(token, 'node-asset', 'install.sh')).toBe(true);
    expect(await svc.consume(token, 'node-asset', 'install.sh')).toBe(false);
  });

  it('allows the same token once per distinct path (install + binary)', async () => {
    const token = svc.mint('tunnel-asset');
    expect(await svc.consume(token, 'tunnel-asset', 'install.sh')).toBe(true);
    expect(
      await svc.consume(token, 'tunnel-asset', 'bin/linux-amd64'),
    ).toBe(true);
    expect(
      await svc.consume(token, 'tunnel-asset', 'bin/linux-amd64'),
    ).toBe(false);
  });

  it('rejects wrong kind and missing/empty tokens', async () => {
    const token = svc.mint('node-asset');
    expect(await svc.consume(token, 'tunnel-asset', 'install.sh')).toBe(false);
    expect(await svc.consume(null, 'node-asset', 'install.sh')).toBe(false);
    expect(await svc.consume('', 'node-asset', 'install.sh')).toBe(false);
  });

  it('rejects expired tokens', async () => {
    const prev = process.env.ASSET_TOKEN_TTL_MS;
    process.env.ASSET_TOKEN_TTL_MS = '1';
    const shortLived = new AssetTokenService(crypto);
    const token = shortLived.mint('node-asset');
    await new Promise((r) => setTimeout(r, 5));
    expect(await shortLived.consume(token, 'node-asset', 'install.sh')).toBe(
      false,
    );
    shortLived.onModuleDestroy();
    if (prev === undefined) delete process.env.ASSET_TOKEN_TTL_MS;
    else process.env.ASSET_TOKEN_TTL_MS = prev;
  });
});
