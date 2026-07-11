import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LicenseModule, minTierFor } from '@selfhosted/shared';
import { LicenseErrors } from '../errors/app-errors';
import { EntitlementsService } from './entitlements.service';
import { REQUIRES_MODULE_KEY } from './require-module.decorator';

/**
 * Enforces `@RequiresModule(...)`: allows the request only when the instance's
 * license grants the required module, otherwise throws a coded `moduleLocked`
 * error the frontend turns into an upgrade prompt.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const module = this.reflector.getAllAndOverride<LicenseModule | undefined>(
      REQUIRES_MODULE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!module) return true;

    if (!(await this.entitlements.hasModule(module))) {
      throw LicenseErrors.moduleLocked(module, minTierFor(module));
    }
    return true;
  }
}
