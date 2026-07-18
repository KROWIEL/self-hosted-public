import { Injectable, Logger } from '@nestjs/common';
import { PowerAction } from '@selfhosted/shared';
import { Agent } from 'undici';
import { connect as tlsConnect } from 'node:tls';
import { nodes } from '../../db/schema';
import { NodeErrors } from '../../common/errors/app-errors';
import { AgentTokenService } from './agent-token.service';

export type NodeRow = typeof nodes.$inferSelect;

// The dispatcher type accepted by Node's global fetch (from undici-types).
type FetchDispatcher = NonNullable<Parameters<typeof fetch>[1]>['dispatcher'];

export interface AgentBuildInput {
  serviceId: string;
  repoUrl: string;
  branch: string;
  patToken?: string;
  gitUsername?: string;
  /** Image with build tooling (maven/node). Passed as a Docker build-arg. */
  buildImage: string;
  /** Runtime base image. Passed as a Docker build-arg. */
  runImage: string;
  /** Template Dockerfile path (relative to the agent templates dir). */
  dockerfile?: string;
  /** Prefer the repo's own Dockerfile (if present) over the template. */
  useRepoDockerfile?: boolean;
  imageTag: string;
}

export interface AgentBuildResult {
  commitSha: string;
  imageTag: string;
  buildLog: string;
}

export interface AgentSystem {
  version: string;
  containersRunning?: number;
  containersTotal?: number;
  imagesCount?: string;
  imagesSize?: string;
  imagesReclaimable?: string;
  volumesSize?: string;
  buildCacheSize?: string;
}

export interface AgentPruneResult {
  ok: boolean;
  error?: string;
  system?: string;
  builder?: string;
  volumes?: string;
  imagesReclaimable?: string;
}

export interface AgentNodeStats {
  reachable: boolean;
  /** Aggregate CPU across all containers, in Docker units (100 = one core). */
  cpuPerc: number;
  /** Aggregate used memory across all containers, in MB. */
  memUsageMb: number;
  containers: number;
}

/** OS-level host metrics (fields present depend on the node's platform). */
export interface AgentHost {
  cpuCores: number;
  load1?: number;
  load5?: number;
  load15?: number;
  /** Direct CPU utilisation 0-100 (portable; set on platforms without load avg). */
  cpuUsedPerc?: number;
  memTotalMb?: number;
  memUsedMb?: number;
  memUsedPerc?: number;
  diskTotalGb?: number;
  diskUsedGb?: number;
  diskUsedPerc?: number;
}

export interface AgentStats {
  running: boolean;
  state: string;
  health?: string;
  cpuPerc?: string;
  memUsage?: string;
  memPerc?: string;
  netIO?: string;
  blockIO?: string;
  pids?: string;
}

export interface AgentVolumeMount {
  name: string;
  mountPath: string;
}

export interface AgentRunInput {
  serviceId: string;
  image: string;
  port: number;
  cpuLimit: number;
  memLimit: number;
  env: Record<string, string>;
  domain?: string;
  https?: boolean;
  network?: string;
  volumes?: AgentVolumeMount[];
  /** Blue-green color ('blue' | 'green'); omit for legacy single-container run. */
  color?: string;
  /** Adds a Traefik LB healthcheck so the proxy skips a still-starting backend. */
  healthPath?: string;
}

export interface AgentComposeInput {
  serviceId: string;
  repoUrl?: string;
  branch?: string;
  composeFile?: string;
  composeYaml?: string;
  patToken?: string;
  env: Record<string, string>;
  projectName?: string;
  domain?: string;
  https?: boolean;
}

export interface AgentHealthInput {
  serviceId: string;
  color?: string;
  port: number;
  path?: string;
  network?: string;
  timeoutS?: number;
}

export interface AgentHealthResult {
  ok: boolean;
  healthy: boolean;
  code: number;
  error?: string;
}

export interface AgentDbCreateInput {
  container: string;
  volume: string;
  image: string;
  network?: string;
  dataDir: string;
  internalPort: number;
  env: Record<string, string>;
}

export interface AgentDbStatus {
  running: boolean;
  state: string;
  ready: boolean;
}

export interface AgentInspectInput {
  repoUrl: string;
  branch: string;
  patToken?: string;
  workId: string;
}

export interface AgentEnvKey {
  key: string;
  example: string;
  dbRole?: 'url' | 'host' | 'port' | 'name' | 'user' | 'password';
  dbName?: string;
}

export interface AgentDatabaseNeed {
  engine: 'POSTGRES' | 'MYSQL';
  schemas: string[];
}

