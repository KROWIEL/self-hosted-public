import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MemberRole } from '@selfhosted/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectRole } from '../../common/rbac/project-role.decorator';
import { ProjectRolesGuard } from '../../common/rbac/project-roles.guard';
import { DatabasesService } from './databases.service';
import { AgentEnvKey } from '../nodes/agent.client';
import { CreateDatabaseDto } from './dto/create-database.dto';

type Engine = 'POSTGRES' | 'MYSQL';

@UseGuards(JwtAuthGuard, ProjectRolesGuard)
@Controller()
export class DatabasesController {
  constructor(private readonly databases: DatabasesService) {}

  @Post('projects/:projectId/databases')
  @ProjectRole(MemberRole.ADMIN, 'project', 'projectId')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateDatabaseDto,
  ) {
    return this.databases.create(projectId, dto);
  }

  @Get('projects/:projectId/databases')
  @ProjectRole(MemberRole.VIEWER, 'project', 'projectId')
  list(@Param('projectId') projectId: string) {
    return this.databases.listByProject(projectId);
  }

  @Get('services/:serviceId/inspect')
  @ProjectRole(MemberRole.MEMBER, 'service', 'serviceId')
  inspect(@Param('serviceId') serviceId: string) {
    return this.databases.inspectService(serviceId);
  }

  @Post('services/:serviceId/setup')
  @ProjectRole(MemberRole.ADMIN, 'service', 'serviceId')
  setup(
    @Param('serviceId') serviceId: string,
    @Body()
    body: {
      databases: { engine: Engine; schemas: string[] }[];
      envKeys: AgentEnvKey[];
    },
  ) {
    return this.databases.applySetup(serviceId, body);
  }

  @Get('databases/:id')
  @ProjectRole(MemberRole.VIEWER, 'database')
  get(@Param('id') id: string) {
    return this.databases.getView(id);
  }

  @Get('databases/:id/credentials')
  @ProjectRole(MemberRole.ADMIN, 'database')
  credentials(@Param('id') id: string) {
    return this.databases.credentials(id);
  }

  @Get('databases/:id/status')
  @ProjectRole(MemberRole.VIEWER, 'database')
  status(@Param('id') id: string) {
    return this.databases.status(id);
  }

  @Post('databases/:id/power')
  @ProjectRole(MemberRole.MEMBER, 'database')
  power(@Param('id') id: string, @Body() body: { action: string }) {
    return this.databases.power(id, body.action);
  }

  @Post('databases/:id/attach')
  @ProjectRole(MemberRole.ADMIN, 'database')
  attach(@Param('id') id: string, @Body() body: { serviceId: string }) {
    return this.databases.attach(id, body.serviceId);
  }

  @Delete('databases/:id')
  @ProjectRole(MemberRole.ADMIN, 'database')
  remove(@Param('id') id: string, @Query('keepVolume') keepVolume?: string) {
    return this.databases.remove(id, keepVolume === 'true' || keepVolume === '1');
  }
}
