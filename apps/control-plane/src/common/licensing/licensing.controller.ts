import {
  Body,
  Controller,
  Delete,
  Get,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../modules/auth/jwt-auth.guard';
import { CommonErrors, LicenseErrors } from '../errors/app-errors';
import { EntitlementsService } from './entitlements.service';

type AuthedReq = { user: { id: string; role: string } };

function assertAdmin(req: AuthedReq) {
  if (req.user.role !== 'ADMIN') throw CommonErrors.adminOnly();
}

@UseGuards(JwtAuthGuard)
@Controller('license')
export class LicensingController {
  constructor(private readonly entitlements: EntitlementsService) {}

  /** Current effective entitlements — readable by any signed-in user. */
  @Get()
  get() {
    return this.entitlements.get();
  }

  /** Activate / replace the installation license key (admin only). */
  @Put()
  set(@Request() req: AuthedReq, @Body('key') key: string) {
    assertAdmin(req);
    if (!key || !key.trim()) throw LicenseErrors.invalidKey();
    return this.entitlements.setKey(key);
  }

  /** Remove the stored license key, reverting to Free (admin only). */
  @Delete()
  clear(@Request() req: AuthedReq) {
    assertAdmin(req);
    return this.entitlements.clear();
  }
}
