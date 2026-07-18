/** Prefix that marks a personal API token (distinguishes it from a JWT). */
export const API_TOKEN_PREFIX = 'shpat_';

/** Don't rewrite lastUsedAt more often than this (reduces write amplification). */
export const LAST_USED_THROTTLE_MS = 60_000;

/**
 * Coarse PAT authorization scopes (M4):
 *  - `read`  read-only: blocks mutating HTTP methods (POST/PUT/PATCH/DELETE).
 *  - `full`  read + write (supersedes `read`).
 *  - `admin` additionally required to reach platform-admin routes; only
 *            effective when the owning user is actually an ADMIN.
 */
export const API_TOKEN_SCOPES = ['read', 'full', 'admin'] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/** HTTP methods that mutate state — denied to `read`-only tokens. */
export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Parse the stored comma-separated scopes string into a clean set. */
export function parseScopes(raw: string | null | undefined): ApiTokenScope[] {
  if (!raw) return ['full'];
  const set = new Set<ApiTokenScope>();
  for (const part of raw.split(',')) {
    const s = part.trim();
    if ((API_TOKEN_SCOPES as readonly string[]).includes(s)) {
      set.add(s as ApiTokenScope);
    }
  }
  if (!set.has('read') && !set.has('full')) set.add('full');
  if (set.has('full')) set.delete('read');
  return [...set];
}

/**
 * Normalize a caller-supplied scope list into a canonical, validated set.
 * Throws the given `onInvalid` error for unknown scope values.
 */
export function normalizeScopes(
  input: string[] | undefined,
  onInvalid: (bad: string) => Error,
): ApiTokenScope[] {
  const set = new Set<ApiTokenScope>();
  for (const raw of input ?? []) {
    const s = String(raw).trim();
    if (!s) continue;
    if (!(API_TOKEN_SCOPES as readonly string[]).includes(s)) {
      throw onInvalid(s);
    }
    set.add(s as ApiTokenScope);
  }
  if (!set.has('read') && !set.has('full')) set.add('full');
  if (set.has('full')) set.delete('read');
  return [...set];
}
