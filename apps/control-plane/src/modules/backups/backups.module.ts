import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { NodesModule } from '../nodes/nodes.module';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { BackupScheduler } from './backup.scheduler';
import { BACKUP_QUEUE, BACKUP_QUEUE_NAME } from './backup.constants';
import { createRedisConnection } from '../services/deploy.constants';

@Module({
  imports: [NodesModule],
  controllers: [BackupsController],
  providers: [
    BackupsService,
    BackupScheduler,
    {
      provide: BACKUP_QUEUE,
      useFactory: () =>
        new Queue(BACKUP_QUEUE_NAME, { connection: createRedisConnection() }),
    },
  ],
  exports: [BackupsService],
})
export class BackupsModule {}
