import {
  assertHttpsUrl,
  buildAlertDelivery,
} from './alerts.delivery';

describe('alerts.delivery', () => {
  const payload = {
    event: 'node.offline',
    title: 'Node down',
    body: 'worker-1 is offline',
  };

  describe('assertHttpsUrl', () => {
    it('accepts https URLs', () => {
      expect(assertHttpsUrl('https://hooks.slack.com/services/T/B/x').hostname).toBe(
        'hooks.slack.com',
      );
    });

    it('rejects http', () => {
      expect(() => assertHttpsUrl('http://example.com/hook')).toThrow(/https/i);
    });

    it('rejects non-URL strings', () => {
      expect(() => assertHttpsUrl('not-a-url')).toThrow(/invalid/i);
    });
  });

  describe('buildAlertDelivery', () => {
    it('shapes discord content payload', () => {
      const d = buildAlertDelivery(
        'discord',
        { url: 'https://discord.com/api/webhooks/1/abc' },
        payload,
      );
      expect(d.url).toBe('https://discord.com/api/webhooks/1/abc');
      expect(d.body).toEqual({
        content: 'Node down\nworker-1 is offline',
      });
    });

    it('shapes slack text payload', () => {
      const d = buildAlertDelivery(
        'slack',
        { url: 'https://hooks.slack.com/services/T/B/x' },
        payload,
      );
      expect(d.body).toEqual({ text: 'Node down\nworker-1 is offline' });
    });

    it('shapes telegram sendMessage request without exposing token in body keys', () => {
      const token = '123456:AA-secret-token';
      const d = buildAlertDelivery(
        'telegram',
        { botToken: token, chatId: '-100123' },
        payload,
      );
      expect(d.url).toBe(
        `https://api.telegram.org/bot${token}/sendMessage`,
      );
      expect(d.body).toEqual({
        chat_id: '-100123',
        text: 'Node down\nworker-1 is offline',
      });
      expect(JSON.stringify(d.body)).not.toContain(token);
    });

    it('shapes hybrid webhook payload', () => {
      const d = buildAlertDelivery(
        'webhook',
        { url: 'https://hooks.example.com/in' },
        payload,
      );
      expect(d.body.text).toBe('Node down\nworker-1 is offline');
      expect(d.body.content).toBe('Node down\nworker-1 is offline');
      expect(d.body.event).toBe('node.offline');
      expect(d.body.title).toBe('Node down');
      expect(d.body.body).toBe('worker-1 is offline');
      expect(typeof d.body.at).toBe('string');
    });

    it('rejects telegram without credentials', () => {
      expect(() =>
        buildAlertDelivery('telegram', { url: 'https://x' } as never, payload),
      ).toThrow(/botToken|chatId/i);
    });

    it('rejects non-https webhook urls', () => {
      expect(() =>
        buildAlertDelivery(
          'discord',
          { url: 'http://discord.com/api/webhooks/1/x' },
          payload,
        ),
      ).toThrow(/https/i);
    });
  });
});
