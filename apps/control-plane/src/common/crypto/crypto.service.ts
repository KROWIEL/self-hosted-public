import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for secrets at rest (PATs, env secrets, daemon tokens).
 * The master key comes from ENCRYPTION_KEY (32 bytes, base64-encoded).
 *
 * Stored format: base64( iv[12] || authTag[16] || ciphertext )
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    const raw = process.env.ENCRYPTION_KEY ?? '';
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new InternalServerErrorException(
        'ENCRYPTION_KEY must be 32 bytes, base64-encoded (run: openssl rand -base64 32)',
      );
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
      'utf8',
    );
  }
}
