import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ModuleGuard } from '../../common/licensing/module.guard';
import { RequiresModule } from '../../common/licensing/require-module.decorator';
import { BrandingService } from './branding.service';
import { SetBrandingDto } from './dto/branding.dto';

@Controller('branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  private assertAdmin(req: { user?: { role?: string } }) {
    if (req.user?.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  }

  /** Public: the UI needs this before login to render the brand. */
  @Get()
  effective() {
    return this.branding.effective();
  }

  @Get('config')
  @UseGuards(JwtAuthGuard, ModuleGuard)
  @RequiresModule('white-label')
  getConfig(@Request() req: { user?: { role?: string } }) {
    this.assertAdmin(req);
    return this.branding.getConfig();
  }

  @Put('config')
  @UseGuards(JwtAuthGuard, ModuleGuard)
  @RequiresModule('white-label')
  setConfig(
    @Request() req: { user?: { role?: string } },
    @Body() dto: SetBrandingDto,
  ) {
    this.assertAdmin(req);
    return this.branding.setConfig(dto);
  }
}
