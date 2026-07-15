import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { NodesModule } from '../nodes/nodes.module';
import { createRedisConnection } from '../services/deploy.constants';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { MetricsCollector } from './metrics.collector';
import { METRICS_QUEUE, METRICS_QUEUE_NAME } from './metrics.constants';

@Module({
  imports: [NodesModule],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    MetricsCollector,
    {
      provide: METRICS_QUEUE,
      useFactory: () =>
        new Queue(METRICS_QUEUE_NAME, { connection: createRedisConnection() }),
    },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
