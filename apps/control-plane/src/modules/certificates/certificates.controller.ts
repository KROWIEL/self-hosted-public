import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CertificatesService } from './certificates.service';
import {
  SetCustomCertDto,
  SetTlsSettingsDto,
} from './dto/certificates.dto';

/** Free-core TLS / certificates management (admin). */
@UseGuards(JwtAuthGuard)
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certs: CertificatesService) {}

  private assertAdmin(req: { user?: { role?: string } }) {
    if (req.user?.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  }

  @Get()
  list(@Request() req: { user?: { role?: string } }) {
    this.assertAdmin(req);
    return this.certs.listDomains();
  }

  @Get('tls-settings')
  getTls(@Request() req: { user?: { role?: string } }) {
    this.assertAdmin(req);
    return this.certs.getTlsSettings();
  }

  @Put('tls-settings')
  setTls(
    @Request() req: { user?: { role?: string } },
    @Body() dto: SetTlsSettingsDto,
  ) {
    this.assertAdmin(req);
    return this.certs.setTlsSettings(dto);
  }

  @Put(':id/custom')
  setCustom(
    @Request() req: { user?: { role?: string } },
    @Param('id') id: string,
    @Body() dto: SetCustomCertDto,
  ) {
    this.assertAdmin(req);
    return this.certs.setCustomCert(id, dto);
  }

  @Delete(':id/custom')
  clearCustom(
    @Request() req: { user?: { role?: string } },
    @Param('id') id: string,
  ) {
    this.assertAdmin(req);
    return this.certs.clearCustomCert(id);
  }
}
