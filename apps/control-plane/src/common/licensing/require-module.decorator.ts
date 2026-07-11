import { SetMetadata } from '@nestjs/common';
import type { LicenseModule } from '@selfhosted/shared';

export const REQUIRES_MODULE_KEY = 'requiresModule';

/**
 * Marks a controller or handler as requiring a licensed module. Combine with
 * {@link ModuleGuard} (via `@UseGuards`) to enforce it.
 *
 * @example
 * ```ts
 * @UseGuards(JwtAuthGuard, ModuleGuard)
 * @RequiresModule('reverse-tunnels')
 * @Controller('tunnels')
 * ```
 */
export const RequiresModule = (module: LicenseModule) =>
  SetMetadata(REQUIRES_MODULE_KEY, module);
