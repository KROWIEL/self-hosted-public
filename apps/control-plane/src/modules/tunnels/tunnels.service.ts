import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile as cpExecFile } from 'node:child_process';
import { DRIZZLE, Database } from '../../db/database.module';
import { tunnels } from '../../db/schema';
import { CryptoService } from '../../common/crypto/crypto.service';
import { TunnelRunnerService } from './tunnel-runner.service';
import { CreateTunnelDto, UpdateTunnelDto } from './dto/tunnel.dto';

const execFileAsync = promisify(cpExecFile);

type TunnelRow = typeof tunnels.$inferSelect;

const PLATFORMS: Record<string, { goos: string; goarch: string; ext: string }> =
  {
    'linux-amd64': { goos: 'linux', goarch: 'amd64', ext: '' },
    'linux-arm64': { goos: 'linux', goarch: 'arm64', ext: '' },
    'windows-amd64': { goos: 'windows', goarch: 'amd64', ext: '.exe' },
  };

@Injectable()
export class TunnelsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TunnelsService.name);

  /** TTL for the signed tokens that authorize relay-asset downloads. */
  private readonly assetTokenTtlMs = assetTokenTtlMs();

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly runner: TunnelRunnerService,
  ) {}

  /** Restart tunnels that were enabled before the panel shut down. */
  async onApplicationBootstrap() {
    if (process.env.LOCAL_AGENT_ENABLED !== '1') return;
    let rows: TunnelRow[];
    try {
      rows = await this.db
        .select()
        .from(tunnels)
        .where(eq(tunnels.enabled, true));
    } catch (e) {
      this.logger.warn(
        `Auto-start skipped (tunnel query failed): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return;
    }
    for (const row of rows) {
      try {
        await this.start(row.id);
        this.logger.log(`Auto-started tunnel ${row.name}`);
      } catch (e) {
        this.logger.warn(
          `Auto-start failed for tunnel ${row.name}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }

  async list() {
    const rows = await this.db.select().from(tunnels);
    return rows.map((r) => this.view(r));
  }

  async create(dto: CreateTunnelDto) {
    const token = randomBytes(24).toString('hex');
    const [row] = await this.db
      .insert(tunnels)
      .values({
        name: dto.name,
        serverHost: dto.serverHost,
        controlPort: dto.controlPort ?? 7000,
        relayPorts: this.normalizePorts(dto.relayPorts ?? '443'),
        targetHost: dto.targetHost ?? '127.0.0.1',
        proxyProtocol: dto.proxyProtocol ?? false,
        fingerprint: dto.fingerprint ?? null,
        tokenEnc: this.crypto.encrypt(token),
      })
      .returning();
    return this.view(row);
  }

  async getRow(id: string): Promise<TunnelRow> {
    const [row] = await this.db.select().from(tunnels).where(eq(tunnels.id, id));
    if (!row) throw new NotFoundException('Tunnel not found');
    return row;
  }

  async get(id: string) {
    return this.view(await this.getRow(id));
  }

  async update(id: string, dto: UpdateTunnelDto) {
    await this.getRow(id);
    const patch: Partial<TunnelRow> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.serverHost !== undefined) patch.serverHost = dto.serverHost;
    if (dto.controlPort !== undefined) patch.controlPort = dto.controlPort;
    if (dto.relayPorts !== undefined)
      patch.relayPorts = this.normalizePorts(dto.relayPorts);
    if (dto.targetHost !== undefined) patch.targetHost = dto.targetHost;
    if (dto.proxyProtocol !== undefined) patch.proxyProtocol = dto.proxyProtocol;
    if (dto.fingerprint !== undefined) patch.fingerprint = dto.fingerprint;
    const [row] = await this.db
      .update(tunnels)
      .set(patch)
      .where(eq(tunnels.id, id))
      .returning();
    return this.view(row);
  }

  async remove(id: string) {
    await this.getRow(id);
    this.runner.stop(id);
    await this.db.delete(tunnels).where(eq(tunnels.id, id));
    return { ok: true };
  }

  async start(id: string) {
    const row = await this.getRow(id);
    const token = this.crypto.decrypt(row.tokenEnc);
    const targets: Record<number, string> = {};
    for (const p of this.ports(row.relayPorts)) {
      targets[p] = `${row.targetHost}:${p}`;
    }
    await this.runner.start({
      id: row.id,
      serverAddr: `${row.serverHost}:${row.controlPort}`,
      token,
      targets,
      proxyProtocol: row.proxyProtocol,
      fingerprint: row.fingerprint,
    });
    await this.db
      .update(tunnels)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(tunnels.id, id));
    return this.statusFor(id);
  }

  async stop(id: string) {
    await this.getRow(id);
    this.runner.stop(id);
    await this.db
      .update(tunnels)
      .set({ enabled: false, status: 'OFFLINE', updatedAt: new Date() })
      .where(eq(tunnels.id, id));
    return this.statusFor(id);
  }

  async statusFor(id: string) {
    const row = await this.getRow(id);
    const rs = this.runner.status(id);
    const status = rs.connected ? 'ONLINE' : 'OFFLINE';
    if (row.status !== status) {
      await this.db
        .update(tunnels)
        .set({
          status,
          lastSeen: rs.connected ? new Date() : row.lastSeen,
          updatedAt: new Date(),
        })
        .where(eq(tunnels.id, id));
    }
    return { ...rs, status };
  }

  /** Connection details + ready-to-paste install commands for the VDS. */
  async install(id: string, origin: string) {
    const row = await this.getRow(id);
    const token = this.crypto.decrypt(row.tokenEnc);
    const base = origin.replace(/\/$/, '');
    const ctrl = `:${row.controlPort}`;
    // Assets (relay binary + install scripts) are gated behind a short-lived,
    // tamper-proof token so only a licensed operator who opened this page can
    // fetch them — without requiring a panel login on the fresh VDS.
    const at = this.mintAssetToken();
    const binUrls = Object.fromEntries(
      Object.keys(PLATFORMS).map((p) => [
        p,
        `${base}/api/v1/tunnels/assets/bin/${p}?t=${at}`,
      ]),
    );
    const shUrl = `${base}/api/v1/tunnels/assets/install.sh?t=${at}`;
    const ps1Url = `${base}/api/v1/tunnels/assets/install.ps1?t=${at}`;
    const envInline =
      `TUNNEL_TOKEN=${token} TUNNEL_CONTROL=${ctrl} ` +
      `TUNNEL_PORTS=${row.relayPorts}`;

    const linux =
      `curl -fsSL "${shUrl}" -o install.sh && ` +
      `sudo ${envInline} BIN_URL="${binUrls['linux-amd64']}" sh install.sh`;
    const windows =
      `iwr "${ps1Url}" -OutFile install.ps1; ` +
      `./install.ps1 -Token ${token} -Control ${ctrl} -Ports ${row.relayPorts} ` +
      `-BinUrl "${binUrls['windows-amd64']}"`;

    // Offline path: when the panel runs on a grey IP the VDS can't fetch these
    // files from it. Instead the operator downloads them on the panel host and
    // copies them to the VDS over scp, then runs the installer with the local
    // binary (no BIN_URL). `run` and `copy` assume a Linux VDS at serverHost.
    const offline = {
      download:
        `curl -fsSL "${shUrl}" -o install.sh && ` +
        `curl -fsSL "${binUrls['linux-amd64']}" -o tunnel-server`,
      copy: `scp tunnel-server install.sh root@${row.serverHost}:/root/`,
      run:
        `ssh root@${row.serverHost} "cd /root && chmod +x tunnel-server && ` +
        `sudo ${envInline} sh install.sh"`,
    };

    return {
      ...this.view(row),
      token,
      serverAddr: `${row.serverHost}:${row.controlPort}`,
      binUrls,
      commands: { linux, windows },
      offline,
    };
  }

  /** Builds (caching) and returns the path to a tunnel-server binary. */
  async ensureServerBinary(platform: string): Promise<string> {
    const target = PLATFORMS[platform];
    if (!target) throw new BadRequestException(`Unknown platform: ${platform}`);
    const agentDir = resolve(process.cwd(), '../../services/agent');
    const distDir = resolve(process.cwd(), '../../services/tunnel-dist/dist');
    const out = join(distDir, `tunnel-server-${platform}${target.ext}`);
    if (existsSync(out)) return out;
    await mkdir(distDir, { recursive: true }).catch(() => undefined);
    this.logger.log(`Building tunnel-server for ${platform}…`);
    const goCmd = process.platform === 'win32' ? 'go.exe' : 'go';
    try {
      await execFileAsync(
        goCmd,
        ['build', '-trimpath', '-ldflags', '-s -w', '-o', out, './cmd/tunnel-server'],
        {
          cwd: agentDir,
          env: {
            ...process.env,
            GOOS: target.goos,
            GOARCH: target.goarch,
            CGO_ENABLED: '0',
          },
        },
      );
    } catch (e) {
      throw new BadRequestException(
        `Failed to build tunnel-server (is Go installed?): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return out;
  }

  /**
   * Mint a short-lived, tamper-proof token authorizing relay-asset downloads.
   * The token is an AES-256-GCM sealed `{exp}` blob (base64url) — no server-side
   * state needed, and it can't be forged without ENCRYPTION_KEY. Embedded into
   * the install command so a fresh VDS fetches assets over `curl`/`iwr` without a
   * panel login, while anonymous access + on-demand build abuse are blocked.
   */
  mintAssetToken(): string {
    const payload = JSON.stringify({
      t: 'tunnel-asset',
      exp: Date.now() + this.assetTokenTtlMs,
    });
    return this.crypto
      .encrypt(payload)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /** Validate an asset token minted by {@link mintAssetToken}. Never throws. */
  verifyAssetToken(token: string | undefined | null): boolean {
    if (!token) return false;
    try {
      let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      const data = JSON.parse(this.crypto.decrypt(b64)) as {
        t?: string;
        exp?: number;
      };
      return (
        data?.t === 'tunnel-asset' &&
        typeof data.exp === 'number' &&
        data.exp > Date.now()
      );
    } catch {
      return false;
    }
  }

  private ports(relayPorts: string): number[] {
    return relayPorts
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0 && n <= 65535);
  }

  private normalizePorts(relayPorts: string): string {
    const ports = this.ports(relayPorts);
    if (ports.length === 0) throw new BadRequestException('Invalid relayPorts');
    return Array.from(new Set(ports)).join(',');
  }

  private view(row: TunnelRow) {
    const rs = this.runner.status(row.id);
    return {
      id: row.id,
      name: row.name,
      serverHost: row.serverHost,
      controlPort: row.controlPort,
      relayPorts: row.relayPorts,
      targetHost: row.targetHost,
      proxyProtocol: row.proxyProtocol,
      enabled: row.enabled,
      status: rs.connected ? 'ONLINE' : row.status,
      lastSeen: row.lastSeen,
      running: rs.running,
      connected: rs.connected,
      createdAt: row.createdAt,
    };
  }
}

/** Asset-token lifetime; override with TUNNEL_ASSET_TOKEN_TTL_MS (default 24h). */
function assetTokenTtlMs(): number {
  const raw = process.env.TUNNEL_ASSET_TOKEN_TTL_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 24 * 60 * 60 * 1000;
}
