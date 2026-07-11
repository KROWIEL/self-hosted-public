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

  const require = (key: string): string | undefined => {
    const v = env[key];
    if (!v || v.trim() === '') errors.push(`${key} is required`);
    return v;
  };

  require('DATABASE_URL');
  require('REDIS_URL');
  require('JWT_SECRET');
  require('JWT_REFRESH_SECRET');

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

  // Warn (not fatal) about weak dev defaults so prod deployments get flagged.
  if (process.env.NODE_ENV === 'production') {
    const weak = ['dev-', 'change-me'];
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
      const v = process.env[key] ?? '';
      if (weak.some((w) => v.includes(w))) {
        logger.warn(`${key} looks like a dev default — set a strong secret.`);
      }
    }
  }

  if (errors.length > 0) {
    logger.error('Invalid configuration:');
    for (const e of errors) logger.error(`  - ${e}`);
    throw new Error(
      `Startup aborted: ${errors.length} configuration error(s). See logs above.`,
    );
  }
}
