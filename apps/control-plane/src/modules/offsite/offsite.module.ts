import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { BackupsModule } from '../backups/backups.module';
import { createRedisConnection } from '../services/deploy.constants';
import { OffsiteController } from './offsite.controller';
import { OffsiteService } from './offsite.service';
import { OffsiteWorker } from './offsite.worker';
import { OFFSITE_QUEUE, OFFSITE_QUEUE_NAME } from './offsite.constants';

@Module({
  imports: [BackupsModule],
  controllers: [OffsiteController],
  providers: [
    OffsiteService,
    OffsiteWorker,
    {
      provide: OFFSITE_QUEUE,
      useFactory: () =>
        new Queue(OFFSITE_QUEUE_NAME, { connection: createRedisConnection() }),
    },
  ],
  exports: [OffsiteService],
})
export class OffsiteModule {}
