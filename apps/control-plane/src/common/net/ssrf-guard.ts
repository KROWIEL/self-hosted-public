import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Reusable SSRF guard: rejects hostnames/URLs that point at loopback, private,
 * link-local, unique-local, unspecified or cloud-metadata addresses.
 *
 * It resolves the target host (DNS) and rejects if the host itself, or ANY of
 * the resolved A/AAAA records, falls inside a non-public range. This is a
 * best-effort defence against exfiltration/SSRF via a caller-supplied URL; it
 * does not fully close the DNS-rebinding TOCTOU window (the subsequent client
 * does its own resolution), but it blocks the common attack shapes.
 */
export class SsrfBlockedError extends Error {
  readonly code: string;
  constructor(message: string, code = 'net.ssrfBlocked') {
    super(message);
    this.name = 'SsrfBlockedError';
    this.code = code;
  }
}

/** Parses an IPv4 dotted-quad into its four octets, or null if malformed. */
function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    out.push(n);
  }
  return out;
}

/**
 * True if a 4-byte IPv4 address is in a range that must never be reached from a
 * server-side request: loopback, RFC-1918 private, link-local (incl. the cloud
 * metadata endpoint 169.254.169.254) and the "this host"/unspecified block.
 */
function isDisallowedIpv4Bytes(b: number[]): boolean {
  const [a, second] = b;
  if (a === 0) return true; // 0.0.0.0/8 (incl. 0.0.0.0 "this network")
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && second >= 16 && second <= 31) return true; // 172.16.0.0/12
  if (a === 192 && second === 168) return true; // 192.168.0.0/16
  if (a === 169 && second === 254) return true; // 169.254.0.0/16 link-local + metadata
  return false;
}

function isDisallowedIpv4(ip: string): boolean {
  const b = parseIpv4(ip);
  if (!b) return true; // fail closed on anything we cannot parse
  return isDisallowedIpv4Bytes(b);
}

/** Expands an IPv6 literal (already validated by net.isIP) into 16 bytes. */
function expandIpv6(ip: string): number[] | null {
  let str = ip;
  const zone = str.indexOf('%');
  if (zone !== -1) str = str.slice(0, zone); // strip scope id (fe80::1%eth0)

  const halves = str.split('::');
  if (halves.length > 2) return null;

  const toHextets = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    const groups = part.split(':');
    for (const g of groups) {
      if (g.includes('.')) {
        // Embedded IPv4 tail (e.g. ::ffff:1.2.3.4).
        const v4 = parseIpv4(g);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1]);
        out.push((v4[2] << 8) | v4[3]);
      } else {
        if (g.length === 0 || g.length > 4 || !/^[0-9a-fA-F]+$/.test(g)) {
          return null;
        }
        out.push(parseInt(g, 16));
      }
    }
    return out;
  };

  const head = toHextets(halves[0]);
  const tail = halves.length === 2 ? toHextets(halves[1]) : [];
  if (head === null || tail === null) return null;

  let full: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    full = [...head, ...new Array(missing).fill(0), ...tail];
  } else {
    full = head;
  }
  if (full.length !== 8) return null;

  const bytes: number[] = [];
  for (const h of full) bytes.push((h >> 8) & 0xff, h & 0xff);
  return bytes;
}

function isDisallowedIpv6(ip: string): boolean {
  const b = expandIpv6(ip);
  if (!b) return true; // fail closed
  if (b.every((x) => x === 0)) return true; // :: unspecified
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true; // ::1 loopback
  // IPv4-mapped (::ffff:0:0/96) → evaluate the embedded IPv4.
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
    return isDisallowedIpv4Bytes([b[12], b[13], b[14], b[15]]);
  }
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  return false;
}

/** True if an IP literal is loopback/private/link-local/ULA/unspecified. */
export function isDisallowedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isDisallowedIpv4(ip);
  if (kind === 6) return isDisallowedIpv6(ip);
  return false; // not an IP literal — caller must resolve first
}

/**
 * Resolves `hostname` and throws SsrfBlockedError if the host (or any resolved
 * address) is non-public. IP literals are checked directly without DNS.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.trim().toLowerCase();
  if (!host) {
    throw new SsrfBlockedError('Empty host', 'net.ssrfBlocked');
  }

  if (isIP(host)) {
    if (isDisallowedAddress(host)) {
      throw new SsrfBlockedError(`Blocked non-public address: ${host}`);
    }
    return;
  }

  // Common local aliases that may resolve to 127.0.0.1 via /etc/hosts.
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new SsrfBlockedError(`Blocked local hostname: ${host}`);
  }

  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new SsrfBlockedError(`Could not resolve host: ${host}`, 'net.dnsFailed');
  }
  if (!addrs.length) {
    throw new SsrfBlockedError(`Host did not resolve: ${host}`);
  }
  for (const a of addrs) {
    if (isDisallowedAddress(a.address)) {
      throw new SsrfBlockedError(
        `Host ${host} resolves to a non-public address (${a.address})`,
      );
    }
  }
}

/**
 * Validates that `rawUrl` is an http(s) URL whose host is in `allowedHosts`
 * (exact, case-insensitive) AND resolves to a public address. Returns the
 * parsed URL on success; throws SsrfBlockedError otherwise.
 */
export async function assertRequestUrlAllowed(
  rawUrl: string,
  allowedHosts: string[],
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('A valid URL is required', 'net.invalidUrl');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SsrfBlockedError(
      'Only http(s) URLs are allowed',
      'net.invalidScheme',
    );
  }
  const host = url.hostname.toLowerCase();
  const allowed = allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(host)) {
    throw new SsrfBlockedError(
      `Host "${host}" is not allowed for this credential (expected: ${allowed.join(', ')})`,
      'net.hostNotAllowed',
    );
  }
  await assertPublicHost(host);
  return url;
}
