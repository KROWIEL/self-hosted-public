import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { CryptoService } from '../../common/crypto/crypto.service';
import { alertChannels, alertEvents, alertRules } from '../../db/schema';

interface AlertPayload {
  event: string;
  title: string;
  body: string;
}

type ChannelRow = typeof alertChannels.$inferSelect;

/**
 * CRUD for alert channels/rules plus notification dispatch. Channel configs
 * (which may embed webhook secrets) are encrypted at rest; only the target host
 * is ever returned to the UI.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  // ---- Channels ----

  async listChannels() {
    const rows = await this.db
      .select()
      .from(alertChannels)
      .orderBy(desc(alertChannels.createdAt));
    return rows.map((r) => this.viewChannel(r));
  }

  async createChannel(dto: { name: string; type?: string; url: string }) {
    const configEnc = this.crypto.encrypt(JSON.stringify({ url: dto.url }));
    const [row] = await this.db
      .insert(alertChannels)
      .values({ name: dto.name, type: dto.type ?? 'webhook', configEnc })
      .returning();
    return this.viewChannel(row);
  }

  async updateChannel(
    id: string,
    dto: { name?: string; url?: string; enabled?: boolean },
  ) {
    const patch: Partial<typeof alertChannels.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.url !== undefined) {
      patch.configEnc = this.crypto.encrypt(JSON.stringify({ url: dto.url }));
    }
    if (Object.keys(patch).length === 0) {
      const [row] = await this.db
        .select()
        .from(alertChannels)
        .where(eq(alertChannels.id, id))
        .limit(1);
      if (!row) throw new NotFoundException('channel not found');
      return this.viewChannel(row);
    }
    const [row] = await this.db
      .update(alertChannels)
      .set(patch)
      .where(eq(alertChannels.id, id))
      .returning();
    if (!row) throw new NotFoundException('channel not found');
    return this.viewChannel(row);
  }

  async deleteChannel(id: string) {
    await this.db.delete(alertChannels).where(eq(alertChannels.id, id));
    return { ok: true };
  }

  async testChannel(id: string) {
    const [row] = await this.db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('channel not found');
    await this.send(row, {
      event: 'test',
      title: 'Test alert',
      body: 'This is a test notification from your self-hosted panel.',
    });
    return { ok: true };
  }

  private viewChannel(row: ChannelRow) {
    let target = '';
    try {
      const cfg = JSON.parse(this.crypto.decrypt(row.configEnc)) as {
        url?: string;
      };
      target = cfg.url ? new URL(cfg.url).host : '';
    } catch {
      /* corrupt/unreadable config — show nothing */
    }
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: row.enabled,
      target,
      createdAt: row.createdAt,
    };
  }

  // ---- Rules ----

  listRules() {
    return this.db
      .select()
      .from(alertRules)
      .orderBy(desc(alertRules.createdAt));
  }

  async createRule(dto: {
    name: string;
    event: string;
    channelId: string;
    enabled?: boolean;
  }) {
    const [channel] = await this.db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.id, dto.channelId))
      .limit(1);
    if (!channel) throw new NotFoundException('channel not found');
    const [row] = await this.db
      .insert(alertRules)
      .values({
        name: dto.name,
        event: dto.event,
        channelId: dto.channelId,
        enabled: dto.enabled ?? true,
      })
      .returning();
    return row;
  }

  async updateRule(id: string, dto: { name?: string; enabled?: boolean }) {
    const patch: Partial<typeof alertRules.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (Object.keys(patch).length === 0) {
      const [row] = await this.db
        .select()
        .from(alertRules)
        .where(eq(alertRules.id, id))
        .limit(1);
      if (!row) throw new NotFoundException('rule not found');
      return row;
    }
    const [row] = await this.db
      .update(alertRules)
      .set(patch)
      .where(eq(alertRules.id, id))
      .returning();
    if (!row) throw new NotFoundException('rule not found');
    return row;
  }

  async deleteRule(id: string) {
    await this.db.delete(alertRules).where(eq(alertRules.id, id));
    return { ok: true };
  }

  // ---- Events ----

  listEvents(limit = 100) {
    return this.db
      .select()
      .from(alertEvents)
      .orderBy(desc(alertEvents.createdAt))
      .limit(Math.min(Math.max(limit, 1), 500));
  }

  // ---- Dispatch ----

  /**
   * Deliver an incident to every enabled channel wired to `event`. `dedupeKey`
   * guarantees a given incident notifies only once (the insert claims it).
   */
  async dispatch(
    event: string,
    dedupeKey: string,
    title: string,
    body: string,
  ): Promise<void> {
    const [claimed] = await this.db
      .insert(alertEvents)
      .values({ event, dedupeKey, title, body, status: 'sent' })
      .onConflictDoNothing({ target: alertEvents.dedupeKey })
      .returning();
    if (!claimed) return; // already dispatched for this incident

    const rules = await this.db
      .select()
      .from(alertRules)
      .where(and(eq(alertRules.event, event), eq(alertRules.enabled, true)));

    const errors: string[] = [];
    for (const rule of rules) {
      const [ch] = await this.db
        .select()
        .from(alertChannels)
        .where(eq(alertChannels.id, rule.channelId))
        .limit(1);
      if (!ch || !ch.enabled) continue;
      try {
        await this.send(ch, { event, title, body });
      } catch (e) {
        errors.push(`${ch.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (errors.length) {
      await this.db
        .update(alertEvents)
        .set({ status: 'failed', error: errors.join('; ').slice(0, 1000) })
        .where(eq(alertEvents.id, claimed.id));
      this.logger.warn(`Alert "${title}" had delivery errors: ${errors.join('; ')}`);
    }
  }

  private async send(channel: ChannelRow, payload: AlertPayload) {
    const cfg = JSON.parse(this.crypto.decrypt(channel.configEnc)) as {
      url?: string;
    };
    if (!cfg.url) throw new Error('channel has no url configured');
    const text = `${payload.title}\n${payload.body}`;
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `text` (Slack/Mattermost) + `content` (Discord) + structured fields so
      // one webhook payload works across the common receivers.
      body: JSON.stringify({
        text,
        content: text,
        event: payload.event,
        title: payload.title,
        body: payload.body,
        at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`webhook responded HTTP ${res.status}`);
  }
}
