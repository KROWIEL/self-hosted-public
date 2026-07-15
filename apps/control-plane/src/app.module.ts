import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './db/database.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { LicensingModule } from './common/licensing/licensing.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { MembersModule } from './modules/members/members.module';
import { AuditModule } from './modules/audit/audit.module';
import { NodesModule } from './modules/nodes/nodes.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ServicesModule } from './modules/services/services.module';
import { DatabasesModule } from './modules/databases/databases.module';
import { BackupsModule } from './modules/backups/backups.module';
import { TunnelsModule } from './modules/tunnels/tunnels.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { GitModule } from './modules/git/git.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { OffsiteModule } from './modules/offsite/offsite.module';
import { ApiTokensModule } from './modules/api-tokens/api-tokens.module';
import { BrandingModule } from './modules/branding/branding.module';
import { MetricsModule } from './modules/metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule,
    CryptoModule,
    LicensingModule,
    AuthModule,
    UsersModule,
    MembersModule,
    AuditModule,
    NodesModule,
    ProjectsModule,
    ServicesModule,
    DatabasesModule,
    BackupsModule,
    TunnelsModule,
    TemplatesModule,
    GitModule,
    AlertsModule,
    OffsiteModule,
    ApiTokensModule,
    BrandingModule,
    MetricsModule,
  ],
})
export class AppModule {}
