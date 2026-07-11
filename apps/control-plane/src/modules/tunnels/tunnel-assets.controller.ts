import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { TunnelsService } from './tunnels.service';

/**
 * Public (unauthenticated) delivery of the relay binary + install scripts so a
 * fresh VDS can fetch them with a single curl/iwr. These artifacts are not
 * sensitive — the auth token is injected separately via the install command.
 */
@Controller('tunnels')
export class TunnelAssetsController {
  constructor(private readonly tunnels: TunnelsService) {}

  @Get('bin/:platform')
  async bin(@Param('platform') platform: string, @Res() res: Response) {
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
  installSh(@Res() res: Response) {
    this.sendScript(res, 'install.sh', 'text/x-shellscript');
  }

  @Get('install.ps1')
  installPs1(@Res() res: Response) {
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
