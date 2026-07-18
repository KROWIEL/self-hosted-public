import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';

/** How long a minted exec ticket stays valid before it expires (single-use). */
const TICKET_TTL_MS = 30_000;

/** What an exec ticket is bound to. */
export interface ExecTicketPayload {
  userId: string;
  serviceId: string;
  /** Session epoch at mint time; re-checked against the DB when redeemed. */
  tokenVersion: number;
}

/**
 * Mints and redeems short-lived, single-use tickets that authorize opening an
 * exec WebSocket. Replaces putting the raw access JWT in the WS query string
 * (which leaks into proxy logs/history). Tickets live in Redis with a TTL and
 * are deleted atomically on redemption so they can't be replayed.
 */
@Injectable()
export class ExecTicketService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  }

  private key(ticket: string): string {
    return `exec:ticket:${ticket}`;
  }

  /** Mints an opaque ticket bound to {userId, serviceId, tokenVersion}. */
  async mint(
    userId: string,
    serviceId: string,
    tokenVersion: number,
  ): Promise<string> {
    const ticket = randomBytes(32).toString('hex');
    const payload: ExecTicketPayload = { userId, serviceId, tokenVersion };
    await this.redis.set(
      this.key(ticket),
      JSON.stringify(payload),
      'PX',
      TICKET_TTL_MS,
    );
    return ticket;
  }

  /**
   * Atomically consumes a ticket (get + delete). Returns its payload, or null
   * if the ticket is unknown, expired or already used.
   */
  async redeem(ticket: string): Promise<ExecTicketPayload | null> {
    if (!ticket) return null;
    let raw: string | null;
    try {
      // GETDEL (Redis 6.2+) makes lookup + burn atomic, preventing replay.
      raw = await this.redis.getdel(this.key(ticket));
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as ExecTicketPayload;
      if (
        !parsed?.userId ||
        !parsed?.serviceId ||
        typeof parsed?.tokenVersion !== 'number'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
