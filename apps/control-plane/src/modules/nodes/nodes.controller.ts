import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NodesService } from './nodes.service';
import { AgentRunnerService } from './agent-runner.service';

class CreateNodeDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  fqdn: string;

  @IsOptional()
  @IsInt()
  agentPort?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  cpuTotal?: number;

  @IsOptional()
  @IsInt()
  @Min(16)
  memTotal?: number;
}

class CreateRemoteNodeDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  fqdn: string;

  @IsOptional()
  @IsInt()
  agentPort?: number;
}

class UpdateNodeCapacityDto {
  @IsInt()
  @Min(1)
  cpuTotal: number;

  @IsInt()
  @Min(16)
  memTotal: number;
}

class PruneNodeDto {
  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @IsOptional()
  @IsBoolean()
  volumes?: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('nodes')
export class NodesController {
  constructor(
    private readonly nodes: NodesService,
    private readonly runner: AgentRunnerService,
  ) {}

  @Get()
  list() {
    return this.nodes.list();
  }

  @Post()
  create(@Body() dto: CreateNodeDto) {
    return this.nodes.create(dto);
  }

  /** Register a remote node (agent installed on another server). */
  @Post('remote')
  createRemote(@Body() dto: CreateRemoteNodeDto) {
    return this.nodes.createRemote(dto);
  }

  /** One-time join token + ready-to-paste install command for a remote node. */
  @Get(':id/install')
  install(@Param('id') id: string, @Req() req: Request) {
    return this.nodes.installInfo(id, this.origin(req));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.nodes.get(id);
  }

  @Patch(':id/capacity')
  updateCapacity(@Param('id') id: string, @Body() dto: UpdateNodeCapacityDto) {
    return this.nodes.updateCapacity(id, dto);
  }

  /** Configuration the agent fetches on boot. */
  @Get(':id/configuration')
  configuration(@Param('id') id: string) {
    return this.nodes.configuration(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.runner.stop(id);
    return this.nodes.remove(id);
  }

  /** Dev: launch the local Go agent for this node (LOCAL_AGENT_ENABLED=1). */
  @Post(':id/agent/start')
  async startAgent(@Param('id') id: string) {
    const node = await this.nodes.get(id);
    return this.runner.start(node);
  }

  @Post(':id/agent/stop')
  stopAgent(@Param('id') id: string) {
    return this.runner.stop(id);
  }

  @Get(':id/agent/status')
  agentStatus(@Param('id') id: string) {
    return this.runner.status(id);
  }

  /** Live Docker-level metrics from the node's agent. */
  @Get(':id/system')
  system(@Param('id') id: string) {
    return this.nodes.systemInfo(id);
  }

  /** Aggregate live CPU/RAM usage across all containers on the node. */
  @Get(':id/stats')
  stats(@Param('id') id: string) {
    return this.nodes.stats(id);
  }

  /** OS-level host metrics (CPU load, RAM, disk). */
  @Get(':id/host')
  host(@Param('id') id: string) {
    return this.nodes.host(id);
  }

  /** Reclaim disk on the node (docker prune). */
  @Post(':id/prune')
  prune(@Param('id') id: string, @Body() dto: PruneNodeDto) {
    return this.nodes.prune(id, { all: dto.all, volumes: dto.volumes });
  }

  /** Services + managed databases hosted on this node. */
  @Get(':id/workloads')
  workloads(@Param('id') id: string) {
    return this.nodes.workloads(id);
  }

  private origin(req: Request): string {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    return `${proto}://${req.get('host')}`;
  }
}
