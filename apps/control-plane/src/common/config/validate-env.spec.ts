import { randomBytes } from 'node:crypto';
import { collectEnvErrors } from './validate-env';

const validEnv = (): NodeJS.ProcessEnv => ({
  DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

describe('collectEnvErrors', () => {
  it('returns no errors for a complete, valid config', () => {
    expect(collectEnvErrors(validEnv())).toEqual([]);
  });

  it('flags every missing required variable', () => {
    const errors = collectEnvErrors({});
    for (const key of [
      'DATABASE_URL',
      'REDIS_URL',
      'JWT_SECRET',
      'JWT_REFRESH_SECRET',
      'ENCRYPTION_KEY',
    ]) {
      expect(errors.some((e) => e.includes(key))).toBe(true);
    }
  });

  it('treats blank values as missing', () => {
    const env = validEnv();
    env.JWT_SECRET = '   ';
    expect(collectEnvErrors(env).some((e) => e.includes('JWT_SECRET'))).toBe(
      true,
    );
  });

  it('rejects an ENCRYPTION_KEY that is not 32 bytes', () => {
    const env = validEnv();
    env.ENCRYPTION_KEY = Buffer.from('too short').toString('base64');
    expect(
      collectEnvErrors(env).some((e) => e.includes('ENCRYPTION_KEY')),
    ).toBe(true);
  });
});
