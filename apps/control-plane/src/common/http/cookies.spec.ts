import {
  parseDurationMs,
  readCookie,
  safeStrEqual,
  newCsrfToken,
} from './cookies';

describe('cookies util', () => {
  describe('parseDurationMs', () => {
    it('falls back to the default when unset/blank', () => {
      expect(parseDurationMs(undefined, 123)).toBe(123);
      expect(parseDurationMs('', 123)).toBe(123);
    });

    it('parses bare integers as seconds', () => {
      expect(parseDurationMs('900', 0)).toBe(900_000);
    });

    it('parses common JWT-style durations', () => {
      expect(parseDurationMs('15m', 0)).toBe(15 * 60 * 1000);
      expect(parseDurationMs('7d', 0)).toBe(7 * 24 * 60 * 60 * 1000);
      expect(parseDurationMs('1h30m', 0)).toBe(90 * 60 * 1000);
    });

    it('falls back on garbage', () => {
      expect(parseDurationMs('not-a-duration', 42)).toBe(42);
    });
  });

  describe('readCookie', () => {
    it('returns undefined without a header', () => {
      expect(readCookie(undefined, 'x')).toBeUndefined();
    });

    it('reads a named cookie value (URL-decoded)', () => {
      const header = 'access_token=abc123; csrf=a%20b; other=1';
      expect(readCookie(header, 'access_token')).toBe('abc123');
      expect(readCookie(header, 'csrf')).toBe('a b');
      expect(readCookie(header, 'missing')).toBeUndefined();
    });
  });

  describe('safeStrEqual', () => {
    it('is false for missing values', () => {
      expect(safeStrEqual(undefined, 'x')).toBe(false);
      expect(safeStrEqual('x', undefined)).toBe(false);
      expect(safeStrEqual('', '')).toBe(false);
    });

    it('is false for differing lengths/values, true for equal', () => {
      expect(safeStrEqual('abc', 'abcd')).toBe(false);
      expect(safeStrEqual('abc', 'abd')).toBe(false);
      expect(safeStrEqual('abc', 'abc')).toBe(true);
    });
  });

  describe('newCsrfToken', () => {
    it('returns a non-trivial, unique, url-safe token', () => {
      const a = newCsrfToken();
      const b = newCsrfToken();
      expect(a).not.toBe(b);
      expect(a.length).toBeGreaterThanOrEqual(24);
      expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });
});
