import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';
import { AuditController } from './audit.controller';

@Module({
  providers: [
    AuditService,
    AuditInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: AuditInterceptor },
  ],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
