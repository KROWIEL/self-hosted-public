/**
 * Commercial licensing / feature-gating contracts shared by the control-plane
 * (which verifies license keys and enforces module access) and the web app
 * (which hides or unlocks UI based on the current entitlements).
 *
 * The model is intentionally simple and offline-verifiable: the whole
 * installation carries a single signed license (Ed25519). No license = the
 * generous Free core. A license upgrades the instance to Home-Lab or Pro and
 * may unlock individual add-on modules.
 */

/** Commercial tiers. `free` is the default when no valid license is present. */
export type LicenseTier = 'free' | 'homelab' | 'pro';

/**
 * Individually gateable add-on modules. A tier grants a set of these (see
 * {@link TIER_MODULES}); a license may also grant extra modules à la carte.
 */
export type LicenseModule =
  | 'reverse-tunnels'
  | 'preview-envs'
  | 'offsite-backups'
  | 'alerts'
  | 'metrics-history'
  | 'sso'
  | 'audit-export'
  | 'api-cli'
  | 'white-label';

/** Every known module, ordered for display. */
export const ALL_MODULES: LicenseModule[] = [
  'reverse-tunnels',
  'preview-envs',
  'offsite-backups',
  'alerts',
  'metrics-history',
  'sso',
  'audit-export',
  'api-cli',
  'white-label',
];

/** Modules automatically granted by each tier. */
export const TIER_MODULES: Record<LicenseTier, LicenseModule[]> = {
  free: [],
  homelab: ['reverse-tunnels'],
  pro: [...ALL_MODULES],
};

/**
 * Per-tier quantitative caps. `null` means unlimited. Enforced server-side on
 * resource creation; surfaced in {@link Entitlements.limits} so the UI can warn
 * and disable "add" actions before the request is rejected.
 */
export interface TierLimits {
  /** Max number of nodes that can exist. `null` = unlimited. */
  maxNodes: number | null;
  /** Max number of reverse tunnels that can exist. `null` = unlimited. */
  maxTunnels: number | null;
}

/** Quantitative caps per tier. Free is single-node; Home-Lab is capped; Pro is open. */
export const TIER_LIMITS: Record<LicenseTier, TierLimits> = {
  free: { maxNodes: 1, maxTunnels: 0 },
  homelab: { maxNodes: 3, maxTunnels: 3 },
  pro: { maxNodes: null, maxTunnels: null },
};

/** The caps for a given tier (falls back to the Free caps for unknown tiers). */
export function limitsForTier(tier: LicenseTier): TierLimits {
  return TIER_LIMITS[tier] ?? TIER_LIMITS.free;
}

/** Human-friendly tier order (low → high) for comparisons and upgrade hints. */
export const TIER_RANK: Record<LicenseTier, number> = {
  free: 0,
  homelab: 1,
  pro: 2,
};

/** The lowest tier that grants a given module (for "upgrade to X" prompts). */
export function minTierFor(module: LicenseModule): LicenseTier {
  const tiers: LicenseTier[] = ['free', 'homelab', 'pro'];
  for (const tier of tiers) {
    if (TIER_MODULES[tier].includes(module)) return tier;
  }
  return 'pro';
}

/**
 * The signed payload embedded in a license key. Serialized to JSON, base64url
 * encoded, and appended with an Ed25519 signature: `base64url(json).base64url(sig)`.
 */
export interface LicensePayload {
  /** Schema version. */
  v: number;
  /** Granted tier. */
  tier: LicenseTier;
  /** Extra modules granted beyond the tier (rare; usually empty). */
  modules?: LicenseModule[];
  /** Customer identifier (email or order id) — informational. */
  sub?: string;
  /** Customer / organization display name — informational. */
  name?: string;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Expiry, unix seconds. `0` = perpetual (never expires). */
  exp: number;
}

/**
 * Online-activation status. When the deployment is configured with an
 * activation server (`LICENSE_ACTIVATION_URL`), paid modules require a recent
 * successful heartbeat; otherwise the instance runs in offline / key-only mode.
 */
export interface ActivationStatus {
  /** True when an activation server is configured (online enforcement on). */
  required: boolean;
  /** True when the last heartbeat succeeded and is still fresh. */
  ok: boolean;
  /** Unix seconds of the last successful heartbeat, or null. */
  lastCheckAt: number | null;
  /** Machine-readable reason when `ok` is false (e.g. `stale`, `revoked`). */
  reason?: string;
}

/**
 * The effective, resolved entitlements for the instance. Computed from a
 * verified license (or the Free defaults) and surfaced to the frontend.
 */
export interface Entitlements {
  tier: LicenseTier;
  /** All modules currently unlocked (tier modules ∪ extra modules). */
  modules: LicenseModule[];
  /** Quantitative caps for the active tier (nodes, tunnels, …). */
  limits: TierLimits;
  /** Expiry as unix seconds, or `null` for perpetual / Free. */
  expiresAt: number | null;
  /** Whether a valid, non-expired paid license is active. */
  licensed: boolean;
  /** Customer identifier from the license, if any. */
  subject?: string;
  /** Customer / organization name from the license, if any. */
  name?: string;
  /** Online-activation status (present when relevant). */
  activation?: ActivationStatus;
}

/** The entitlements applied when no license (or an invalid one) is present. */
export const FREE_ENTITLEMENTS: Entitlements = {
  tier: 'free',
  modules: [],
  limits: TIER_LIMITS.free,
  expiresAt: null,
  licensed: false,
};

/** Convenience: does an entitlements object grant a given module? */
export function hasModule(ent: Entitlements, module: LicenseModule): boolean {
  return ent.modules.includes(module);
}
