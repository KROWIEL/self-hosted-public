export const SERVICE_CRON_QUEUE = 'SERVICE_CRON_QUEUE';
export const SERVICE_CRON_QUEUE_NAME = 'service-crons';

export interface ServiceCronJobData {
  cronId: string;
}

/** Truncate agent output before persisting on the cron row. */
export const SERVICE_CRON_OUTPUT_MAX = 16_384;
