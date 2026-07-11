import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { NodesModule } from '../nodes/nodes.module';
import { ServicesController } from './services.controller';
import { WebhooksController } from './webhooks.controller';
import { ServicesService } from './services.service';
import { DeployWorker } from './deploy.worker';
import { BuildLogService } from './build-log.service';
import {
  DEPLOY_QUEUE,
  DEPLOY_QUEUE_NAME,
  createRedisConnection,
} from './deploy.constants';

@Module({
  imports: [NodesModule],
  controllers: [ServicesController, WebhooksController],
  providers: [
    ServicesService,
    DeployWorker,
    BuildLogService,
    {
      provide: DEPLOY_QUEUE,
      useFactory: () =>
        new Queue(DEPLOY_QUEUE_NAME, { connection: createRedisConnection() }),
    },
  ],
  exports: [ServicesService],
})
export class ServicesModule {}
