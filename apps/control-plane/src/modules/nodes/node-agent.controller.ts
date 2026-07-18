import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import {
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { NodesService } from './nodes.service';

class EnrollDto {
  @IsString()
  @MinLength(1)
  joinToken: string;

  @IsString()
  @MinLength(1)
  fingerprint: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsInt()
  agentPort?: number;
}

class HeartbeatDto {
  @IsString()
  @MinLength(1)
  nodeId: string;

  @IsOptional()
  @IsString()
  version?: string;
}

/**
 * Public (unauthenticated) surface used by remote agents to bootstrap and to
 * fetch install artifacts. Enrollment is gated by a one-time join token;
 * heartbeats are authorized by the agent's provisioned daemon token.
 */
@Controller('node-agent')
export class NodeAgentController {
  constructor(private readonly nodes: NodesService) {}

  @Post('enroll')
  enroll(@Body() dto: EnrollDto) {
    return this.nodes.enroll(dto);
  }

  @Post('heartbeat')
  heartbeat(
    @Body() dto: HeartbeatDto,
    @Headers('authorization') auth?: string,
  ) {
    const token = (auth ?? '').replace(/^Bearer\s+/i, '');
    return this.nodes.heartbeat(dto.nodeId, token, dto.version);
  }

  // Anonymous artifact delivery: gated by a short-lived, single-use (per path)
  // signed token (`?t=`) the panel embeds in the install command, plus a strict
  // rate limit as defense-in-depth against on-demand build abuse (L3/L9).
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('bin/:platform')
  async bin(
    @Param('platform') platform: string,
    @Query('t') token: string,
    @Res() res: Response,
  ) {
    if (!(await this.nodes.consumeAssetToken(token, `bin/${platform}`))) {
      res.status(403).send('forbidden');
      return;
    }
    let path: string;
    try {
      path = await this.nodes.ensureAgentBinary(platform);
    } catch (e) {
      res.status(400).send(e instanceof Error ? e.message : 'bad platform');
      return;
    }
    res.download(path, `selfhosted-agent-${platform}`);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('install.sh')
  async installSh(@Query('t') token: string, @Res() res: Response) {
    if (!(await this.nodes.consumeAssetToken(token, 'install.sh'))) {
      res.status(403).send('forbidden');
      return;
    }
    const path = resolve(
      process.cwd(),
      '../../services/agent-dist',
      'install.sh',
    );
    if (!existsSync(path)) {
      res.status(404).send('not found');
      return;
    }
    res.setHeader('Content-Type', 'text/x-shellscript');
    res.sendFile(path);
  }
}
