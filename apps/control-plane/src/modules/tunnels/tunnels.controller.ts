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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ModuleGuard } from '../../common/licensing/module.guard';
import { RequiresModule } from '../../common/licensing/require-module.decorator';
import { TunnelsService } from './tunnels.service';
import { CreateTunnelDto, UpdateTunnelDto } from './dto/tunnel.dto';

// Reverse-tunnels is a paid add-on module (Home-Lab / Pro tiers).
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('reverse-tunnels')
@Controller('tunnels')
export class TunnelsController {
  constructor(private readonly tunnels: TunnelsService) {}

  @Get()
  list() {
    return this.tunnels.list();
  }

  @Post()
  create(@Body() dto: CreateTunnelDto) {
    return this.tunnels.create(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tunnels.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTunnelDto) {
    return this.tunnels.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tunnels.remove(id);
  }

  @Post(':id/start')
  start(@Param('id') id: string) {
    return this.tunnels.start(id);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string) {
    return this.tunnels.stop(id);
  }

  @Get(':id/status')
  status(@Param('id') id: string) {
    return this.tunnels.statusFor(id);
  }

  @Get(':id/install')
  install(@Param('id') id: string, @Req() req: Request) {
    return this.tunnels.install(id, this.origin(req));
  }

  private origin(req: Request): string {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    return `${proto}://${req.get('host')}`;
  }
}
