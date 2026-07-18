import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt, isNotNull, isNull, lt } from 'drizzle-orm';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile as cpExecFile } from 'node:child_process';
import os from 'node:os';
import { DRIZZLE, Database } from '../../db/database.module';
import {
  managedDatabases,
  nodeEnrollments,
  nodes,
  projects,
  services,
} from '../../db/schema';
import { CryptoService } from '../../common/crypto/crypto.service';
import { EntitlementsService } from '../../common/licensing/entitlements.service';
import { LicenseErrors, NodeErrors } from '../../common/errors/app-errors';
import { AgentClient } from './agent.client';

interface CreateNodeInput {
  name: string;
  fqdn: string;
  agentPort?: number;
  cpuTotal?: number;
  memTotal?: number;
}

const execFileAsync = promisify(cpExecFile);

// A remote node is considered offline if no heartbeat arrived within this window.
const HEARTBEAT_TIMEOUT_MS = 90_000;
// One-time join tokens are short-lived.
const JOIN_TOKEN_TTL_MS = 60 * 60 * 1000;

const AGENT_PLATFORMS: Record<
  string,
  { goos: string; goarch: string; ext: string }
> = {
  'linux-amd64': { goos: 'linux', goarch: 'amd64', ext: '' },
  'linux-arm64': { goos: 'linux', goarch: 'arm64', ext: '' },
};

