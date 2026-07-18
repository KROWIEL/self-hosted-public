/**
 * Pure helpers for shaping outbound alert deliveries. Kept free of Nest/DB so
 * payload construction can be unit-tested without mocking crypto or fetch.
 */

export const ALERT_CHANNEL_TYPES = [
  'webhook',
  'discord',
  'slack',
  'telegram',
] as const;

export type AlertChannelType = (typeof ALERT_CHANNEL_TYPES)[number];

export interface AlertPayload {
  event: string;
  title: string;
  body: string;
}

export type ChannelConfig =
  | { url: string }
  | { botToken: string; chatId: string };

export interface AlertDelivery {
  /** Absolute HTTPS URL to POST. */
  url: string;
  /** JSON body for the request. */
  body: Record<string, unknown>;
}

/** True when `type` is a known first-class channel type. */
export function isAlertChannelType(type: string): type is AlertChannelType {
  return (ALERT_CHANNEL_TYPES as readonly string[]).includes(type);
}

/**
 * Validates that `raw` is an https URL. Throws a plain Error with a safe
 * message (never includes secrets).
 */
export function assertHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid webhook URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('webhook URL must use https');
  }
  return url;
}

/**
 * Builds the outbound URL + JSON body for a channel type. Does not perform
 * network I/O. Never includes the bot token in thrown messages.
 */
export function buildAlertDelivery(
  type: string,
  cfg: ChannelConfig,
  payload: AlertPayload,
): AlertDelivery {
  const text = `${payload.title}\n${payload.body}`;
  const channelType = isAlertChannelType(type) ? type : 'webhook';

  if (channelType === 'telegram') {
    const tg = cfg as { botToken?: string; chatId?: string };
    if (!tg.botToken || !tg.chatId) {
      throw new Error('telegram channel missing botToken or chatId');
    }
    return {
      url: `https://api.telegram.org/bot${tg.botToken}/sendMessage`,
      body: { chat_id: tg.chatId, text },
    };
  }

  const urlCfg = cfg as { url?: string };
  if (!urlCfg.url) throw new Error('channel has no url configured');
  assertHttpsUrl(urlCfg.url);

  if (channelType === 'discord') {
    return { url: urlCfg.url, body: { content: text } };
  }
  if (channelType === 'slack') {
    return { url: urlCfg.url, body: { text } };
  }

  // Generic webhook: hybrid payload for Slack/Discord/Mattermost/custom.
  return {
    url: urlCfg.url,
    body: {
      text,
      content: text,
      event: payload.event,
      title: payload.title,
      body: payload.body,
      at: new Date().toISOString(),
    },
  };
}
