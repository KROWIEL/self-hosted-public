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
import { IsEmail, IsEnum } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectRole } from '../../common/rbac/project-role.decorator';
import { ProjectRolesGuard } from '../../common/rbac/project-roles.guard';
import { MembersService } from './members.service';

class AddMemberDto {
  @IsEmail()
  email: string;

  @IsEnum(MemberRole)
  role: MemberRole;
}

class UpdateMemberDto {
  @IsEnum(MemberRole)
  role: MemberRole;
}

@UseGuards(JwtAuthGuard, ProjectRolesGuard)
@Controller('projects/:projectId/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @ProjectRole(MemberRole.VIEWER, 'project', 'projectId')
  list(@Param('projectId') projectId: string) {
    return this.members.list(projectId);
  }

  @Post()
  @ProjectRole(MemberRole.ADMIN, 'project', 'projectId')
  add(@Param('projectId') projectId: string, @Body() dto: AddMemberDto) {
    return this.members.addByEmail(projectId, dto.email, dto.role);
  }

  @Patch(':userId')
  @ProjectRole(MemberRole.ADMIN, 'project', 'projectId')
  update(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.members.updateRole(projectId, userId, dto.role);
  }

  @Delete(':userId')
  @ProjectRole(MemberRole.ADMIN, 'project', 'projectId')
  remove(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ) {
    return this.members.remove(projectId, userId);
  }
}
