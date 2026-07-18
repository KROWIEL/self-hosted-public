import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { CryptoService } from '../../common/crypto/crypto.service';
import { assertPublicHost } from '../../common/net/ssrf-guard';
import { alertChannels, alertEvents, alertRules } from '../../db/schema';
import {
  AlertChannelType,
  AlertPayload,
  ChannelConfig,
  assertHttpsUrl,
  buildAlertDelivery,
  isAlertChannelType,
} from './alerts.delivery';

type ChannelRow = typeof alertChannels.$inferSelect;

/**
 * CRUD for alert channels/rules plus notification dispatch. Channel configs
 * (which may embed webhook secrets / bot tokens) are encrypted at rest; only a
 * redacted target hint is ever returned to the UI.
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

  async createChannel(dto: {
    name: string;
    type?: string;
    url?: string;
    botToken?: string;
    chatId?: string;
  }) {
    const type = (dto.type ?? 'webhook') as AlertChannelType;
    if (!isAlertChannelType(type)) {
      throw new BadRequestException(`unsupported channel type: ${type}`);
    }
    const config = this.buildConfig(type, dto);
    await this.assertConfigSafe(type, config);
    const configEnc = this.crypto.encrypt(JSON.stringify(config));
    const [row] = await this.db
      .insert(alertChannels)
      .values({ name: dto.name, type, configEnc })
      .returning();
    return this.viewChannel(row);
  }

  async updateChannel(
    id: string,
    dto: {
      name?: string;
      url?: string;
      botToken?: string;
      chatId?: string;
      enabled?: boolean;
    },
  ) {
    const [existing] = await this.db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('channel not found');

    const patch: Partial<typeof alertChannels.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;

    const wantsConfig =
      dto.url !== undefined ||
      dto.botToken !== undefined ||
      dto.chatId !== undefined;
    if (wantsConfig) {
      const type = isAlertChannelType(existing.type)
        ? existing.type
        : 'webhook';
      let prev: Record<string, string> = {};
      try {
        prev = JSON.parse(this.crypto.decrypt(existing.configEnc)) as Record<
          string,
          string
        >;
      } catch {
        prev = {};
      }
      const merged = {
        url: dto.url ?? prev.url,
        botToken: dto.botToken ?? prev.botToken,
        chatId: dto.chatId ?? prev.chatId,
      };
      const config = this.buildConfig(type, merged);
      await this.assertConfigSafe(type, config);
      patch.configEnc = this.crypto.encrypt(JSON.stringify(config));
    }

    if (Object.keys(patch).length === 0) {
      return this.viewChannel(existing);
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

  private buildConfig(
    type: AlertChannelType,
    dto: { url?: string; botToken?: string; chatId?: string },
  ): ChannelConfig {
    if (type === 'telegram') {
      if (!dto.botToken?.trim() || !dto.chatId?.trim()) {
        throw new BadRequestException(
          'telegram channels require botToken and chatId',
        );
      }
      return {
        botToken: dto.botToken.trim(),
        chatId: dto.chatId.trim(),
      };
    }
    if (!dto.url?.trim()) {
      throw new BadRequestException(`${type} channels require a https url`);
    }
    assertHttpsUrl(dto.url.trim());
    return { url: dto.url.trim() };
  }

  /**
   * Discord/Slack/Telegram hit public SaaS hosts — apply the shared SSRF
   * denylist. Generic webhooks may target LAN/n8n, so only https is enforced.
   */
  private async assertConfigSafe(
    type: AlertChannelType,
    config: ChannelConfig,
  ): Promise<void> {
    if (type === 'telegram') {
      await assertPublicHost('api.telegram.org');
      return;
    }
    const { url } = config as { url: string };
    const parsed = assertHttpsUrl(url);
    if (type === 'discord' || type === 'slack') {
      await assertPublicHost(parsed.hostname);
    }
  }

  private viewChannel(row: ChannelRow) {
    let target = '';
    try {
      const cfg = JSON.parse(this.crypto.decrypt(row.configEnc)) as {
        url?: string;
        chatId?: string;
      };
      if (row.type === 'telegram') {
        target = cfg.chatId ? `chat:${cfg.chatId}` : '';
      } else {
        target = cfg.url ? new URL(cfg.url).host : '';
      }
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
        // Never surface secrets (bot tokens live in the URL path for Telegram).
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${ch.name}: ${msg}`);
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
    const cfg = JSON.parse(this.crypto.decrypt(channel.configEnc)) as ChannelConfig;
    const delivery = buildAlertDelivery(channel.type, cfg, payload);

    // SaaS destinations: re-check host at send time (config may predate checks).
    if (channel.type === 'discord' || channel.type === 'slack') {
      await assertPublicHost(new URL(delivery.url).hostname);
    } else if (channel.type === 'telegram') {
      await assertPublicHost('api.telegram.org');
    } else {
      assertHttpsUrl(delivery.url);
    }

    const res = await fetch(delivery.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(delivery.body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`${channel.type} responded HTTP ${res.status}`);
    }
  }
}