export interface AgentInspectResult {
  envFile: string;
  envKeys: AgentEnvKey[];
  databases: AgentDatabaseNeed[];
}

export interface AgentSchemaInput {
  container: string;
  engine: string;
  user: string;
  password: string;
  schema: string;
}

export interface AgentBackupInput {
  kind: 'VOLUME' | 'DATABASE';
  file: string;
  volume?: string;
  container?: string;
  engine?: string;
  user?: string;
  password?: string;
  dbName?: string;
}

/**
 * Thin HTTP client the control plane uses to talk to a node agent.
 * Requests are authorized with the node's daemon token (decrypted at call time).
 * Set AGENT_INSECURE_HTTP=1 for local dev against an http agent.
 */
@Injectable()
export class AgentClient {
  private readonly logger = new Logger(AgentClient.name);

  constructor(private readonly agentToken: AgentTokenService) {}

  // Per-node undici dispatchers that pin the agent's self-signed cert by its
  // SHA-256 fingerprint (captured at enrollment). Cached to reuse connections.
  private readonly dispatchers = new Map<string, Agent>();

  private baseUrl(node: NodeRow): string {
    const scheme = process.env.AGENT_INSECURE_HTTP === '1' ? 'http' : 'https';
    return `${scheme}://${node.fqdn}:${node.agentPort}/api`;
  }

  /**
   * Returns a fetch dispatcher that verifies the node's pinned TLS fingerprint.
   * Undefined for local http dev or nodes that haven't enrolled a fingerprint
   * yet (in which case standard TLS verification applies).
   */
  private dispatcher(node: NodeRow): FetchDispatcher {
    if (process.env.AGENT_INSECURE_HTTP === '1') return undefined;
    if (!node.tlsFingerprint) return undefined;
    const key = `${node.fqdn}:${node.agentPort}:${node.tlsFingerprint}`;
    const cached = this.dispatchers.get(key);
    if (cached) return cached as unknown as FetchDispatcher;
    const expected = node.tlsFingerprint.toLowerCase().replace(/:/g, '');
    const agent = new Agent({
      connect: (opts, cb) => {
        const socket = tlsConnect(
          {
            host: opts.hostname,
            port: Number(opts.port),
            servername: node.fqdn,
            rejectUnauthorized: false,
          },
          () => {
            const fp = (socket.getPeerCertificate().fingerprint256 || '')
              .toLowerCase()
              .replace(/:/g, '');
            if (fp !== expected) {
              socket.destroy();
              cb(new Error(`agent ${node.name}: TLS fingerprint mismatch`), null);
              return;
            }
            cb(null, socket);
          },
        );
        socket.on('error', (err) => cb(err, null));
      },
    });
    this.dispatchers.set(key, agent);
    // The `undici` package's Agent type differs nominally from the Dispatcher
    // baked into Node's global fetch (undici-types); they are compatible at
    // runtime, so bridge the type here.
    return agent as unknown as FetchDispatcher;
  }

  /**
   * Wraps `fetch` so a network-level failure (agent down, connection refused,
   * DNS/TLS error) surfaces as a coded, localized "agent unreachable" error
   * instead of a bare `TypeError: fetch failed` that becomes a generic 500.
   */
  private async doFetch(
    node: NodeRow,
    input: string,
    init: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    try {
      return await fetch(input, init);
    } catch {
      throw NodeErrors.agentUnreachable(node.name);
    }
  }

  private async request<T>(
    node: NodeRow,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const token = this.agentToken.authToken(node);
    const init2 = {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
      dispatcher: this.dispatcher(node),
    };
    const res = await this.doFetch(node, `${this.baseUrl(node)}${path}`, init2);
    if (!res.ok) {
      // The upstream body can carry agent/Docker internals — log it server-side
      // but surface only a generic, coded error to the caller (L5).
      const body = await res.text().catch(() => '');
      this.logger.warn(
        `Agent ${node.name} ${path} responded ${res.status}: ${body}`,
      );
      throw NodeErrors.agentRequestFailed(node.name, res.status);
    }
    return (await res.json()) as T;
  }

  getSystem(node: NodeRow) {
    return this.request<AgentSystem>(node, '/system');
  }

  /** Aggregate live CPU/RAM usage across all containers on the node. */
  getNodeStats(node: NodeRow) {
    return this.request<AgentNodeStats>(node, '/stats');
  }

  /** OS-level host metrics: CPU cores/load, RAM, disk. */
  getHost(node: NodeRow) {
    return this.request<AgentHost>(node, '/host');
  }

