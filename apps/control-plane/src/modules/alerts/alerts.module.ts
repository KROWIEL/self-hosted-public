import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createRedisConnection } from '../services/deploy.constants';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertsEvaluator } from './alerts.evaluator';
import { ALERTS_QUEUE, ALERTS_QUEUE_NAME } from './alerts.constants';

@Module({
  controllers: [AlertsController],
  providers: [
    AlertsService,
    AlertsEvaluator,
    {
      provide: ALERTS_QUEUE,
      useFactory: () =>
        new Queue(ALERTS_QUEUE_NAME, { connection: createRedisConnection() }),
    },
  ],
  exports: [AlertsService],
})
export class AlertsModule {}
