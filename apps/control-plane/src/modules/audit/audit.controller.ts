import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { MemberRole } from '@selfhosted/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectRole } from '../../common/rbac/project-role.decorator';
import { ProjectRolesGuard } from '../../common/rbac/project-roles.guard';
import { AuditService } from './audit.service';

@UseGuards(JwtAuthGuard, ProjectRolesGuard)
@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Platform-wide trail — restricted to global admins. */
  @Get('audit')
  all(@Request() req: { user: { role: string } }) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
    return this.audit.list({});
  }

  /** Per-project trail — visible to project admins/owner. */
  @Get('projects/:projectId/audit')
  @ProjectRole(MemberRole.ADMIN, 'project', 'projectId')
  forProject(@Param('projectId') projectId: string) {
    return this.audit.list({ projectId });
  }
}
