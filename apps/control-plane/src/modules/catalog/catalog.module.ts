import { Module } from '@nestjs/common';
import { MembersModule } from '../members/members.module';
import { ServicesModule } from '../services/services.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [ServicesModule, MembersModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
