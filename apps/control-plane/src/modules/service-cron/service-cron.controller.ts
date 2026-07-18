import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MemberRole } from '@selfhosted/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ModuleGuard } from '../../common/licensing/module.guard';
import { RequiresModule } from '../../common/licensing/require-module.decorator';
import { ProjectRole } from '../../common/rbac/project-role.decorator';
import { ProjectRolesGuard } from '../../common/rbac/project-roles.guard';
import {
  CreateServiceCronDto,
  UpdateServiceCronDto,
} from './dto/service-cron.dto';
import { ServiceCronScheduler } from './service-cron.scheduler';

@UseGuards(JwtAuthGuard, ProjectRolesGuard, ModuleGuard)
@RequiresModule('service-cron')
@Controller('services/:serviceId/crons')
export class ServiceCronController {
  constructor(private readonly scheduler: ServiceCronScheduler) {}

  @Get()
  @ProjectRole(MemberRole.VIEWER, 'service', 'serviceId')
  list(@Param('serviceId') serviceId: string) {
    return this.scheduler.list(serviceId);
  }

  @Post()
  @ProjectRole(MemberRole.MEMBER, 'service', 'serviceId')
  create(
    @Param('serviceId') serviceId: string,
    @Body() dto: CreateServiceCronDto,
  ) {
    return this.scheduler.create(serviceId, dto);
  }

  @Patch(':id')
  @ProjectRole(MemberRole.MEMBER, 'service', 'serviceId')
  update(
    @Param('serviceId') serviceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateServiceCronDto,
  ) {
    return this.scheduler.update(serviceId, id, dto);
  }

  @Delete(':id')
  @ProjectRole(MemberRole.ADMIN, 'service', 'serviceId')
  remove(
    @Param('serviceId') serviceId: string,
    @Param('id') id: string,
  ) {
    return this.scheduler.remove(serviceId, id);
  }
}
