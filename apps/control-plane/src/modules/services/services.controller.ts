import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { MemberRole, PowerAction } from '@selfhosted/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectRole } from '../../common/rbac/project-role.decorator';
import { ProjectRolesGuard } from '../../common/rbac/project-roles.guard';
import { ServicesService } from './services.service';
import { BuildLogService } from './build-log.service';
import { ExecTicketService } from './exec-ticket.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { SetDomainDto, SetEnvDto } from './dto/set-env.dto';

@UseGuards(JwtAuthGuard, ProjectRolesGuard)
@Controller()
export class ServicesController {
  constructor(
    private readonly services: ServicesService,
    private readonly buildLog: BuildLogService,
    private readonly execTickets: ExecTicketService,
  ) {}

  /**
   * Mints a short-lived, single-use ticket for opening the exec WebSocket. The
   * interactive shell is powerful, so this mirrors the exec proxy's own check:
   * project ADMIN (global admins pass). The ticket — not the access JWT — is
   * then passed in the WS query string, keeping bearer tokens out of proxy logs.
   */
  @Post('services/:id/exec-ticket')
  @ProjectRole(MemberRole.ADMIN, 'service')
  async execTicket(
    @Param('id') id: string,
    @Req() req: Request & { user: { id: string; tokenVersion: number } },
  ) {
    const ticket = await this.execTickets.mint(
      req.user.id,
      id,
      req.user.tokenVersion,
    );
    return { ticket };
  }

  @Post('projects/:projectId/services')
  @ProjectRole(MemberRole.MEMBER, 'project', 'projectId')
  create(@Param('projectId') projectId: string, @Body() dto: CreateServiceDto) {
    return this.services.create(projectId, dto);
  }

  @Get('services/:id')
  @ProjectRole(MemberRole.VIEWER, 'service')
  get(@Param('id') id: string) {
    return this.services.getDetail(id);
  }

  @Patch('services/:id')
  @ProjectRole(MemberRole.MEMBER, 'service')
  update(@Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.services.update(id, dto);
  }

  @Delete('services/:id')
  @ProjectRole(MemberRole.ADMIN, 'service')
  remove(@Param('id') id: string) {
    return this.services.remove(id);
  }

  @Get('services/:id/env')
  @ProjectRole(MemberRole.VIEWER, 'service')
  listEnv(@Param('id') id: string) {
    return this.services.listEnv(id);
  }

  @Put('services/:id/env')
  @ProjectRole(MemberRole.ADMIN, 'service')
  setEnv(@Param('id') id: string, @Body() dto: SetEnvDto) {
    return this.services.setEnv(id, dto);
  }

  @Delete('services/:id/env/:key')
  @ProjectRole(MemberRole.ADMIN, 'service')
  deleteEnv(@Param('id') id: string, @Param('key') key: string) {
    return this.services.deleteEnv(id, key);
  }

  @Put('services/:id/domain')
  @ProjectRole(MemberRole.ADMIN, 'service')
  setDomain(@Param('id') id: string, @Body() dto: SetDomainDto) {
    return this.services.setDomain(id, dto);
  }

  @Get('services/:id/volumes')
  @ProjectRole(MemberRole.VIEWER, 'service')
  listVolumes(@Param('id') id: string) {
    return this.services.listVolumes(id);
  }

  @Post('services/:id/volumes')
  @ProjectRole(MemberRole.ADMIN, 'service')
  addVolume(@Param('id') id: string, @Body() body: { mountPath: string }) {
    return this.services.addVolume(id, body.mountPath);
  }

  @Delete('services/:id/volumes/:volumeId')
  @ProjectRole(MemberRole.ADMIN, 'service')
  removeVolume(
    @Param('id') id: string,
    @Param('volumeId') volumeId: string,
  ) {
    return this.services.removeVolume(id, volumeId);
  }

  @Post('services/:id/deploy')
  @ProjectRole(MemberRole.MEMBER, 'service')
  deploy(@Param('id') id: string) {
    return this.services.deploy(id);
  }

  @Post('deployments/:id/rollback')
  @ProjectRole(MemberRole.MEMBER, 'deployment', 'id')
  rollback(@Param('id') id: string) {
    return this.services.rollback(id);
  }

  @Get('services/:id/webhook')
  @ProjectRole(MemberRole.ADMIN, 'service')
  webhook(@Param('id') id: string) {
    return this.services.getWebhook(id);
  }

  @Get('services/:id/deployments')
  @ProjectRole(MemberRole.VIEWER, 'service')
  deployments(@Param('id') id: string) {
    return this.services.listDeployments(id);
  }

  @Get('services/:id/stats')
  @ProjectRole(MemberRole.VIEWER, 'service')
  stats(@Param('id') id: string) {
    return this.services.stats(id);
  }

  @Get('projects/:projectId/resource-summary')
  @ProjectRole(MemberRole.VIEWER, 'project', 'projectId')
  projectResourceSummary(@Param('projectId') projectId: string) {
    return this.services.projectResourceSummary(projectId);
  }

  /**
   * Live runtime log stream. Pipes the node agent's `docker logs -f` output to
   * the browser as chunked text. The browser reads it via fetch + ReadableStream.
   */
  @Get('services/:id/logs/stream')
  @ProjectRole(MemberRole.VIEWER, 'service')
  async logsStream(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const abort = new AbortController();
    req.on('close', () => abort.abort());

    let upstream: globalThis.Response;
    try {
      upstream = await this.services.openLogStream(id, abort.signal);
    } catch (e) {
      res.status(502).send(e instanceof Error ? e.message : 'agent unreachable');
      return;
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    const node = Readable.fromWeb(upstream.body as never);
    node.on('error', () => res.end());
    node.pipe(res);
  }

  /**
   * Live build-log stream for a deployment. Replays buffered output then streams
   * new chunks via Redis pub/sub. For finished deployments it returns the stored
   * build log immediately.
   */
  @Get('deployments/:id/logs/stream')
  @ProjectRole(MemberRole.VIEWER, 'deployment', 'id')
  async buildLogStream(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const dep = await this.services.getDeployment(id);
    if (!dep) {
      res.status(404).send('deployment not found');
      return;
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    const finished = dep.status === 'SUCCESS' || dep.status === 'FAILED';
    if (finished) {
      if (dep.errorMsg) res.write(`ERROR: ${dep.errorMsg}\n\n`);
      res.write(dep.buildLog ?? '');
      res.end();
      return;
    }

    const history = await this.buildLog.history(id);
    if (history) res.write(history);

    const cleanup = this.buildLog.subscribe(
      id,
      (chunk) => res.write(chunk),
      () => res.end(),
    );
    req.on('close', cleanup);
  }

  @Post('services/:id/start')
  @ProjectRole(MemberRole.MEMBER, 'service')
  start(@Param('id') id: string) {
    return this.services.power(id, PowerAction.START);
  }

  @Post('services/:id/stop')
  @ProjectRole(MemberRole.MEMBER, 'service')
  stop(@Param('id') id: string) {
    return this.services.power(id, PowerAction.STOP);
  }

  @Post('services/:id/restart')
  @ProjectRole(MemberRole.MEMBER, 'service')
  restart(@Param('id') id: string) {
    return this.services.power(id, PowerAction.RESTART);
  }
}
