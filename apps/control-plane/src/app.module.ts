import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CsrfGuard } from './common/http/csrf.guard';
import { DatabaseModule } from './db/database.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { LicensingModule } from './common/licensing/licensing.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { InvitesModule } from './modules/invites/invites.module';
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
import { SsoModule } from './modules/sso/sso.module';
import { PreviewModule } from './modules/preview/preview.module';
import { EmailModule } from './modules/email/email.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ServiceCronModule } from './modules/service-cron/service-cron.module';
import { CertificatesModule } from './modules/certificates/certificates.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    // Global rate limiting: a generous default cap per client IP. Auth routes
    // add tighter per-route limits via @Throttle (see AuthController).
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    DatabaseModule,
    CryptoModule,
    LicensingModule,
    AuthModule,
    UsersModule,
    InvitesModule,
    MembersModule,
    AuditModule,
    NodesModule,
    ProjectsModule,
    ServicesModule,
    DatabasesModule,
    BackupsModule,
    TunnelsModule,
    TemplatesModule,
    CatalogModule,
    GitModule,
    AlertsModule,
    OffsiteModule,
    ApiTokensModule,
    BrandingModule,
    MetricsModule,
    SsoModule,
    PreviewModule,
    EmailModule,
    ServiceCronModule,
    CertificatesModule,
  ],
  providers: [
    // Apply the throttler globally (defense-in-depth across every route).
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Double-submit CSRF protection for cookie-authenticated browser requests
    // (H-1). No-op for Bearer/PAT and safe methods (see CsrfGuard).
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
})
export class AppModule {}
