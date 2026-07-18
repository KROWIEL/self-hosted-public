import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { eq } from 'drizzle-orm';

const execFileAsync = promisify(execFile);
import { DRIZZLE, Database } from '../../db/database.module';
import { nodes } from '../../db/schema';
import { CryptoService } from '../../common/crypto/crypto.service';
import { NodeRow } from './agent.client';

interface RunningAgent {
  proc: ChildProcess;
  startedAt: Date;
  logs: string[];
}

const LOG_LINES = 200;

/**
 * Dev-only helper that launches the Go agent as a local child process so a node
 * can be started straight from the UI. Disabled unless LOCAL_AGENT_ENABLED=1
 * (spawning processes from an API is unsafe in production).
 */
@Injectable()
export class AgentRunnerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AgentRunnerService.name);
  private readonly running = new Map<string, RunningAgent>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  private get enabled(): boolean {
    return process.env.LOCAL_AGENT_ENABLED === '1';
  }

  /** Restart agents that were active before the panel shut down. */
  async onApplicationBootstrap() {
    if (!this.enabled) return;
    let rows: NodeRow[];
    try {
      rows = (await this.db
        .select()
        .from(nodes)
        .where(eq(nodes.enabled, true))) as NodeRow[];
    } catch (e) {
      this.logger.warn(
        `Auto-start skipped (node query failed): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return;
    }
    for (const node of rows) {
      try {
        await this.start(node);
        this.logger.log(`Auto-started agent for node ${node.name}`);
      } catch (e) {
        this.logger.warn(
          `Auto-start failed for node ${node.name}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }

  private agentDir(): string {
    const override = process.env.AGENT_LOCAL_DIR;
    if (override) return override;
    // control-plane runs with cwd = apps/control-plane
    return resolve(process.cwd(), '../../services/agent');
  }

  isRunning(nodeId: string): boolean {
    return this.running.has(nodeId);
  }

  status(nodeId: string) {
    const a = this.running.get(nodeId);
    return {
      enabled: this.enabled,
      running: !!a,
      startedAt: a?.startedAt ?? null,
      logs: a?.logs ?? [],
    };
  }

  async start(node: NodeRow) {
    if (!this.enabled) {
      throw new BadRequestException(
        'Local agent control is disabled (set LOCAL_AGENT_ENABLED=1).',
      );
    }
    if (this.running.has(node.id)) {
      return this.status(node.id);
    }

    const dir = this.agentDir();
    if (!existsSync(dir)) {
      throw new BadRequestException(`Agent directory not found: ${dir}`);
    }

    const workDir =
      process.env.AGENT_WORKDIR ??
      join(resolve(process.cwd(), '../..'), '.agent-builds');
    await mkdir(workDir, { recursive: true }).catch(() => undefined);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AGENT_PORT: String(node.agentPort),
      AGENT_DAEMON_TOKEN: this.crypto.decrypt(node.daemonToken),
      // Lets the local agent audience-check signed request tokens when the panel
      // starts minting them (agentVersion >= 0.3.0).
      AGENT_NODE_ID: node.id,
      AGENT_WORKDIR: workDir,
      AGENT_NETWORK: process.env.AGENT_NETWORK ?? 'bridge',
      AGENT_TEMPLATES_DIR:
        process.env.AGENT_TEMPLATES_DIR ??
        join(resolve(process.cwd(), '../..'), 'templates'),
      // Dev: publish service ports to the host so apps are reachable at
      // localhost:<port> without a reverse proxy.
      AGENT_PUBLISH_PORTS: process.env.AGENT_PUBLISH_PORTS ?? '1',
    };

    // Spawn the compiled binary directly (no `go run`, which leaves an
    // untracked grandchild and breaks stop/status). Build it once if needed.
    const binary = await this.ensureBinary(dir);

    this.logger.log(`Starting agent for node ${node.name} (${binary})`);
    const proc = spawn(binary, [], { cwd: dir, env });

    const entry: RunningAgent = { proc, startedAt: new Date(), logs: [] };
    const push = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) entry.logs.push(line);
      }
      if (entry.logs.length > LOG_LINES) {
        entry.logs.splice(0, entry.logs.length - LOG_LINES);
      }
    };
    proc.stdout?.on('data', push);
    proc.stderr?.on('data', push);
    proc.on('exit', (code) => {
      this.logger.log(`Agent for node ${node.id} exited (code ${code})`);
      this.running.delete(node.id);
    });
    proc.on('error', (err) => {
      entry.logs.push(`spawn error: ${err.message}`);
      this.running.delete(node.id);
    });

    this.running.set(node.id, entry);
    await this.db
      .update(nodes)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(nodes.id, node.id));
    return this.status(node.id);
  }

  /** Returns a path to the agent binary, building it on first use. */
  private async ensureBinary(dir: string): Promise<string> {
    if (process.env.AGENT_BINARY) return process.env.AGENT_BINARY;
    const out = join(
      dir,
      'bin',
      process.platform === 'win32' ? 'agent.exe' : 'agent',
    );
    if (existsSync(out)) return out;
    await mkdir(join(dir, 'bin'), { recursive: true }).catch(() => undefined);
    this.logger.log('Building agent binary (go build)…');
    const goCmd = process.platform === 'win32' ? 'go.exe' : 'go';
    try {
      await execFileAsync(goCmd, ['build', '-o', out, './cmd/agent'], {
        cwd: dir,
      });
    } catch (e) {
      throw new BadRequestException(
        `Failed to build agent (is Go installed?): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return out;
  }

  async stop(nodeId: string) {
    const a = this.running.get(nodeId);
    if (a) {
      a.proc.kill();
      this.running.delete(nodeId);
    }
    await this.db
      .update(nodes)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(nodes.id, nodeId));
    return { running: false };
  }

  onModuleDestroy() {
    for (const [, a] of this.running) a.proc.kill();
    this.running.clear();
  }
}
