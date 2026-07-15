import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ModuleGuard } from '../../common/licensing/module.guard';
import { RequiresModule } from '../../common/licensing/require-module.decorator';
import { SsoService, ReqLike } from './sso.service';
import { SetSsoConfigDto } from './dto/sso.dto';

/** Express `Response` subset we use (avoids a hard @types/express dependency). */
interface ResLike {
  redirect(url: string): void;
}

@Controller('auth/sso')
export class SsoController {
  constructor(private readonly sso: SsoService) {}

  private assertAdmin(req: { user?: { role?: string } }) {
    if (req.user?.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  }

  /** Public: the login page calls this to decide whether to show the button. */
  @Get('status')
  status() {
    return this.sso.status();
  }

  /** Public: begins the OIDC flow by redirecting to the provider. */
  @Get('start')
  async start(@Req() req: ReqLike, @Res() res: ResLike) {
    const url = await this.sso.buildAuthUrl(req);
    res.redirect(url);
  }

  /** Public: provider redirects back here; we finish and bounce to the web app. */
  @Get('callback')
  async callback(
    @Req() req: ReqLike,
    @Res() res: ResLike,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const target = await this.sso.handleCallback(req, { code, state, error });
    res.redirect(target);
  }

  @Get('config')
  @UseGuards(JwtAuthGuard, ModuleGuard)
  @RequiresModule('sso')
  getConfig(@Req() req: ReqLike & { user?: { role?: string } }) {
    this.assertAdmin(req);
    return this.sso.getConfig(req);
  }

  @Put('config')
  @UseGuards(JwtAuthGuard, ModuleGuard)
  @RequiresModule('sso')
  async setConfig(
    @Req() req: ReqLike & { user?: { role?: string } },
    @Body() dto: SetSsoConfigDto,
  ) {
    this.assertAdmin(req);
    await this.sso.setConfig(dto);
    return this.sso.getConfig(req);
  }
}
