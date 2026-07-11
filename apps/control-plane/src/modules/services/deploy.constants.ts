import type { ConnectionOptions } from 'bullmq';

export const DEPLOY_QUEUE = 'DEPLOY_QUEUE';
export const DEPLOY_QUEUE_NAME = 'deploy';

/** Redis key guarding against concurrent deploys of the same service. */
export function deployLockKey(serviceId: string): string {
  return `deploy:lock:${serviceId}`;
}

/** Auto-expiry so a crashed worker can't wedge a service permanently. */
export const DEPLOY_LOCK_TTL_MS = 15 * 60 * 1000;

export interface DeployJobData {
  deploymentId: string;
  serviceId: string;
  /** When set, redeploy this existing image instead of building (rollback). */
  rollbackImageTag?: string;
  rollbackCommitSha?: string;
}

/**
 * Builds BullMQ connection options from REDIS_URL. Returning plain options
 * (instead of an ioredis instance) avoids dual-ioredis type clashes and lets
 * BullMQ manage its own connections. `maxRetriesPerRequest: null` is required
 * by the worker.
 */
export function createRedisConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db:
      url.pathname && url.pathname !== '/'
        ? Number(url.pathname.slice(1))
        : undefined,
    maxRetriesPerRequest: null,
  };
}
