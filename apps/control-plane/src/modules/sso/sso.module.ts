import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';

@Module({
  imports: [UsersModule, AuthModule],
  controllers: [SsoController],
  providers: [SsoService],
})
export class SsoModule {}
