import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  domains,
  nodes,
  services,
  tlsSettings,
} from '../../db/schema';
import { AgentClient } from '../nodes/agent.client';
import {
  SetCustomCertDto,
  SetTlsSettingsDto,
} from './dto/certificates.dto';

/**
 * Domain TLS visibility + custom certificate upload (Free core).
 * ACME issuance stays with Traefik; custom PEMs are encrypted in DB and
 * pushed to the service's node agent for Traefik's file provider.
 */
@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly agent: AgentClient,
  ) {}

  async listDomains() {
    const rows = await this.db
      .select({
        id: domains.id,
        host: domains.host,
        https: domains.https,
        certSource: domains.certSource,
        hasCustomCert: domains.customCertEnc,
        serviceId: services.id,
        serviceName: services.name,
        nodeId: services.nodeId,
        nodeName: nodes.name,
        createdAt: domains.createdAt,
      })
      .from(domains)
      .innerJoin(services, eq(services.id, domains.serviceId))
      .leftJoin(nodes, eq(nodes.id, services.nodeId))
      .orderBy(domains.host);

    return rows.map((r) => ({
      id: r.id,
      host: r.host,
      https: r.https,
      certSource: r.certSource === 'custom' ? 'custom' : 'acme',
      customCertSet: !!r.hasCustomCert,
      status:
        r.certSource === 'custom'
          ? 'custom'
          : r.https
            ? 'acme'
            : 'http-only',
      serviceId: r.serviceId,
      serviceName: r.serviceName,
      nodeId: r.nodeId,
      nodeName: r.nodeName,
      createdAt: r.createdAt,
    }));
  }

  async setCustomCert(domainId: string, dto: SetCustomCertDto) {
    const row = await this.domainRow(domainId);
    if (!dto.certPem.includes('BEGIN CERTIFICATE')) {
      throw new BadRequestException('certPem must be a PEM certificate');
    }
    if (
      !dto.keyPem.includes('BEGIN') ||
      !dto.keyPem.includes('PRIVATE KEY')
    ) {
      throw new BadRequestException('keyPem must be a PEM private key');
    }

    const customCertEnc = this.crypto.encrypt(dto.certPem);
    const customKeyEnc = this.crypto.encrypt(dto.keyPem);
    await this.db
      .update(domains)
      .set({
        certSource: 'custom',
        customCertEnc,
        customKeyEnc,
        https: true,
      })
      .where(eq(domains.id, domainId));

    await this.applyToAgent(row.serviceId, row.host, dto.certPem, dto.keyPem);
    return this.getDomain(domainId);
  }

  async clearCustomCert(domainId: string) {
    const row = await this.domainRow(domainId);
    await this.db
      .update(domains)
      .set({
        certSource: 'acme',
        customCertEnc: null,
        customKeyEnc: null,
      })
      .where(eq(domains.id, domainId));

    try {
      const node = await this.nodeForService(row.serviceId);
      await this.agent.deleteCert(node, row.host);
    } catch (e) {
      this.logger.warn(
        `Failed to remove custom cert on agent for ${row.host}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return this.getDomain(domainId);
  }

  async getDomain(domainId: string) {
    const list = await this.listDomains();
    const found = list.find((d) => d.id === domainId);
    if (!found) throw new NotFoundException('Domain not found');
    return found;
  }

  /** Env-backed Traefik status + editable panel preferences. */
  async getTlsSettings() {
    const row = await this.tlsRow();
    const envToken = process.env.CLOUDFLARE_DNS_API_TOKEN ?? '';
    return {
      acmeEmail: row?.acmeEmail || process.env.ACME_EMAIL || '',
      dnsProvider:
        row?.dnsProvider || process.env.ACME_DNS_PROVIDER || 'cloudflare',
      wildcardEnabled:
        row?.wildcardEnabled ??
        process.env.ACME_WILDCARD_CERTS === '1',
      cloudflareTokenSet: !!row?.cloudflareTokenEnc || !!envToken,
      // Live Traefik / agent env (read-only snapshot).
      env: {
        acmeEmail: process.env.ACME_EMAIL || '',
        dnsProvider: process.env.ACME_DNS_PROVIDER || 'cloudflare',
        wildcardEnabled: process.env.ACME_WILDCARD_CERTS === '1',
        cloudflareTokenSet: !!envToken,
      },
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async setTlsSettings(dto: SetTlsSettingsDto) {
    const existing = await this.tlsRow();
    let cloudflareTokenEnc = existing?.cloudflareTokenEnc ?? '';
    if (dto.cloudflareToken !== undefined) {
      cloudflareTokenEnc = dto.cloudflareToken
        ? this.crypto.encrypt(dto.cloudflareToken)
        : '';
    }
    const values = {
      id: 'default' as const,
      acmeEmail: dto.acmeEmail ?? existing?.acmeEmail ?? '',
      dnsProvider: dto.dnsProvider ?? existing?.dnsProvider ?? 'cloudflare',
      wildcardEnabled:
        dto.wildcardEnabled ?? existing?.wildcardEnabled ?? false,
      cloudflareTokenEnc,
      updatedAt: new Date(),
    };
    await this.db
      .insert(tlsSettings)
      .values(values)
      .onConflictDoUpdate({ target: tlsSettings.id, set: values });
    return this.getTlsSettings();
  }

  private async tlsRow() {
    const [row] = await this.db
      .select()
      .from(tlsSettings)
      .where(eq(tlsSettings.id, 'default'))
      .limit(1);
    return row ?? null;
  }

  private async domainRow(domainId: string) {
    const [row] = await this.db
      .select()
      .from(domains)
      .where(eq(domains.id, domainId))
      .limit(1);
    if (!row) throw new NotFoundException('Domain not found');
    return row;
  }

  private async nodeForService(serviceId: string) {
    const [svc] = await this.db
      .select()
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);
    if (!svc) throw new NotFoundException('Service not found');
    const [node] = await this.db
      .select()
      .from(nodes)
      .where(eq(nodes.id, svc.nodeId))
      .limit(1);
    if (!node) throw new NotFoundException('Node not found');
    return node;
  }

  private async applyToAgent(
    serviceId: string,
    host: string,
    certPem: string,
    keyPem: string,
  ) {
    try {
      const node = await this.nodeForService(serviceId);
      await this.agent.putCert(node, { host, certPem, keyPem });
    } catch (e) {
      this.logger.warn(
        `Custom cert stored but agent apply failed for ${host}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      throw new BadRequestException(
        `Certificate saved, but the node agent could not apply it: ${
          e instanceof Error ? e.message : String(e)
        }. Ensure AGENT_TRAEFIK_CERTS_DIR matches Traefik's /certs mount.`,
      );
    }
  }

  /** Used by deploy to know whether to skip ACME on the agent. */
  async customTlsForService(serviceId: string): Promise<boolean> {
    const [row] = await this.db
      .select({
        certSource: domains.certSource,
        customCertEnc: domains.customCertEnc,
      })
      .from(domains)
      .where(eq(domains.serviceId, serviceId))
      .limit(1);
    return row?.certSource === 'custom' && !!row.customCertEnc;
  }

  /** Re-push stored custom cert before deploy (best-effort). */
  async ensureApplied(serviceId: string) {
    const [row] = await this.db
      .select()
      .from(domains)
      .where(eq(domains.serviceId, serviceId))
      .limit(1);
    if (!row || row.certSource !== 'custom' || !row.customCertEnc || !row.customKeyEnc) {
      return;
    }
    const certPem = this.crypto.decrypt(row.customCertEnc);
    const keyPem = this.crypto.decrypt(row.customKeyEnc);
    const node = await this.nodeForService(serviceId);
    await this.agent.putCert(node, {
      host: row.host,
      certPem,
      keyPem,
    });
  }
}
