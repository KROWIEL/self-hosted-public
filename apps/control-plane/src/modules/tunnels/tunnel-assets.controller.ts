import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { TunnelsService } from './tunnels.service';

/**
 * Delivery of the relay binary + install scripts so a fresh VDS can fetch them
 * with a single curl/iwr — without a panel login. Access is gated by a
 * short-lived signed token (`?t=`) that the panel embeds into the install
 * command (see {@link TunnelsService.install}). This blocks anonymous access and
 * on-demand build abuse while keeping the copy-paste install flow. The per-tunnel
 * auth token that actually secures the relay is injected separately.
 *
 * Mounted under `tunnels/assets/*` (not `tunnels/*`) so the routes are not
 * shadowed by the licensed `TunnelsController`'s `:id` param route.
 */
@Controller('tunnels/assets')
export class TunnelAssetsController {
  constructor(private readonly tunnels: TunnelsService) {}

  @Get('bin/:platform')
  async bin(
    @Param('platform') platform: string,
    @Query('t') token: string,
    @Res() res: Response,
  ) {
    if (!this.tunnels.verifyAssetToken(token)) {
      res.status(403).send('forbidden');
      return;
    }
    let path: string;
    try {
      path = await this.tunnels.ensureServerBinary(platform);
    } catch (e) {
      res.status(400).send(e instanceof Error ? e.message : 'bad platform');
      return;
    }
    res.download(path, `tunnel-server-${platform}`);
  }

  @Get('install.sh')
  installSh(@Query('t') token: string, @Res() res: Response) {
    if (!this.tunnels.verifyAssetToken(token)) {
      res.status(403).send('forbidden');
      return;
    }
    this.sendScript(res, 'install.sh', 'text/x-shellscript');
  }

  @Get('install.ps1')
  installPs1(@Query('t') token: string, @Res() res: Response) {
    if (!this.tunnels.verifyAssetToken(token)) {
      res.status(403).send('forbidden');
      return;
    }
    this.sendScript(res, 'install.ps1', 'text/plain');
  }

  private sendScript(res: Response, name: string, contentType: string) {
    const path = resolve(process.cwd(), '../../services/tunnel-dist', name);
    if (!existsSync(path)) {
      res.status(404).send('not found');
      return;
    }
    res.setHeader('Content-Type', contentType);
    res.sendFile(path);
  }
}
