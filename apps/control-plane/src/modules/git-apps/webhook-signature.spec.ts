import { createHmac } from 'node:crypto';
import {
  verifyGithubSignature,
  verifyGitlabToken,
} from './webhook-signature';

describe('webhook-signature', () => {
  const secret = 'super-secret-webhook';
  const body = Buffer.from('{"action":"opened","number":1}', 'utf8');

  describe('verifyGithubSignature', () => {
    it('accepts a valid sha256 HMAC', () => {
      const sig =
        'sha256=' +
        createHmac('sha256', secret).update(body).digest('hex');
      expect(verifyGithubSignature(body, sig, secret)).toBe(true);
    });

    it('rejects a wrong secret', () => {
      const sig =
        'sha256=' +
        createHmac('sha256', secret).update(body).digest('hex');
      expect(verifyGithubSignature(body, sig, 'other')).toBe(false);
    });

    it('rejects a tampered body', () => {
      const sig =
        'sha256=' +
        createHmac('sha256', secret).update(body).digest('hex');
      expect(
        verifyGithubSignature(Buffer.from('{"action":"closed"}'), sig, secret),
      ).toBe(false);
    });

    it('rejects missing signature or secret', () => {
      expect(verifyGithubSignature(body, undefined, secret)).toBe(false);
      expect(verifyGithubSignature(body, 'sha256=abc', '')).toBe(false);
    });

    it('rejects malformed signature header', () => {
      expect(verifyGithubSignature(body, 'md5=deadbeef', secret)).toBe(false);
    });
  });

  describe('verifyGitlabToken', () => {
    it('accepts a matching token', () => {
      expect(verifyGitlabToken(secret, secret)).toBe(true);
    });

    it('rejects a wrong token', () => {
      expect(verifyGitlabToken('nope', secret)).toBe(false);
    });

    it('rejects missing token or secret', () => {
      expect(verifyGitlabToken(undefined, secret)).toBe(false);
      expect(verifyGitlabToken(secret, '')).toBe(false);
    });
  });
});
