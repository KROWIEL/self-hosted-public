import { randomBytes } from 'node:crypto';
import { collectEnvErrors } from './validate-env';

// A compliant JWT signing secret: >= 32 chars, contains no "change-me"
// placeholder, and is not one of the shipped .env.example defaults. base64 of
// 48 random bytes is always 64 chars and only uses the [A-Za-z0-9+/=] alphabet,
// so it can never accidentally contain "change-me".
const strongSecret = (): string => randomBytes(48).toString('base64');

const validEnv = (): NodeJS.ProcessEnv => ({
  DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: strongSecret(),
  JWT_REFRESH_SECRET: strongSecret(),
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

  // JWT signing secrets must be strong in EVERY environment: a weak, default or
  // shipped-example secret lets anyone forge valid sessions. These cases lock in
  // that the validator treats such secrets as fatal configuration errors.
  describe.each(['JWT_SECRET', 'JWT_REFRESH_SECRET'])(
    '%s strength enforcement',
    (key) => {
      it('rejects a missing secret', () => {
        const env = validEnv();
        delete env[key];
        expect(collectEnvErrors(env).some((e) => e.includes(key))).toBe(true);
      });

      it('rejects a blank secret', () => {
        const env = validEnv();
        env[key] = '   ';
        expect(collectEnvErrors(env).some((e) => e.includes(key))).toBe(true);
      });

      it('rejects a secret shorter than 32 characters', () => {
        const env = validEnv();
        env[key] = 'a'.repeat(31);
        expect(
          collectEnvErrors(env).some(
            (e) => e.includes(key) && e.includes('32 characters'),
          ),
        ).toBe(true);
      });

      it('accepts a compliant secret of exactly 32 characters', () => {
        const env = validEnv();
        env[key] = 'a'.repeat(32);
        expect(collectEnvErrors(env)).toEqual([]);
      });

      it('rejects a secret containing the "change-me" placeholder', () => {
        const env = validEnv();
        env[key] = `change-me-${'x'.repeat(40)}`;
        expect(
          collectEnvErrors(env).some(
            (e) => e.includes(key) && e.includes('change-me'),
          ),
        ).toBe(true);
      });
    },
  );

  it('rejects the exact JWT secrets shipped in .env.example', () => {
    const env = validEnv();
    env.JWT_SECRET = 'change-me-access-secret';
    env.JWT_REFRESH_SECRET = 'change-me-refresh-secret';
    const errors = collectEnvErrors(env);
    expect(errors.some((e) => e.includes('JWT_SECRET'))).toBe(true);
    expect(errors.some((e) => e.includes('JWT_REFRESH_SECRET'))).toBe(true);
  });

  // WEBHOOK_SECRET is only enforced in production, and must be a dedicated
  // secret rather than a reuse of the JWT signing key.
  describe('WEBHOOK_SECRET (production only)', () => {
    it('is not required outside production', () => {
      const env = validEnv();
      delete env.WEBHOOK_SECRET;
      expect(collectEnvErrors(env)).toEqual([]);
    });

    it('is required in production', () => {
      const env = validEnv();
      env.NODE_ENV = 'production';
      delete env.WEBHOOK_SECRET;
      expect(
        collectEnvErrors(env).some((e) => e.includes('WEBHOOK_SECRET')),
      ).toBe(true);
    });

    it('must not reuse JWT_SECRET in production', () => {
      const env = validEnv();
      env.NODE_ENV = 'production';
      env.WEBHOOK_SECRET = env.JWT_SECRET;
      expect(
        collectEnvErrors(env).some(
          (e) => e.includes('WEBHOOK_SECRET') && e.includes('JWT_SECRET'),
        ),
      ).toBe(true);
    });

    it('accepts a dedicated secret in production', () => {
      const env = validEnv();
      env.NODE_ENV = 'production';
      env.WEBHOOK_SECRET = strongSecret();
      expect(collectEnvErrors(env)).toEqual([]);
    });
  });
});
