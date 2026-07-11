import { Controller, Param, Post } from '@nestjs/common';
import { ServicesService } from './services.service';

/**
 * Public, unauthenticated auto-deploy hook. Access is gated by a per-service
 * HMAC token embedded in the URL, so this controller intentionally has NO JWT
 * guard. Point a Git provider's push webhook at POST /webhooks/services/:id/:token.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly services: ServicesService) {}

  @Post('services/:id/:token')
  hook(@Param('id') id: string, @Param('token') token: string) {
    return this.services.deployViaWebhook(id, token);
  }
}
