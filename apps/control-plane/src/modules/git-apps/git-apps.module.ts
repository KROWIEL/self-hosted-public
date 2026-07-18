import { Module } from '@nestjs/common';
import { PreviewModule } from '../preview/preview.module';
import { GitAppsController } from './git-apps.controller';
import { GitAppsService } from './git-apps.service';
import { GitWebhookService } from './git-webhook.service';
import { GitWebhooksController } from './git-webhooks.controller';

@Module({
  imports: [PreviewModule],
  controllers: [GitAppsController, GitWebhooksController],
  providers: [GitAppsService, GitWebhookService],
  exports: [GitAppsService],
})
export class GitAppsModule {}
