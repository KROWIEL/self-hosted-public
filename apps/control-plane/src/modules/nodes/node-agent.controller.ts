import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
} from '@nestjs/common';
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

  @Get('bin/:platform')
  async bin(@Param('platform') platform: string, @Res() res: Response) {
    let path: string;
    try {
      path = await this.nodes.ensureAgentBinary(platform);
    } catch (e) {
      res.status(400).send(e instanceof Error ? e.message : 'bad platform');
      return;
    }
    res.download(path, `selfhosted-agent-${platform}`);
  }

  @Get('install.sh')
  installSh(@Res() res: Response) {
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
