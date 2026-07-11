import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { MemberRole } from '@selfhosted/shared';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectRole } from '../../common/rbac/project-role.decorator';
import { ProjectRolesGuard } from '../../common/rbac/project-roles.guard';
import { ProjectsService } from './projects.service';

type Actor = { id: string; role: string };

class CreateProjectDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  cpuLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(16)
  memLimit?: number;
}

class UpdateProjectLimitsDto {
  @IsInt()
  @Min(1)
  cpuLimit: number;

  @IsInt()
  @Min(16)
  memLimit: number;
}

@UseGuards(JwtAuthGuard, ProjectRolesGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Request() req: { user: Actor }) {
    return this.projects.list(req.user);
  }

  @Post()
  create(@Request() req: { user: Actor }, @Body() dto: CreateProjectDto) {
    return this.projects.create(req.user.id, dto.name, {
      cpuLimit: dto.cpuLimit,
      memLimit: dto.memLimit,
    });
  }

  @Get('resource-summary/platform')
  platformResourceSummary(@Request() req: { user: Actor }) {
    return this.projects.platformResourceSummary(req.user);
  }

  @Get(':id')
  @ProjectRole(MemberRole.VIEWER, 'project')
  get(@Param('id') id: string, @Request() req: { user: Actor }) {
    return this.projects.get(id, req.user);
  }

  @Patch(':id/limits')
  @ProjectRole(MemberRole.ADMIN, 'project')
  updateLimits(@Param('id') id: string, @Body() dto: UpdateProjectLimitsDto) {
    return this.projects.updateLimits(id, dto);
  }

  @Delete(':id')
  @ProjectRole(MemberRole.OWNER, 'project')
  remove(@Param('id') id: string) {
    return this.projects.remove(id);
  }
}
