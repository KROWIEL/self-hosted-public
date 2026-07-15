import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ModuleGuard } from '../../common/licensing/module.guard';
import { RequiresModule } from '../../common/licensing/require-module.decorator';
import { AlertsService } from './alerts.service';
import { ALERT_EVENTS, ALERT_EVENT_GROUPS } from './alerts.constants';
import {
  CreateChannelDto,
  CreateRuleDto,
  UpdateChannelDto,
  UpdateRuleDto,
} from './dto/alerts.dto';

/**
 * Alerting configuration (Pro: alerts). Platform-level, so restricted to global
 * admins; the whole controller is gated behind the `alerts` module.
 */
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  private assertAdmin(req: { user?: { role?: string } }) {
    if (req.user?.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  }

  @Get('meta')
  meta(@Request() req: { user?: { role?: string } }) {
    this.assertAdmin(req);
    return { events: ALERT_EVENTS, groups: ALERT_EVENT_GROUPS };
  }

  @Get('events')
  listEvents(@Request() req: { user?: { role?: string } }) {
    this.assertAdmin(req);
    return this.alerts.listEvents();
  }

  @Get('channels')
  listChannels(@Request() req: { user?: { role?: string } }) {
    this.assertAdmin(req);
    return this.alerts.listChannels();
  }

  @Post('channels')
  createChannel(
    @Request() req: { user?: { role?: string } },
    @Body() dto: CreateChannelDto,
  ) {
    this.assertAdmin(req);
    return this.alerts.createChannel(dto);
  }

  @Patch('channels/:id')
  updateChannel(
    @Request() req: { user?: { role?: string } },
    @Param('id') id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    this.assertAdmin(req);
    return this.alerts.updateChannel(id, dto);
  }

  @Delete('channels/:id')
  deleteChannel(
    @Request() req: { user?: { role?: string } },
    @Param('id') id: string,
  ) {
    this.assertAdmin(req);
    return this.alerts.deleteChannel(id);
  }

  @Post('channels/:id/test')
  testChannel(
    @Request() req: { user?: { role?: string } },
    @Param('id') id: string,
  ) {
    this.assertAdmin(req);
    return this.alerts.testChannel(id);
  }

  @Get('rules')
  listRules(@Request() req: { user?: { role?: string } }) {
    this.assertAdmin(req);
    return this.alerts.listRules();
  }

  @Post('rules')
  createRule(
    @Request() req: { user?: { role?: string } },
    @Body() dto: CreateRuleDto,
  ) {
    this.assertAdmin(req);
    return this.alerts.createRule(dto);
  }

  @Patch('rules/:id')
  updateRule(
    @Request() req: { user?: { role?: string } },
    @Param('id') id: string,
    @Body() dto: UpdateRuleDto,
  ) {
    this.assertAdmin(req);
    return this.alerts.updateRule(id, dto);
  }

  @Delete('rules/:id')
  deleteRule(
    @Request() req: { user?: { role?: string } },
    @Param('id') id: string,
  ) {
    this.assertAdmin(req);
    return this.alerts.deleteRule(id);
  }
}