@Injectable()
export class NodesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NodesService.name);
  private sweeper?: ReturnType<typeof setInterval>;
  // Coalesces concurrent on-demand agent builds per platform so the public
  // binary endpoint can't be spammed into launching many parallel Go builds.
  private readonly buildLocks = new Map<string, Promise<string>>();
  private readonly assetTokenTtlMs = agentAssetTokenTtlMs();

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly agent: AgentClient,
    private readonly entitlements: EntitlementsService,
  ) {}

  onModuleInit() {
    // Periodically flip stale remote nodes to OFFLINE (missed heartbeats).
    this.sweeper = setInterval(() => {
      this.markStaleOffline().catch((e) =>
        this.logger.warn(
          `offline sweep failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  list() {
    return this.db.select().from(nodes).orderBy(nodes.createdAt);
  }

  /**
   * Enforce the tier's node cap before creating another node. `null` = unlimited
   * (Pro). Counts every node (local + remote) since the cap is per installation.
   */
  private async assertNodeQuota(): Promise<void> {
    const { maxNodes } = await this.entitlements.limits();
    if (maxNodes == null) return;
    const existing = await this.db.select({ id: nodes.id }).from(nodes);
    if (existing.length >= maxNodes) throw LicenseErrors.nodeLimit(maxNodes);
  }

  async create(input: CreateNodeInput) {
    await this.assertNodeQuota();
    const daemonToken = randomBytes(32).toString('hex');
    const hostCpu = os.cpus().length * 100;
    const hostMemMb = Math.floor(os.totalmem() / 1024 / 1024);
    const rows = await this.db
      .insert(nodes)
      .values({
        name: input.name,
        fqdn: input.fqdn,
        agentPort: input.agentPort ?? 8443,
        cpuTotal: input.cpuTotal ?? hostCpu,
        memTotal: input.memTotal ?? hostMemMb,
        daemonToken: this.crypto.encrypt(daemonToken),
      })
      .returning();
    // Return the plaintext token ONCE so the operator can configure the agent.
    return { ...rows[0], daemonTokenPlaintext: daemonToken };
  }

  /**
   * Registers a remote node (installed on another server). No usable daemon
   * token yet — the agent provisions one during self-enrollment. Returns a
   * one-time join token the operator passes to the install command.
   */
  async createRemote(input: { name: string; fqdn: string; agentPort?: number }) {
    await this.assertNodeQuota();
    // Placeholder token; replaced by a real one when the agent enrolls.
    const placeholder = randomBytes(32).toString('hex');
    const [node] = await this.db
      .insert(nodes)
      .values({
        name: input.name,
        fqdn: input.fqdn,
        agentPort: input.agentPort ?? 8443,
        daemonToken: this.crypto.encrypt(placeholder),
        status: 'OFFLINE',
        remote: true,
      })
      .returning();
    return node;
  }

  /** Issues (or re-issues) a one-time enrollment token for a node. */
  async issueJoinToken(nodeId: string): Promise<string> {
    await this.get(nodeId);
    const token = randomBytes(24).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.db.insert(nodeEnrollments).values({
      nodeId,
      tokenHash,
      expiresAt: new Date(Date.now() + JOIN_TOKEN_TTL_MS),
    });
    return token;
  }

  /**
   * Agent self-enrollment: validate the one-time join token, then provision a
   * long-lived daemon token and pin the agent's TLS fingerprint on the node.
   */
  async enroll(input: {
    joinToken: string;
    fingerprint: string;
    version?: string;
    agentPort?: number;
  }) {
    const tokenHash = createHash('sha256')
      .update(input.joinToken)
      .digest('hex');
    const [row] = await this.db
      .select()
      .from(nodeEnrollments)
      .where(
        and(
          eq(nodeEnrollments.tokenHash, tokenHash),
          isNull(nodeEnrollments.usedAt),
          gt(nodeEnrollments.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) throw new BadRequestException('Invalid or expired join token');

    const daemonToken = randomBytes(32).toString('hex');
    const patch: Partial<typeof nodes.$inferInsert> = {
      daemonToken: this.crypto.encrypt(daemonToken),
      tlsFingerprint: input.fingerprint.toLowerCase().replace(/:/g, ''),
      agentVersion: input.version ?? null,
      status: 'ONLINE',
      enabled: true,
      lastSeen: new Date(),
      updatedAt: new Date(),
    };
    if (input.agentPort) patch.agentPort = input.agentPort;

    await this.db.update(nodes).set(patch).where(eq(nodes.id, row.nodeId));
    await this.db
      .update(nodeEnrollments)
      .set({ usedAt: new Date() })
      .where(eq(nodeEnrollments.id, row.id));
    this.logger.log(`Node ${row.nodeId} enrolled (agent ${input.version ?? '?'})`);
    return { nodeId: row.nodeId, daemonToken };
  }

  /**
   * Agent liveness ping. Authorized by the node's provisioned daemon token. A
   * rotating node's previous secret is also accepted during the migration
   * window; once the agent heartbeats with the CURRENT secret the rotation has
   * converged, so the previous secret is retired.
   */
  async heartbeat(nodeId: string, token: string, version?: string) {
    const node = await this.get(nodeId);
    const current = this.crypto.decrypt(node.daemonToken);
    const prev = node.daemonTokenPrev
      ? this.crypto.decrypt(node.daemonTokenPrev)
      : '';
    const matchesCurrent = safeStrEqual(token, current);
    const matchesPrev = prev ? safeStrEqual(token, prev) : false;
    if (!matchesCurrent && !matchesPrev) {
      throw new UnauthorizedException();
    }
    const patch: Partial<typeof nodes.$inferInsert> = {
      status: 'ONLINE',
      lastSeen: new Date(),
      agentVersion: version ?? node.agentVersion,
      updatedAt: new Date(),
    };
    // The agent now presents the new secret -> rotation converged; drop the old.
    if (matchesCurrent && node.daemonTokenPrev) {
      patch.daemonTokenPrev = null;
      patch.daemonTokenRotatedAt = null;
    }
    await this.db.update(nodes).set(patch).where(eq(nodes.id, nodeId));
    return { ok: true };
  }

  /**
   * Rotates the node's long-lived daemon secret. The new secret is pushed to the
   * agent FIRST (authenticated with the current secret); only after the agent
   * confirms does the panel persist the switch, keeping the old secret as
   * `daemonTokenPrev` for a migration window. This ordering guarantees a failed
   * push (agent down, or a legacy agent without the endpoint) never locks a node
   * out — the DB, and therefore the secret in use, is left untouched.
   */
  async rotateDaemonToken(nodeId: string) {
    const node = await this.get(nodeId);
    const oldToken = this.crypto.decrypt(node.daemonToken);
    const newToken = randomBytes(32).toString('hex');

    const res = await this.agent.rotate(node, newToken);
    if (!res.ok) {
      if (res.status === 404) throw NodeErrors.rotationUnsupported(node.name);
      throw NodeErrors.agentRequestFailed(node.name, res.status);
    }

    const rotatedAt = new Date();
    await this.db
      .update(nodes)
      .set({
        daemonToken: this.crypto.encrypt(newToken),
        daemonTokenPrev: this.crypto.encrypt(oldToken),
        daemonTokenRotatedAt: rotatedAt,
        updatedAt: rotatedAt,
      })
      .where(eq(nodes.id, nodeId));
    this.logger.log(`Node ${nodeId} daemon token rotated`);
    return { ok: true, rotatedAt };
  }

  /** Connection details + a ready-to-paste one-liner install command. */
  async installInfo(nodeId: string, origin: string) {
    const node = await this.get(nodeId);
    const joinToken = await this.issueJoinToken(nodeId);
    return this.buildInstall(node, joinToken, origin);
  }

  private buildInstall(
    node: typeof nodes.$inferSelect,
    joinToken: string,
    origin: string,
  ) {
    const base = origin.replace(/\/$/, '');
    // Gate the binary + install-script downloads behind a short-lived signed
    // token so they aren't anonymously reachable (L3).
    const at = this.mintAssetToken();
    const binUrls = Object.fromEntries(
      Object.keys(AGENT_PLATFORMS).map((p) => [
        p,
        `${base}/api/v1/node-agent/bin/${p}?t=${at}`,
      ]),
    );
    const shUrl = `${base}/api/v1/node-agent/install.sh?t=${at}`;
    const env =
      `PANEL_URL=${base} JOIN_TOKEN=${joinToken} ` +
      `AGENT_PORT=${node.agentPort}`;
    const linux =
      `curl -fsSL "${shUrl}" -o install.sh && ` +
      `sudo ${env} BIN_URL="${binUrls['linux-amd64']}" sh install.sh`;
    return {
      nodeId: node.id,
      joinToken,
      agentPort: node.agentPort,
      binUrls,
      commands: { linux },
    };
  }

  /** Builds (caching) and returns the path to a Linux agent binary. */
  async ensureAgentBinary(platform: string): Promise<string> {
    const target = AGENT_PLATFORMS[platform];
    if (!target) throw new BadRequestException(`Unknown platform: ${platform}`);
    const distDir = resolve(process.cwd(), '../../services/agent-dist/dist');
    const out = join(distDir, `selfhosted-agent-${platform}${target.ext}`);
    if (existsSync(out)) return out;
    // Share a single build across concurrent requests for the same platform.
    const inflight = this.buildLocks.get(platform);
    if (inflight) return inflight;
    const build = this.buildAgentBinary(platform, target, distDir, out).finally(
      () => this.buildLocks.delete(platform),
    );
    this.buildLocks.set(platform, build);
    return build;
  }

  private async buildAgentBinary(
    platform: string,
    target: { goos: string; goarch: string; ext: string },
    distDir: string,
    out: string,
  ): Promise<string> {
    const agentDir = resolve(process.cwd(), '../../services/agent');
    await mkdir(distDir, { recursive: true }).catch(() => undefined);
    this.logger.log(`Building agent for ${platform}…`);
    const goCmd = process.platform === 'win32' ? 'go.exe' : 'go';
    try {
      await execFileAsync(
        goCmd,
        ['build', '-trimpath', '-ldflags', '-s -w', '-o', out, './cmd/agent'],
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
        `Failed to build agent (is Go installed?): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return out;
  }

  /**
   * Mints a short-lived, tamper-proof token that gates the anonymous agent
   * binary + install-script endpoints (L3). Mirrors the tunnel-assets pattern:
   * the panel embeds it in the copy-paste install command so a fresh node can
   * fetch artifacts with a single curl — without a panel login — while blocking
   * anonymous access and on-demand build abuse.
   */
  mintAssetToken(): string {
    const payload = JSON.stringify({
      t: 'node-asset',
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
        data?.t === 'node-asset' &&
        typeof data.exp === 'number' &&
        data.exp > Date.now()
      );
    } catch {
      return false;
    }
  }

  /** Flip remote nodes (those with a pinned fingerprint) to OFFLINE if stale. */
  async markStaleOffline() {
    const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
    await this.db
      .update(nodes)
      .set({ status: 'OFFLINE', updatedAt: new Date() })
      .where(
        and(
          eq(nodes.status, 'ONLINE'),
          isNotNull(nodes.tlsFingerprint),
          lt(nodes.lastSeen, cutoff),
        ),
      );
  }

  async get(id: string) {
    const rows = await this.db
      .select()
      .from(nodes)
      .where(eq(nodes.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Node not found');
    return rows[0];
  }

  async configuration(id: string) {
    const node = await this.get(id);
    return {
      nodeId: node.id,
      agentPort: node.agentPort,
      panelPublicKey: node.publicKey,
    };
  }

  async remove(id: string) {
    await this.get(id);
    await this.db.delete(nodes).where(eq(nodes.id, id));
    return { ok: true };
  }

  async updateCapacity(
    id: string,
    input: { cpuTotal: number; memTotal: number },
  ) {
    await this.get(id);
    const rows = await this.db
      .update(nodes)
      .set({
        cpuTotal: input.cpuTotal,
        memTotal: input.memTotal,
        updatedAt: new Date(),
      })
      .where(eq(nodes.id, id))
      .returning();
    return rows[0];
  }

  /** Live Docker-level metrics from the node's agent (reachable only if up). */
  async systemInfo(id: string) {
    const node = await this.get(id);
    try {
      return await this.agent.getSystem(node);
    } catch (e) {
      // Don't leak agent/Docker internals to the client — log and return a
      // generic reachability flag (L5).
      this.logger.warn(
        `systemInfo(${id}) failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        version: 'unreachable',
        reachable: false,
        error: 'unreachable',
      };
    }
  }

  /** Aggregate live CPU/RAM usage across all containers on the node. */
  async stats(id: string) {
    const node = await this.get(id);
    try {
      return await this.agent.getNodeStats(node);
    } catch {
      return { reachable: false, cpuPerc: 0, memUsageMb: 0, containers: 0 };
    }
  }

  /** OS-level host metrics (CPU load, RAM, disk) from the node's agent. */
  async host(id: string) {
    const node = await this.get(id);
    try {
      return { reachable: true, ...(await this.agent.getHost(node)) };
    } catch (e) {
      this.logger.warn(
        `host(${id}) failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        reachable: false,
        error: 'unreachable',
      };
    }
  }

  /** Reclaims disk on the node via docker prune (manual cleanup button). */
  async prune(id: string, opts: { all?: boolean; volumes?: boolean }) {
    const node = await this.get(id);
    return this.agent.prune(node, opts);
  }

  /** Services and managed databases hosted on this node (for the node card). */
  async workloads(id: string) {
    await this.get(id);
    const svc = await this.db
      .select({
        id: services.id,
        name: services.name,
        type: services.type,
        status: services.status,
        projectId: services.projectId,
        projectName: projects.name,
      })
      .from(services)
      .leftJoin(projects, eq(services.projectId, projects.id))
      .where(eq(services.nodeId, id))
      .orderBy(services.name);
    const dbs = await this.db
      .select({
        id: managedDatabases.id,
        name: managedDatabases.name,
        engine: managedDatabases.engine,
        status: managedDatabases.status,
        projectId: managedDatabases.projectId,
        projectName: projects.name,
      })
      .from(managedDatabases)
      .leftJoin(projects, eq(managedDatabases.projectId, projects.id))
      .where(eq(managedDatabases.nodeId, id))
      .orderBy(managedDatabases.name);
    return { services: svc, databases: dbs };
  }
}

/** Constant-time string comparison with a length guard (avoids leaking length). */
function safeStrEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Agent asset-token lifetime; override with NODE_ASSET_TOKEN_TTL_MS (default 24h). */
function agentAssetTokenTtlMs(): number {
  const raw = process.env.NODE_ASSET_TOKEN_TTL_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 24 * 60 * 60 * 1000;
}
