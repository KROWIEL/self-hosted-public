import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ModuleGuard } from '../../common/licensing/module.guard';
import { RequiresModule } from '../../common/licensing/require-module.decorator';
import { MetricsService } from './metrics.service';

@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('metrics-history')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('nodes/:id')
  series(@Param('id') id: string, @Query('hours') hours?: string) {
    const h = Math.min(Math.max(Number(hours) || 24, 1), 24 * 90);
    return this.metrics.series(id, h * 60 * 60 * 1000);
  }
}
