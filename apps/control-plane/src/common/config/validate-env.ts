import { Logger } from '@nestjs/common';
import { config as loadEnv } from 'dotenv';

/**
 * Fail fast on misconfiguration: verify required environment variables are
 * present and well-formed before the app starts accepting traffic. A clear
 * error here beats obscure runtime failures (e.g. a bad ENCRYPTION_KEY only
 * surfacing when the first secret is decrypted).
 *
 * We run before NestFactory (so ConfigModule hasn't loaded .env yet); mirror
 * its file precedence here (repo-root .env first, then app-local .env).
 */
/**
 * Pure validation: returns a list of human-readable problems for the given
 * environment (empty = valid). Extracted so it can be unit-tested without
 * touching the real process environment or dotenv files.
 */
export function collectEnvErrors(env: NodeJS.ProcessEnv): string[] {
  const errors: string[] = [];

  // Optional feature flags (documented for discoverability; not validated here):
  //   ALLOW_OPEN_REGISTRATION  - "1"/"true" to enable public POST /auth/register
  //                              (default OFF; seeded admin + SSO are unaffected).

  const require = (key: string): string | undefined => {
    const v = env[key];
    if (!v || v.trim() === '') errors.push(`${key} is required`);
    return v;
  };

  require('DATABASE_URL');
  require('REDIS_URL');

  // WEBHOOK_SECRET signs deploy-webhook tokens. It must be a dedicated secret
  // (not the JWT signing key) and is required in production; in dev an insecure
  // fallback is used with a runtime warning.
  if ((env.NODE_ENV ?? '') === 'production') {
    const webhook = env.WEBHOOK_SECRET;
    if (!webhook || webhook.trim() === '') {
      errors.push('WEBHOOK_SECRET is required in production');
    } else if (webhook === env.JWT_SECRET) {
      errors.push('WEBHOOK_SECRET must not reuse JWT_SECRET');
    }
  }

  // JWT signing secrets must be strong in EVERY environment — a weak, default
  // or shipped-example secret lets anyone forge valid sessions. This is a fatal
  // startup error (collected below), not a warning.
  const jwtExampleDefaults: Record<string, string> = {
    JWT_SECRET: 'change-me-access-secret',
    JWT_REFRESH_SECRET: 'change-me-refresh-secret',
  };
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    const v = env[key];
    if (!v || v.trim() === '') {
      errors.push(`${key} is required`);
      continue;
    }
    if (v.length < 32) {
      errors.push(`${key} must be at least 32 characters long`);
    }
    if (v.includes('change-me')) {
      errors.push(`${key} must not contain the placeholder "change-me"`);
    } else if (v === jwtExampleDefaults[key]) {
      errors.push(`${key} must not use the shipped .env.example default`);
    }
  }

  // ENCRYPTION_KEY must be a base64-encoded 32-byte (256-bit) key for AES-256-GCM.
  const encKey = require('ENCRYPTION_KEY');
  if (encKey) {
    let bytes = 0;
    try {
      bytes = Buffer.from(encKey, 'base64').length;
    } catch {
      bytes = 0;
    }
    if (bytes !== 32) {
      errors.push(
        `ENCRYPTION_KEY must be base64 for exactly 32 bytes (got ${bytes}). ` +
          `Generate one with: openssl rand -base64 32`,
      );
    }
  }

  return errors;
}

export function validateEnv(): void {
  loadEnv({ path: '../../.env' });
  loadEnv({ path: '.env' });

  const logger = new Logger('Config');
  const errors = collectEnvErrors(process.env);

  if (errors.length > 0) {
    logger.error('Invalid configuration:');
    for (const e of errors) logger.error(`  - ${e}`);
    throw new Error(
      `Startup aborted: ${errors.length} configuration error(s). See logs above.`,
    );
  }
}
