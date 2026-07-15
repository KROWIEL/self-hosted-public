import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ModuleGuard } from '../../common/licensing/module.guard';
import { RequiresModule } from '../../common/licensing/require-module.decorator';
import { ApiTokenService } from './api-token.service';
import { CreateApiTokenDto } from './dto/api-tokens.dto';

/**
 * Personal API tokens (Pro: api-cli). Each user manages their own tokens; the
 * whole controller is gated behind the module.
 */
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('api-cli')
@Controller('api-tokens')
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokenService) {}

  @Get()
  list(@Request() req: { user: { id: string } }) {
    return this.tokens.list(req.user.id);
  }

  @Post()
  create(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateApiTokenDto,
  ) {
    return this.tokens.create(req.user.id, dto.name, dto.expiresInDays);
  }

  @Delete(':id')
  revoke(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.tokens.revoke(req.user.id, id);
  }
}
