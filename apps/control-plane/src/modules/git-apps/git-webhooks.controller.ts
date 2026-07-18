import {
  Controller,
  Headers,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  GIT_APP_PROVIDERS,
  GitAppProvider,
} from './dto/git-apps.dto';
import { GitWebhookService } from './git-webhook.service';

function parseProvider(raw: string): GitAppProvider {
  if ((GIT_APP_PROVIDERS as readonly string[]).includes(raw)) {
    return raw as GitAppProvider;
  }
  throw new NotFoundException(`Unknown git provider: ${raw}`);
}

/**
 * Public GitHub / GitLab webhooks for PR-triggered preview environments.
 * Authenticated by provider signature / token — no JWT.
 */
@Controller('webhooks/git')
export class GitWebhooksController {
  constructor(private readonly webhooks: GitWebhookService) {}

  @Post(':provider')
  handle(
    @Param('provider') providerRaw: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') githubSignature?: string,
    @Headers('x-gitlab-token') gitlabToken?: string,
    @Headers('x-github-event') githubEvent?: string,
    @Headers('x-gitlab-event') gitlabEvent?: string,
  ) {
    const provider = parseProvider(providerRaw);
    const raw = req.rawBody;
    if (!raw || !Buffer.isBuffer(raw)) {
      throw new UnauthorizedException(
        'Missing raw body for webhook signature verification',
      );
    }
    return this.webhooks.handle(provider, {
      rawBody: raw,
      body: req.body,
      githubSignature,
      gitlabToken,
      githubEvent,
      gitlabEvent,
    });
  }
}
