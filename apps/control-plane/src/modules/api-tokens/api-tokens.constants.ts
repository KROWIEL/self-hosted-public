/** Prefix that marks a personal API token (distinguishes it from a JWT). */
export const API_TOKEN_PREFIX = 'shpat_';

/** Don't rewrite lastUsedAt more often than this (reduces write amplification). */
export const LAST_USED_THROTTLE_MS = 60_000;
