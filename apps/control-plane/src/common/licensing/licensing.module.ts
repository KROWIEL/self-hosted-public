import { Global, Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';
import { LicensingController } from './licensing.controller';
import { ModuleGuard } from './module.guard';

/**
 * Global commercial-licensing module. Exposes {@link EntitlementsService} and
 * {@link ModuleGuard} everywhere so any feature module can gate handlers with
 * `@RequiresModule(...)`.
 */
@Global()
@Module({
  controllers: [LicensingController],
  providers: [EntitlementsService, ModuleGuard],
  exports: [EntitlementsService, ModuleGuard],
})
export class LicensingModule {}
