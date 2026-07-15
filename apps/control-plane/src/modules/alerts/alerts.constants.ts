export const ALERTS_QUEUE = 'ALERTS_QUEUE';
export const ALERTS_QUEUE_NAME = 'alerts';

/** Monitored conditions an alert rule can subscribe to. */
export const ALERT_EVENTS = [
  'node.offline',
  'deploy.failed',
  'backup.failed',
] as const;

export type AlertEventName = (typeof ALERT_EVENTS)[number];

export type AlertsJobData = Record<string, never>;
