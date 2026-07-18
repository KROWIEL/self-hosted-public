import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MemberRole } from '@selfhosted/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MembersService, type Actor } from '../members/members.service';
import { CatalogService } from './catalog.service';
import { InstallCatalogAppDto } from './dto/install-catalog.dto';

@UseGuards(JwtAuthGuard)
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly members: MembersService,
  ) {}

  @Get()
  list() {
    return this.catalog.list();
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.catalog.get(slug);
  }

  @Post(':slug/install')
  async install(
    @Param('slug') slug: string,
    @Body() dto: InstallCatalogAppDto,
    @Req() req: { user: Actor },
  ) {
    await this.members.assertRole(req.user, dto.projectId, MemberRole.MEMBER);
    return this.catalog.install(slug, dto);
  }
}
