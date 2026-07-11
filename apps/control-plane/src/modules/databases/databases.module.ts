import { Module } from '@nestjs/common';
import { NodesModule } from '../nodes/nodes.module';
import { ServicesModule } from '../services/services.module';
import { DatabasesController } from './databases.controller';
import { DatabasesService } from './databases.service';

@Module({
  imports: [NodesModule, ServicesModule],
  controllers: [DatabasesController],
  providers: [DatabasesService],
})
export class DatabasesModule {}
