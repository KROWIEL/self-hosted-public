import {
  assertRequestUrlAllowed,
  isDisallowedAddress,
  SsrfBlockedError,
} from './ssrf-guard';

describe('isDisallowedAddress', () => {
  it('blocks IPv4 loopback / private / link-local / metadata / unspecified', () => {
    for (const ip of [
      '127.0.0.1',
      '127.9.9.9',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.0.1',
      '169.254.169.254', // cloud metadata
      '0.0.0.0',
    ]) {
      expect(isDisallowedAddress(ip)).toBe(true);
    }
  });

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '140.82.121.3', '172.15.0.1', '172.32.0.1']) {
      expect(isDisallowedAddress(ip)).toBe(false);
    }
  });

  it('blocks IPv6 loopback / ULA / link-local / unspecified / mapped-private', () => {
    for (const ip of [
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:127.0.0.1', // IPv4-mapped loopback
      '::ffff:10.0.0.1', // IPv4-mapped private
    ]) {
      expect(isDisallowedAddress(ip)).toBe(true);
    }
  });

  it('allows public IPv6', () => {
    expect(isDisallowedAddress('2606:4700:4700::1111')).toBe(false);
    expect(isDisallowedAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('treats non-IP strings as not-an-IP (defers to DNS)', () => {
    expect(isDisallowedAddress('github.com')).toBe(false);
  });
});

describe('assertRequestUrlAllowed', () => {
  it('rejects a host not in the allowlist before any DNS/network call', async () => {
    await expect(
      assertRequestUrlAllowed('https://evil.example.com/x.git', ['github.com']),
    ).rejects.toMatchObject({ code: 'net.hostNotAllowed' });
  });

  it('rejects a non-http(s) scheme', async () => {
    await expect(
      assertRequestUrlAllowed('ftp://github.com/x', ['github.com']),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rejects a malformed URL', async () => {
    await expect(
      assertRequestUrlAllowed('not a url', ['github.com']),
    ).rejects.toMatchObject({ code: 'net.invalidUrl' });
  });

  it('rejects an allowlisted IP-literal host in a private range (no DNS)', async () => {
    // Host is allowlisted but is itself a loopback literal → blocked by the
    // private-IP denylist without any network call.
    await expect(
      assertRequestUrlAllowed('https://127.0.0.1/x.git', ['127.0.0.1']),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rejects the cloud metadata endpoint even when allowlisted (no DNS)', async () => {
    await expect(
      assertRequestUrlAllowed('http://169.254.169.254/latest/meta-data', [
        '169.254.169.254',
      ]),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});
