import { randomBytes } from 'node:crypto';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY = originalKey;
  });

  it('round-trips plaintext through encrypt/decrypt', () => {
    const svc = new CryptoService();
    const enc = svc.encrypt('hunter2');
    expect(enc).not.toContain('hunter2');
    expect(svc.decrypt(enc)).toBe('hunter2');
  });

  it('uses a fresh IV so ciphertext differs per call', () => {
    const svc = new CryptoService();
    expect(svc.encrypt('same')).not.toBe(svc.encrypt('same'));
  });

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    const svc = new CryptoService();
    const buf = Buffer.from(svc.encrypt('secret'), 'base64');
    buf[buf.length - 1] ^= 0xff;
    expect(() => svc.decrypt(buf.toString('base64'))).toThrow();
  });

  it('throws when ENCRYPTION_KEY is not 32 bytes', () => {
    const prev = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
    expect(() => new CryptoService()).toThrow();
    process.env.ENCRYPTION_KEY = prev;
  });
});