  /** Reclaims disk on the node (docker system/builder/volume prune). */
  prune(node: NodeRow, opts: { all?: boolean; volumes?: boolean } = {}) {
    return this.request<AgentPruneResult>(node, '/system/prune', {
      method: 'POST',
      body: JSON.stringify({ all: !!opts.all, volumes: !!opts.volumes }),
    });
  }

  /** Clones the repo on the node and detects env keys + databases. */
  inspect(node: NodeRow, input: AgentInspectInput) {
    return this.request<AgentInspectResult>(node, '/inspect', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** Creates an additional schema inside an existing managed DB container. */
  createSchema(node: NodeRow, input: AgentSchemaInput) {
    return this.request<{ ok: boolean; error?: string }>(
      node,
      '/databases/schema',
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  /**
   * Elevates the managed DB's app user so it can create/manage additional
   * schemas at runtime (multi-tenant apps). Scoped to the dedicated container.
   */
  grantPrivileges(
    node: NodeRow,
    input: { container: string; engine: string; user: string; password: string },
  ) {
    return this.request<{ ok: boolean; error?: string }>(
      node,
      '/databases/grant',
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  getStats(node: NodeRow, serviceId: string) {
    return this.request<AgentStats>(node, `/servers/${serviceId}/stats`);
  }

  /** Removes stale images of a service, keeping `keepImage`. Best-effort. */
  gc(node: NodeRow, serviceId: string, keepImage: string) {
    return this.request<{ ok: boolean; removed: number }>(
      node,
      `/servers/${serviceId}/gc`,
      { method: 'POST', body: JSON.stringify({ keepImage }) },
    );
  }

  /**
   * Triggers a build on the node. The agent streams build output as
   * newline-delimited text and ends with a single JSON result line.
   *
   * When `onChunk` is supplied, build output lines are forwarded live as they
   * arrive (the trailing JSON result line is held back and never emitted).
   */
  async build(
    node: NodeRow,
    input: AgentBuildInput,
    onChunk?: (text: string) => void,
  ): Promise<AgentBuildResult> {
    const token = this.agentToken.authToken(node);
    const res = await this.doFetch(
      node,
      `${this.baseUrl(node)}/servers/${input.serviceId}/build`,
      {
        method: 'POST',
        dispatcher: this.dispatcher(node),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          repoUrl: input.repoUrl,
          branch: input.branch,
          patToken: input.patToken ?? '',
          gitUsername: input.gitUsername ?? '',
          buildImage: input.buildImage,
          runImage: input.runImage,
          dockerfile: input.dockerfile ?? '',
          useRepoDockerfile: input.useRepoDockerfile ?? false,
          imageTag: input.imageTag,
        }),
      },
    );

    const text = await this.readBuildStream(res, onChunk);
    if (!res.ok) {
      throw new Error(`Agent ${node.name} build HTTP ${res.status}: ${text}`);
    }

    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    const last = lines[lines.length - 1] ?? '{}';
    let result: { commitSha?: string; error?: string };
    try {
      result = JSON.parse(last);
    } catch {
      throw new Error(`Agent ${node.name} build: malformed response`);
    }
    const buildLog = lines.slice(0, -1).join('\n');
    if (result.error) {
      const err = new Error(result.error) as Error & { buildLog?: string };
      err.buildLog = buildLog;
      throw err;
    }
    return {
      commitSha: result.commitSha ?? '',
      imageTag: input.imageTag,
      buildLog,
    };
  }

  /**
   * Reads the full build response, optionally forwarding completed output lines
   * to `onChunk` as they stream in. The final JSON result line is withheld (a
   * one-line lag) so callers never see the machine-readable result in the log.
   */
  private async readBuildStream(
    res: Response,
    onChunk?: (text: string) => void,
  ): Promise<string> {
    if (!res.body) return res.text();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buf = '';
    let held: string | null = null;
    const flushHeld = () => {
      if (held !== null) {
        onChunk?.(held + '\n');
        held = null;
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const decoded = decoder.decode(value, { stream: true });
      full += decoded;
      if (!onChunk) continue;
      buf += decoded;
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const line of parts) {
        flushHeld();
        held = line;
      }
    }
    return full;
  }

  run(node: NodeRow, input: AgentRunInput) {
    return this.request<{ ok: boolean; containerId: string; error?: string }>(
      node,
      `/servers/${input.serviceId}/run`,
      {
        method: 'POST',
        body: JSON.stringify({
          image: input.image,
          port: input.port,
          cpuLimit: input.cpuLimit,
          memLimit: input.memLimit,
          env: input.env,
          domain: input.domain ?? '',
          https: input.https ?? false,
          network: input.network ?? '',
          volumes: input.volumes ?? [],
          color: input.color ?? '',
          healthPath: input.healthPath ?? '',
        }),
      },
    );
  }

  /** Pull + run a pre-built image (no git build). Same shape as {@link run}. */
  runImage(node: NodeRow, input: AgentRunInput) {
    return this.request<{
      ok: boolean;
      containerId: string;
      error?: string;
      log?: string;
    }>(node, `/servers/${input.serviceId}/run-image`, {
      method: 'POST',
      body: JSON.stringify({
        image: input.image,
        port: input.port,
        cpuLimit: input.cpuLimit,
        memLimit: input.memLimit,
        env: input.env,
        domain: input.domain ?? '',
        https: input.https ?? false,
        network: input.network ?? '',
        volumes: input.volumes ?? [],
        color: input.color ?? '',
        healthPath: input.healthPath ?? '',
      }),
    });
  }

  /**
   * Clone (or write inline YAML) and `docker compose up -d --build`. Streams
   * NDJSON logs like {@link build}.
   */
  async composeUp(
    node: NodeRow,
    input: AgentComposeInput,
    onChunk?: (text: string) => void,
  ): Promise<{ projectName: string; buildLog: string }> {
    const token = this.agentToken.authToken(node);
    const res = await this.doFetch(
      node,
      `${this.baseUrl(node)}/servers/${input.serviceId}/compose`,
      {
        method: 'POST',
        dispatcher: this.dispatcher(node),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          repoUrl: input.repoUrl ?? '',
          branch: input.branch ?? 'main',
          composeFile: input.composeFile ?? 'docker-compose.yml',
          composeYaml: input.composeYaml ?? '',
          patToken: input.patToken ?? '',
          env: input.env,
          projectName: input.projectName ?? '',
          domain: input.domain ?? '',
          https: input.https ?? false,
        }),
      },
    );

    const text = await this.readBuildStream(res, onChunk);
    if (!res.ok) {
      throw new Error(`Agent ${node.name} compose HTTP ${res.status}: ${text}`);
    }
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    const last = lines[lines.length - 1] ?? '{}';
    let result: { ok?: boolean; projectName?: string; error?: string };
    try {
      result = JSON.parse(last);
    } catch {
      throw new Error(`Agent ${node.name} compose: malformed response`);
    }
    const buildLog = lines.slice(0, -1).join('\n');
    if (result.error || result.ok === false) {
      const err = new Error(result.error ?? 'compose failed') as Error & {
        buildLog?: string;
      };
      err.buildLog = buildLog;
      throw err;
    }
    return {
      projectName: result.projectName ?? input.projectName ?? '',
      buildLog,
    };
  }

  composeDown(
    node: NodeRow,
    serviceId: string,
    opts: { projectName?: string; removeVolumes?: boolean } = {},
  ) {
    return this.request<{ ok: boolean; error?: string }>(
      node,
      `/servers/${serviceId}/compose/down`,
      {
        method: 'POST',
        body: JSON.stringify({
          projectName: opts.projectName ?? '',
          removeVolumes: !!opts.removeVolumes,
        }),
      },
    );
  }

  composePower(
    node: NodeRow,
    serviceId: string,
    action: string,
    projectName?: string,
  ) {
    return this.request<{ ok: boolean; error?: string }>(
      node,
      `/servers/${serviceId}/compose/power`,
      {
        method: 'POST',
        body: JSON.stringify({
          projectName: projectName ?? '',
          action: action.toLowerCase(),
        }),
      },
    );
  }

  /** Single HTTP health probe of a color instance from inside the node network. */
  health(node: NodeRow, input: AgentHealthInput) {
    return this.request<AgentHealthResult>(
      node,
      `/servers/${input.serviceId}/health`,
      {
        method: 'POST',
        body: JSON.stringify({
          color: input.color ?? '',
          port: input.port,
          path: input.path ?? '/',
          network: input.network ?? '',
          timeoutS: input.timeoutS ?? 5,
        }),
      },
    );
  }

  /** Retires every instance of the service except keepColor (blue-green swap). */
  promote(node: NodeRow, serviceId: string, keepColor: string) {
    return this.request<{ ok: boolean }>(
      node,
      `/servers/${serviceId}/promote`,
      { method: 'POST', body: JSON.stringify({ keepColor }) },
    );
  }

  /** Removes a single color instance of a service (blue-green cleanup). */
  removeColor(node: NodeRow, serviceId: string, color: string) {
    return this.request<{ ok: boolean }>(
      node,
      `/servers/${serviceId}?color=${encodeURIComponent(color)}`,
      { method: 'DELETE' },
    );
  }

  /** Creates the volume + container for a managed database on the node. */
  createDatabase(node: NodeRow, input: AgentDbCreateInput) {
    return this.request<{ ok: boolean; containerId?: string; error?: string }>(
      node,
      '/databases',
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  powerDatabase(node: NodeRow, container: string, action: string) {
    return this.request<{ ok: boolean; error?: string }>(node, '/databases/power', {
      method: 'POST',
      body: JSON.stringify({ container, action: action.toLowerCase() }),
    });
  }

  removeDatabase(
    node: NodeRow,
    container: string,
    volume: string,
    keepVolume: boolean,
  ) {
    return this.request<{ ok: boolean }>(node, '/databases', {
      method: 'DELETE',
      body: JSON.stringify({ container, volume, keepVolume }),
    });
  }

  databaseStatus(
    node: NodeRow,
    input: {
      container: string;
      engine: string;
      user: string;
      password: string;
      dbName: string;
    },
  ) {
    return this.request<AgentDbStatus>(node, '/databases/status', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** Removes a Docker named volume on the node (no-op if still in use). */
  removeVolume(node: NodeRow, name: string) {
    return this.request<{ ok: boolean }>(node, '/volumes', {
      method: 'DELETE',
      body: JSON.stringify({ name }),
    });
  }

  backup(node: NodeRow, input: AgentBackupInput) {
    return this.request<{ ok: boolean; sizeBytes?: number; error?: string }>(
      node,
      '/backups',
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  restoreBackup(node: NodeRow, input: AgentBackupInput) {
    return this.request<{ ok: boolean; error?: string }>(
      node,
      '/backups/restore',
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  deleteBackup(node: NodeRow, file: string) {
    return this.request<{ ok: boolean }>(node, '/backups', {
      method: 'DELETE',
      body: JSON.stringify({ file }),
    });
  }

  /** Opens the raw download stream of a backup file from the node. */
  async downloadBackup(node: NodeRow, file: string, signal?: AbortSignal) {
    const token = this.agentToken.authToken(node);
    const res = await this.doFetch(
      node,
      `${this.baseUrl(node)}/backups/download?file=${encodeURIComponent(file)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal,
        dispatcher: this.dispatcher(node),
      },
    );
    if (!res.ok || !res.body) {
      throw new Error(`Agent ${node.name} download HTTP ${res.status}`);
    }
    return res;
  }

  power(node: NodeRow, serviceId: string, action: PowerAction) {
    return this.request<{ ok: boolean }>(
      node,
      `/servers/${serviceId}/power`,
      { method: 'POST', body: JSON.stringify({ action: action.toLowerCase() }) },
    );
  }

  remove(node: NodeRow, serviceId: string) {
    return this.request<{ ok: boolean }>(node, `/servers/${serviceId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Pushes a freshly minted daemon secret to the agent (authenticated with the
   * CURRENT secret). Returns the raw HTTP outcome so the caller can distinguish
   * a legacy agent without the endpoint (404) from a transport failure — and
   * only persist the switch after the agent confirms, so nothing locks out.
   */
  async rotate(
    node: NodeRow,
    newToken: string,
  ): Promise<{ ok: boolean; status: number }> {
    const res = await this.doFetch(node, `${this.baseUrl(node)}/rotate`, {
      method: 'POST',
      dispatcher: this.dispatcher(node),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.agentToken.authToken(node)}`,
      },
      body: JSON.stringify({ newToken }),
    });
    // Drain the body so the socket can be reused.
    await res.text().catch(() => '');
    return { ok: res.ok, status: res.status };
  }

  /**
   * Opens the agent's runtime log stream (`docker logs -f`). Returns the raw
   * fetch Response so the caller can pipe the body straight to the browser.
   */
  async streamLogs(
    node: NodeRow,
    serviceId: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const token = this.agentToken.authToken(node);
    const res = await this.doFetch(
      node,
      `${this.baseUrl(node)}/servers/${serviceId}/logs`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal,
        dispatcher: this.dispatcher(node),
      },
    );
    if (!res.ok || !res.body) {
      throw new Error(`Agent ${node.name} logs HTTP ${res.status}`);
    }
    return res;
  }
}
