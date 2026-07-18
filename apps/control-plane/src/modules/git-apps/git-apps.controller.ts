import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ModuleGuard } from '../../common/licensing/module.guard';
import { RequiresModule } from '../../common/licensing/require-module.decorator';
import { GitAppsService, ReqLike } from './git-apps.service';
import {
  GIT_APP_PROVIDERS,
  GitAppProvider,
  SetGitAppConfigDto,
} from './dto/git-apps.dto';

function parseProvider(raw: string): GitAppProvider {
  if ((GIT_APP_PROVIDERS as readonly string[]).includes(raw)) {
    return raw as GitAppProvider;
  }
  throw new NotFoundException(`Unknown git provider: ${raw}`);
}

@UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard)
@RequiresModule('preview-envs')
@Controller('git-apps')
export class GitAppsController {
  constructor(private readonly gitApps: GitAppsService) {}

  @Get()
  list(@Req() req: ReqLike) {
    return this.gitApps.list(req);
  }

  @Get(':provider')
  get(@Param('provider') provider: string, @Req() req: ReqLike) {
    return this.gitApps.getConfig(parseProvider(provider), req);
  }

  @Put(':provider')
  set(
    @Param('provider') provider: string,
    @Body() dto: SetGitAppConfigDto,
    @Req() req: ReqLike,
  ) {
    return this.gitApps.setConfig(parseProvider(provider), dto, req);
  }
}
