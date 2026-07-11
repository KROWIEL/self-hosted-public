import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { MemberRole } from '@selfhosted/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectRole } from '../../common/rbac/project-role.decorator';
import { ProjectRolesGuard } from '../../common/rbac/project-roles.guard';
import { Actor, MembersService } from '../members/members.service';
import { ProjectResolver } from '../members/project-resolver.service';
import { BackupsService } from './backups.service';
import { BackupScheduler } from './backup.scheduler';

type BackupKind = 'VOLUME' | 'DATABASE';

@UseGuards(JwtAuthGuard, ProjectRolesGuard)
@Controller()
export class BackupsController {
  constructor(
    private readonly backups: BackupsService,
    private readonly scheduler: BackupScheduler,
    private readonly members: MembersService,
    private readonly resolver: ProjectResolver,
  ) {}

  /**
   * These endpoints identify their project via a `refId` (volume/database id) in
   * the query/body rather than a route param, so the @ProjectRole guard can't
   * resolve them declaratively — enforce the role here instead.
   */
  private async assertRef(req: Request, kind: BackupKind, refId: string, min: MemberRole) {
    const projectId = await this.resolver.fromRef(kind, refId);
    await this.members.assertRole((req as Request & { user: Actor }).user, projectId, min);
  }

  @Get('backups')
  async list(
    @Req() req: Request,
    @Query('kind') kind: BackupKind,
    @Query('refId') refId: string,
  ) {
    await this.assertRef(req, kind, refId, MemberRole.VIEWER);
    return this.backups.list(kind, refId);
  }

  @Post('backups')
  async create(
    @Req() req: Request,
    @Body() body: { kind: BackupKind; refId: string },
  ) {
    await this.assertRef(req, body.kind, body.refId, MemberRole.MEMBER);
    return this.backups.create(body.kind, body.refId);
  }

  @Post('backups/:id/restore')
  @ProjectRole(MemberRole.ADMIN, 'backup')
  restore(@Param('id') id: string) {
    return this.backups.restore(id);
  }

  @Delete('backups/:id')
  @ProjectRole(MemberRole.ADMIN, 'backup')
  remove(@Param('id') id: string) {
    return this.backups.remove(id);
  }

  @Get('backups/:id/download')
  @ProjectRole(MemberRole.ADMIN, 'backup')
  async download(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const abort = new AbortController();
    req.on('close', () => abort.abort());

    let stream: Awaited<ReturnType<BackupsService['openDownload']>>;
    try {
      stream = await this.backups.openDownload(id, abort.signal);
    } catch (e) {
      res.status(502).send(e instanceof Error ? e.message : 'agent unreachable');
      return;
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${stream.fileName}"`,
    );
    const node = Readable.fromWeb(stream.res.body as never);
    node.on('error', () => res.end());
    node.pipe(res);
  }

  @Get('backup-schedules')
  async listSchedules(
    @Req() req: Request,
    @Query('kind') kind: BackupKind,
    @Query('refId') refId: string,
  ) {
    await this.assertRef(req, kind, refId, MemberRole.VIEWER);
    return this.scheduler.listSchedules(kind, refId);
  }

  @Post('backup-schedules')
  async createSchedule(
    @Req() req: Request,
    @Body()
    body: { kind: BackupKind; refId: string; cron: string; keepLast?: number },
  ) {
    await this.assertRef(req, body.kind, body.refId, MemberRole.ADMIN);
    return this.scheduler.createSchedule(body);
  }

  @Delete('backup-schedules/:id')
  @ProjectRole(MemberRole.ADMIN, 'schedule')
  removeSchedule(@Param('id') id: string) {
    return this.scheduler.removeSchedule(id);
  }
}
