import { Global, Module } from '@nestjs/common';
import { ApiTokensController } from './api-tokens.controller';
import { ApiTokenService } from './api-token.service';

/**
 * Global so {@link ApiTokenService} is resolvable inside {@link JwtAuthGuard}
 * wherever the guard is used (every protected controller).
 */
@Global()
@Module({
  controllers: [ApiTokensController],
  providers: [ApiTokenService],
  exports: [ApiTokenService],
})
export class ApiTokensModule {}
