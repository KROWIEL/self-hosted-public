import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { MemberRole } from '@selfhosted/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectRole } from '../../common/rbac/project-role.decorator';
import { ProjectRolesGuard } from '../../common/rbac/project-roles.guard';
import { ModuleGuard } from '../../common/licensing/module.guard';
import { RequiresModule } from '../../common/licensing/require-module.decorator';
import { Actor } from '../members/members.service';
import { PreviewService } from './preview.service';
import { CreatePreviewDto } from './dto/preview.dto';

@UseGuards(JwtAuthGuard, ProjectRolesGuard, ModuleGuard)
@RequiresModule('preview-envs')
@Controller()
export class PreviewController {
  constructor(private readonly preview: PreviewService) {}

  /** Every preview across the projects the caller can access. */
  @Get('previews')
  listAll(@Req() req: Request & { user?: Actor }) {
    return this.preview.listAll(req.user as Actor);
  }

  /** Previews of a specific parent service. */
  @Get('services/:id/previews')
  @ProjectRole(MemberRole.VIEWER, 'service')
  listForService(@Param('id') id: string) {
    return this.preview.listForService(id);
  }

  /** Create + deploy a preview for a parent service from a branch. */
  @Post('services/:id/previews')
  @ProjectRole(MemberRole.MEMBER, 'service')
  create(@Param('id') id: string, @Body() dto: CreatePreviewDto) {
    return this.preview.create(id, dto);
  }

  @Post('previews/:id/redeploy')
  @ProjectRole(MemberRole.MEMBER, 'preview')
  redeploy(@Param('id') id: string) {
    return this.preview.redeploy(id);
  }

  @Delete('previews/:id')
  @ProjectRole(MemberRole.MEMBER, 'preview')
  remove(@Param('id') id: string) {
    return this.preview.remove(id);
  }
}
