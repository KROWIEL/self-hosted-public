export const DAEMON_TOKEN_ROTATION_QUEUE = 'DAEMON_TOKEN_ROTATION_QUEUE';
export const DAEMON_TOKEN_ROTATION_QUEUE_NAME = 'daemon-token-rotation';

export type DaemonTokenRotationJobData = Record<string, never>;

/** How often the scheduler wakes to look for due nodes (default 1h). */
export const DAEMON_TOKEN_ROTATION_CHECK_MS = 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

/**
 * Parse `DAEMON_TOKEN_ROTATION_DAYS`. Default 30. `0` (or negative after
 * flooring) disables auto-rotation. Non-numeric values fall back to default.
 */
export function parseDaemonTokenRotationDays(
  raw: string | undefined,
  fallback = 30,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

export type RotationCandidate = {
  status: string;
  daemonTokenPrev: string | null;
  daemonTokenRotatedAt: Date | null;
  createdAt: Date;
};

/**
 * Whether a node should receive a scheduled daemon-token rotation.
 * Skips offline nodes, nodes already mid-rotation (`daemonTokenPrev` set),
 * and nodes rotated (or created) more recently than `intervalDays`.
 */
export function isDueForDaemonTokenRotation(
  node: RotationCandidate,
  nowMs: number,
  intervalDays: number,
): boolean {
  if (intervalDays <= 0) return false;
  if (node.status !== 'ONLINE') return false;
  if (node.daemonTokenPrev) return false;
  const baseline = node.daemonTokenRotatedAt ?? node.createdAt;
  return nowMs - baseline.getTime() >= intervalDays * DAY_MS;
}
