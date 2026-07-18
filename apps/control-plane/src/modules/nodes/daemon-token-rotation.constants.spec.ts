import {
  isDueForDaemonTokenRotation,
  parseDaemonTokenRotationDays,
} from './daemon-token-rotation.constants';

describe('parseDaemonTokenRotationDays', () => {
  it('defaults to 30 when unset', () => {
    expect(parseDaemonTokenRotationDays(undefined)).toBe(30);
    expect(parseDaemonTokenRotationDays('')).toBe(30);
    expect(parseDaemonTokenRotationDays('  ')).toBe(30);
  });

  it('accepts 0 to disable', () => {
    expect(parseDaemonTokenRotationDays('0')).toBe(0);
  });

  it('floors positive values', () => {
    expect(parseDaemonTokenRotationDays('30')).toBe(30);
    expect(parseDaemonTokenRotationDays('7.9')).toBe(7);
  });

  it('falls back on garbage', () => {
    expect(parseDaemonTokenRotationDays('nope')).toBe(30);
  });
});

describe('isDueForDaemonTokenRotation', () => {
  const day = 24 * 60 * 60_000;
  const now = Date.parse('2026-07-18T12:00:00.000Z');

  const base = {
    status: 'ONLINE',
    daemonTokenPrev: null as string | null,
    daemonTokenRotatedAt: null as Date | null,
    createdAt: new Date(now - 40 * day),
  };

  it('is due when older than the interval', () => {
    expect(isDueForDaemonTokenRotation(base, now, 30)).toBe(true);
  });

  it('skips offline nodes', () => {
    expect(
      isDueForDaemonTokenRotation({ ...base, status: 'OFFLINE' }, now, 30),
    ).toBe(false);
  });

  it('skips nodes mid-rotation', () => {
    expect(
      isDueForDaemonTokenRotation(
        { ...base, daemonTokenPrev: 'enc-prev' },
        now,
        30,
      ),
    ).toBe(false);
  });

  it('skips recently rotated nodes', () => {
    expect(
      isDueForDaemonTokenRotation(
        {
          ...base,
          daemonTokenRotatedAt: new Date(now - 5 * day),
        },
        now,
        30,
      ),
    ).toBe(false);
  });

  it('uses createdAt when never rotated', () => {
    expect(
      isDueForDaemonTokenRotation(
        { ...base, createdAt: new Date(now - 10 * day) },
        now,
        30,
      ),
    ).toBe(false);
  });

  it('disables when interval is 0', () => {
    expect(isDueForDaemonTokenRotation(base, now, 0)).toBe(false);
  });
});
