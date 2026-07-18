import { createHmac } from 'node:crypto';
import {
  AGENT_REQUEST_TOKEN_TTL_MS,
  agentSupportsSignedTokens,
  signAgentRequestToken,
} from './agent-token';

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
}

describe('signAgentRequestToken', () => {
  const secret = 'shared-secret-abc123';
  const nodeId = 'node-uuid-1';

  it('mints a well-formed HS256 JWT (header/payload/sig)', () => {
    const token = signAgentRequestToken(secret, nodeId);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    const header = decodeSegment(parts[0]);
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });

    const payload = decodeSegment(parts[1]);
    expect(payload.iss).toBe('selfhosted-cp');
    expect(payload.aud).toBe(nodeId);
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect((payload.exp as number) - (payload.iat as number)).toBe(
      Math.ceil(AGENT_REQUEST_TOKEN_TTL_MS / 1000),
    );
  });

  it('produces a signature verifiable with the shared secret (UTF-8 bytes)', () => {
    const token = signAgentRequestToken(secret, nodeId);
    const [h, p, sig] = token.split('.');
    const expected = createHmac('sha256', Buffer.from(secret, 'utf8'))
      .update(`${h}.${p}`)
      .digest('base64url');
    expect(sig).toBe(expected);
  });

  it('binds the token to the node via the audience claim', () => {
    const payload = decodeSegment(signAgentRequestToken(secret, 'other').split('.')[1]);
    expect(payload.aud).toBe('other');
  });

  it('sets a short, honored TTL', () => {
    const before = Math.floor(Date.now() / 1000);
    const payload = decodeSegment(signAgentRequestToken(secret, nodeId, 30_000).split('.')[1]);
    expect((payload.exp as number) - (payload.iat as number)).toBe(30);
    expect(payload.iat as number).toBeGreaterThanOrEqual(before);
  });
});

describe('agentSupportsSignedTokens', () => {
  it('accepts the minimum version and above', () => {
    expect(agentSupportsSignedTokens('0.3.0')).toBe(true);
    expect(agentSupportsSignedTokens('0.3.1')).toBe(true);
    expect(agentSupportsSignedTokens('0.4.0')).toBe(true);
    expect(agentSupportsSignedTokens('1.0.0')).toBe(true);
    expect(agentSupportsSignedTokens('v0.3.0')).toBe(true);
  });

  it('rejects older versions (back-compat: send raw token)', () => {
    expect(agentSupportsSignedTokens('0.2.0')).toBe(false);
    expect(agentSupportsSignedTokens('0.2.9')).toBe(false);
    expect(agentSupportsSignedTokens('0.1.5')).toBe(false);
  });

  it('rejects unknown/unparseable versions conservatively', () => {
    expect(agentSupportsSignedTokens(null)).toBe(false);
    expect(agentSupportsSignedTokens(undefined)).toBe(false);
    expect(agentSupportsSignedTokens('')).toBe(false);
    expect(agentSupportsSignedTokens('dev')).toBe(false);
  });
});
