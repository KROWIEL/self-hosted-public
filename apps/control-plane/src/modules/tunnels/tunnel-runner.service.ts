import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ChildProcess, spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface RunningTunnel {
  proc: ChildProcess;
  startedAt: Date;
  logs: string[];
  connected: boolean;
}

const LOG_LINES = 200;

export interface TunnelClientParams {
  id: string;
  serverAddr: string; // host:port
  token: string;
  targets: Record<number, string>; // port -> host:port
  proxyProtocol: boolean;
  fingerprint?: string | null;
}

/**
 * Dev-only helper that launches the Go tunnel CLIENT as a local child process
 * (it must run next to the local Traefik). Disabled unless LOCAL_AGENT_ENABLED=1;
 * in production the client runs as a real system service.
 */
@Injectable()
export class TunnelRunnerService implements OnModuleDestroy {
  private readonly logger = new Logger(TunnelRunnerService.name);
  private readonly running = new Map<string, RunningTunnel>();

  private get enabled(): boolean {
    return process.env.LOCAL_AGENT_ENABLED === '1';
  }

  private agentDir(): string {
    const override = process.env.AGENT_LOCAL_DIR;
    if (override) return override;
    return resolve(process.cwd(), '../../services/agent');
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  status(id: string) {
    const t = this.running.get(id);
    return {
      enabled: this.enabled,
      running: !!t,
      connected: t?.connected ?? false,
      startedAt: t?.startedAt ?? null,
      logs: t?.logs ?? [],
    };
  }

  async start(params: TunnelClientParams) {
    if (!this.enabled) {
      throw new BadRequestException(
        'Local tunnel control is disabled (set LOCAL_AGENT_ENABLED=1).',
      );
    }
    if (this.running.has(params.id)) return this.status(params.id);

    const dir = this.agentDir();
    if (!existsSync(dir)) {
      throw new BadRequestException(`Agent directory not found: ${dir}`);
    }

    const args = [
      '--server',
      params.serverAddr,
      '--token',
      params.token,
    ];
    for (const [port, target] of Object.entries(params.targets)) {
      args.push('--map', `${port}=${target}`);
    }
    if (params.proxyProtocol) args.push('--proxy-protocol');
    if (params.fingerprint) args.push('--fingerprint', params.fingerprint);

    const binary = await this.ensureClientBinary(dir);
    this.logger.log(`Starting tunnel client ${params.id} → ${params.serverAddr}`);
    const proc = spawn(binary, args, { cwd: dir, env: { ...process.env } });

    const entry: RunningTunnel = {
      proc,
      startedAt: new Date(),
      logs: [],
      connected: false,
    };
    const push = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        entry.logs.push(line);
        if (line.includes('tunnel connected')) entry.connected = true;
        if (line.includes('link down')) entry.connected = false;
      }
      if (entry.logs.length > LOG_LINES) {
        entry.logs.splice(0, entry.logs.length - LOG_LINES);
      }
    };
    proc.stdout?.on('data', push);
    proc.stderr?.on('data', push);
    proc.on('exit', (code) => {
      this.logger.log(`Tunnel client ${params.id} exited (code ${code})`);
      this.running.delete(params.id);
    });
    proc.on('error', (err) => {
      entry.logs.push(`spawn error: ${err.message}`);
      this.running.delete(params.id);
    });

    this.running.set(params.id, entry);
    return this.status(params.id);
  }

  stop(id: string) {
    const t = this.running.get(id);
    if (t) {
      t.proc.kill();
      this.running.delete(id);
    }
    return this.status(id);
  }

  /** Builds (once) and returns the host-platform tunnel-client binary path. */
  private async ensureClientBinary(dir: string): Promise<string> {
    const out = join(
      dir,
      'bin',
      process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client',
    );
    if (existsSync(out)) return out;
    await mkdir(join(dir, 'bin'), { recursive: true }).catch(() => undefined);
    this.logger.log('Building tunnel-client binary (go build)…');
    const goCmd = process.platform === 'win32' ? 'go.exe' : 'go';
    try {
      await execFileAsync(goCmd, ['build', '-o', out, './cmd/tunnel-client'], {
        cwd: dir,
      });
    } catch (e) {
      throw new BadRequestException(
        `Failed to build tunnel-client (is Go installed?): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return out;
  }

  onModuleDestroy() {
    for (const t of this.running.values()) t.proc.kill();
    this.running.clear();
  }
}
