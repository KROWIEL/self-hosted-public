export const ALERTS_QUEUE = 'ALERTS_QUEUE';
export const ALERTS_QUEUE_NAME = 'alerts';

/**
 * Monitored conditions an alert rule can subscribe to. Grouped by area for the
 * UI; every event here is actually evaluated by {@link AlertsEvaluator}. Keep
 * this list, {@link ALERT_EVENT_GROUPS} and the web i18n labels in sync.
 */
export const ALERT_EVENTS = [
  // Nodes
  'node.offline',
  'node.online',
  'node.cpu.high',
  'node.mem.high',
  'node.disk.high',
  // Deployments
  'deploy.failed',
  'deploy.succeeded',
  'deploy.stuck',
  // Services
  'service.error',
  'service.stopped',
  // Databases
  'database.error',
  'database.stopped',
  // Backups
  'backup.failed',
  'backup.succeeded',
  'offsite.failed',
  // Networking
  'tunnel.offline',
  'tunnel.online',
  // Licensing
  'license.expiring',
] as const;

export type AlertEventName = (typeof ALERT_EVENTS)[number];

/** Display grouping for the rule picker (labels are localized on the client). */
export const ALERT_EVENT_GROUPS: { group: string; events: AlertEventName[] }[] = [
  {
    group: 'nodes',
    events: ['node.offline', 'node.online', 'node.cpu.high', 'node.mem.high', 'node.disk.high'],
  },
  {
    group: 'deployments',
    events: ['deploy.failed', 'deploy.succeeded', 'deploy.stuck'],
  },
  { group: 'services', events: ['service.error', 'service.stopped'] },
  { group: 'databases', events: ['database.error', 'database.stopped'] },
  { group: 'backups', events: ['backup.failed', 'backup.succeeded', 'offsite.failed'] },
  { group: 'networking', events: ['tunnel.offline', 'tunnel.online'] },
  { group: 'licensing', events: ['license.expiring'] },
];

export type AlertsJobData = Record<string, never>;
