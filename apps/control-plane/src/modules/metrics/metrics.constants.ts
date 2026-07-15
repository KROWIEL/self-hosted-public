export const METRICS_QUEUE = 'METRICS_QUEUE';
export const METRICS_QUEUE_NAME = 'metrics';

export type MetricsJobData = Record<string, never>;

export interface MetricPoint {
  ts: string;
  cpuPct: number | null;
  memPct: number | null;
  diskPct: number | null;
}
