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

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly agent: AgentClient,
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

  async create(input: CreateNodeInput) {
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

  /** Agent liveness ping. Authorized by the node's provisioned daemon token. */
  async heartbeat(nodeId: string, token: string, version?: string) {
    const node = await this.get(nodeId);
    const expected = this.crypto.decrypt(node.daemonToken);
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
    await this.db
      .update(nodes)
      .set({
        status: 'ONLINE',
        lastSeen: new Date(),
        agentVersion: version ?? node.agentVersion,
        updatedAt: new Date(),
      })
      .where(eq(nodes.id, nodeId));
    return { ok: true };
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
    const binUrls = Object.fromEntries(
      Object.keys(AGENT_PLATFORMS).map((p) => [
        p,
        `${base}/api/v1/node-agent/bin/${p}`,
      ]),
    );
    const env =
      `PANEL_URL=${base} JOIN_TOKEN=${joinToken} ` +
      `AGENT_PORT=${node.agentPort}`;
    const linux =
      `curl -fsSL ${base}/api/v1/node-agent/install.sh -o install.sh && ` +
      `sudo ${env} BIN_URL=${binUrls['linux-amd64']} sh install.sh`;
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
    const agentDir = resolve(process.cwd(), '../../services/agent');
    const distDir = resolve(process.cwd(), '../../services/agent-dist/dist');
    const out = join(distDir, `selfhosted-agent-${platform}${target.ext}`);
    if (existsSync(out)) return out;
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
      return {
        version: 'unreachable',
        reachable: false,
        error: e instanceof Error ? e.message : String(e),
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
      return {
        reachable: false,
        error: e instanceof Error ? e.message : String(e),
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
