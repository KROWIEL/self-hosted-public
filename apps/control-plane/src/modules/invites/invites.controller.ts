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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/invite.dto';

@Controller('invites')
@UseGuards(JwtAuthGuard, AdminGuard)
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post()
  create(
    @Body() dto: CreateInviteDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    const origin = this.origin(req);
    return this.invites.create(req.user.id, dto, origin);
  }

  @Get()
  list() {
    return this.invites.list();
  }

  @Delete(':id')
  revoke(@Param('id') id: string) {
    return this.invites.revoke(id);
  }

  private origin(req: Request): string {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host =
      (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    return `${proto}://${host}`;
  }
}
