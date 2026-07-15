import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ServicesModule } from '../services/services.module';
import { createRedisConnection } from '../services/deploy.constants';
import { PreviewController } from './preview.controller';
import { PreviewService } from './preview.service';
import { PreviewWorker } from './preview.worker';
import { PREVIEW_QUEUE, PREVIEW_QUEUE_NAME } from './preview.constants';

@Module({
  imports: [ServicesModule],
  controllers: [PreviewController],
  providers: [
    PreviewService,
    PreviewWorker,
    {
      provide: PREVIEW_QUEUE,
      useFactory: () =>
        new Queue(PREVIEW_QUEUE_NAME, { connection: createRedisConnection() }),
    },
  ],
  exports: [PreviewService],
})
export class PreviewModule {}
