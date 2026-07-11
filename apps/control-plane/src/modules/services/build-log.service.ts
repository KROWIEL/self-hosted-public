import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/** Sentinel published on a channel to signal the build log has ended. */
const END_SENTINEL = '\u0004__DEPLOY_END__\u0004';
/** Keep buffered build logs around for an hour for late subscribers. */
const HISTORY_TTL_SECONDS = 3600;

/**
 * Fan-out of live build-log output over Redis: the deploy worker publishes
 * chunks while building, and the HTTP stream endpoint replays buffered history
 * then subscribes for new chunks. Decoupling via Redis means the worker and the
 * API can live in different processes.
 */
@Injectable()
export class BuildLogService implements OnModuleDestroy {
  private readonly pub: Redis;

  constructor() {
    this.pub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  }

  private channel(id: string): string {
    return `deploy:logs:${id}`;
  }

  private listKey(id: string): string {
    return `deploy:loglist:${id}`;
  }

  /** Buffers a chunk for late subscribers and publishes it live. */
  async publish(deploymentId: string, chunk: string): Promise<void> {
    if (!chunk) return;
    try {
      await this.pub.rpush(this.listKey(deploymentId), chunk);
      await this.pub.expire(this.listKey(deploymentId), HISTORY_TTL_SECONDS);
      await this.pub.publish(this.channel(deploymentId), chunk);
    } catch {
      // Logging is best-effort; never fail a deploy because Redis hiccuped.
    }
  }

  /** Signals that no more chunks will be produced for this deployment. */
  async end(deploymentId: string): Promise<void> {
    try {
      await this.pub.publish(this.channel(deploymentId), END_SENTINEL);
    } catch {
      // best-effort
    }
  }

  /** Returns everything buffered so far for a deployment. */
  async history(deploymentId: string): Promise<string> {
    try {
      const items = await this.pub.lrange(this.listKey(deploymentId), 0, -1);
      return items.join('');
    } catch {
      return '';
    }
  }

  /**
   * Subscribes to live chunks for a deployment. Returns a cleanup function that
   * the caller must invoke (e.g. on client disconnect).
   */
  subscribe(
    deploymentId: string,
    onChunk: (chunk: string) => void,
    onEnd: () => void,
  ): () => void {
    const sub = this.pub.duplicate();
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      sub.removeAllListeners();
      sub.disconnect();
    };
    sub.on('message', (_channel, message) => {
      if (message === END_SENTINEL) {
        onEnd();
        cleanup();
        return;
      }
      onChunk(message);
    });
    sub.subscribe(this.channel(deploymentId)).catch(() => {
      onEnd();
      cleanup();
    });
    return cleanup;
  }

  onModuleDestroy() {
    this.pub.disconnect();
  }
}
