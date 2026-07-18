import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { NodesModule } from '../nodes/nodes.module';
import { createRedisConnection } from '../services/deploy.constants';
import {
  SERVICE_CRON_QUEUE,
  SERVICE_CRON_QUEUE_NAME,
} from './service-cron.constants';
import { ServiceCronController } from './service-cron.controller';
import { ServiceCronScheduler } from './service-cron.scheduler';

@Module({
  imports: [NodesModule],
  controllers: [ServiceCronController],
  providers: [
    ServiceCronScheduler,
    {
      provide: SERVICE_CRON_QUEUE,
      useFactory: () =>
        new Queue(SERVICE_CRON_QUEUE_NAME, {
          connection: createRedisConnection(),
        }),
    },
  ],
})
export class ServiceCronModule {}
