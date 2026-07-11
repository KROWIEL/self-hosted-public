import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import {
  envVars,
  gitCredentials,
  managedDatabases,
  nodes,
  services,
} from '../../db/schema';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AgentClient, AgentEnvKey } from '../nodes/agent.client';
import { ServicesService } from '../services/services.service';
import { CreateDatabaseDto } from './dto/create-database.dto';

type Engine = 'POSTGRES' | 'MYSQL';

const SECRET_KEY_RE =
  /(PASS|PWD|SECRET|TOKEN|PRIVATE|CREDENTIAL|API_?KEY|_KEY$|DATABASE_URL|DSN)/i;

interface EngineConfig {
  image: string;
  port: number;
  dataDir: string;
  scheme: string;
}

@Injectable()
export class DatabasesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly agent: AgentClient,
    private readonly services: ServicesService,
  ) {}

  private engineConfig(engine: Engine, version: string): EngineConfig {
    if (engine === 'POSTGRES') {
      return {
        image: `postgres:${version}-alpine`,
        port: 5432,
        dataDir: '/var/lib/postgresql/data',
        scheme: 'postgresql',
      };
    }
    return {
      image: `mysql:${version}`,
      port: 3306,
      dataDir: '/var/lib/mysql',
      scheme: 'mysql',
    };
  }

  private defaultVersion(engine: Engine): string {
    return engine === 'POSTGRES' ? '16' : '8.4';
  }

  private engineEnv(
    engine: Engine,
    dbName: string,
    user: string,
    pass: string,
  ): Record<string, string> {
    if (engine === 'POSTGRES') {
      return {
        POSTGRES_USER: user,
        POSTGRES_PASSWORD: pass,
        POSTGRES_DB: dbName,
      };
    }
    return {
      MYSQL_ROOT_PASSWORD: pass,
      MYSQL_DATABASE: dbName,
      MYSQL_USER: user,
      MYSQL_PASSWORD: pass,
    };
  }

  private sanitize(v: string, fallback: string): string {
    const s = v.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '');
    return s.length ? s : fallback;
  }

  private async nodeRow(nodeId: string) {
    const [node] = await this.db
      .select()
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);
    if (!node) throw new NotFoundException('Node not found');
    return node;
  }

  async get(id: string) {
    const [row] = await this.db
      .select()
      .from(managedDatabases)
      .where(eq(managedDatabases.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Database not found');
    return row;
  }

  /** Public-safe view (never exposes the password). */
  private view(row: typeof managedDatabases.$inferSelect) {
    return {
      id: row.id,
      projectId: row.projectId,
      nodeId: row.nodeId,
      name: row.name,
      engine: row.engine,
      version: row.version,
      status: row.status,
      host: row.containerName,
      port: row.internalPort,
      dbName: row.dbName,
      username: row.username,
    };
  }

  listByProject(projectId: string) {
    return this.db
      .select()
      .from(managedDatabases)
      .where(eq(managedDatabases.projectId, projectId))
      .orderBy(managedDatabases.createdAt)
      .then((rows) => rows.map((r) => this.view(r)));
  }

  async getView(id: string) {
    return this.view(await this.get(id));
  }

  async create(projectId: string, dto: CreateDatabaseDto) {
    const engine = dto.engine;
    const version = dto.version ?? this.defaultVersion(engine);
    const cfg = this.engineConfig(engine, version);
    const node = await this.nodeRow(dto.nodeId);

    const id = randomUUID();
    const containerName = `db-${id.slice(0, 8)}`;
    const volumeName = `dbvol-${id.slice(0, 8)}`;
    const username = this.sanitize(dto.username ?? 'app', 'app');
    const dbName = this.sanitize(dto.dbName ?? 'app', 'app');
    const password = randomBytes(18).toString('base64url');

    await this.db.insert(managedDatabases).values({
      id,
      projectId,
      nodeId: dto.nodeId,
      engine,
      version,
      name: dto.name,
      containerName,
      volumeName,
      dbName,
      username,
      passwordEnc: this.crypto.encrypt(password),
      internalPort: cfg.port,
      status: 'CREATED',
    });

    try {
      const res = await this.agent.createDatabase(node, {
        container: containerName,
        volume: volumeName,
        image: cfg.image,
        dataDir: cfg.dataDir,
        internalPort: cfg.port,
        env: this.engineEnv(engine, dbName, username, password),
      });
      if (!res.ok) throw new Error(res.error ?? 'agent create failed');
      await this.db
        .update(managedDatabases)
        .set({ status: 'RUNNING' })
        .where(eq(managedDatabases.id, id));
    } catch (e) {
      await this.db
        .update(managedDatabases)
        .set({ status: 'ERROR' })
        .where(eq(managedDatabases.id, id));
      throw new BadRequestException(
        `Failed to provision database: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    return this.getView(id);
  }

  /** Reveals the connection credentials + URL (owner action). */
  async credentials(id: string) {
    const row = await this.get(id);
    const password = this.crypto.decrypt(row.passwordEnc);
    const cfg = this.engineConfig(row.engine, row.version);
    const url = `${cfg.scheme}://${row.username}:${password}@${row.containerName}:${row.internalPort}/${row.dbName}`;
    return {
      host: row.containerName,
      port: row.internalPort,
      dbName: row.dbName,
      username: row.username,
      password,
      url,
    };
  }

  /** Live status (running/ready) from the node agent. */
  async status(id: string) {
    const row = await this.get(id);
    const node = await this.nodeRow(row.nodeId);
    return this.agent.databaseStatus(node, {
      container: row.containerName,
      engine: row.engine.toLowerCase(),
      user: row.username,
      password: this.crypto.decrypt(row.passwordEnc),
      dbName: row.dbName,
    });
  }

  async power(id: string, action: string) {
    const row = await this.get(id);
    const node = await this.nodeRow(row.nodeId);
    await this.agent.powerDatabase(node, row.containerName, action);
    const status =
      action.toLowerCase() === 'stop' || action.toLowerCase() === 'kill'
        ? 'STOPPED'
        : 'RUNNING';
    await this.db
      .update(managedDatabases)
      .set({ status })
      .where(eq(managedDatabases.id, id));
    return this.getView(id);
  }

  /**
   * Injects connection env vars (DATABASE_URL + DB_*) into a service. They take
   * effect on the service's next deploy. Password/URL stored as secrets.
   */
  async attach(id: string, serviceId: string) {
    const c = await this.credentials(id);
    await this.services.setEnv(serviceId, {
      vars: [
        { key: 'DATABASE_URL', value: c.url, isSecret: true },
        { key: 'DB_HOST', value: c.host },
        { key: 'DB_PORT', value: String(c.port) },
        { key: 'DB_NAME', value: c.dbName },
        { key: 'DB_USER', value: c.username },
        { key: 'DB_PASSWORD', value: c.password, isSecret: true },
      ],
    });
    return { ok: true };
  }

  private async serviceRow(serviceId: string) {
    const [svc] = await this.db
      .select()
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);
    if (!svc) throw new NotFoundException('Service not found');
    return svc;
  }

  private async patFor(gitCredId: string | null): Promise<string | undefined> {
    if (!gitCredId) return undefined;
    const [cred] = await this.db
      .select()
      .from(gitCredentials)
      .where(eq(gitCredentials.id, gitCredId))
      .limit(1);
    return cred ? this.crypto.decrypt(cred.patEnc) : undefined;
  }

  /**
   * Clones the service's repo on its node and reports detected env keys and
   * databases, plus which env keys already exist on the service.
   */
  async inspectService(serviceId: string) {
    const svc = await this.serviceRow(serviceId);
    const node = await this.nodeRow(svc.nodeId);
    const patToken = await this.patFor(svc.gitCredId);

    const result = await this.agent.inspect(node, {
      repoUrl: svc.repoUrl,
      branch: svc.branch,
      patToken,
      workId: randomUUID(),
    });

    const existing = await this.db
      .select({ key: envVars.key })
      .from(envVars)
      .where(eq(envVars.serviceId, serviceId));

    return { ...result, existingKeys: existing.map((e) => e.key) };
  }

  private buildUrlFor(
    key: string,
    creds: { host: string; port: number; username: string; password: string },
    engine: Engine,
    schema: string,
  ): string {
    const prefix = engine === 'POSTGRES' ? 'postgresql' : 'mysql';
    const u = key.toUpperCase();
    if (u.includes('JDBC')) {
      return `jdbc:${prefix}://${creds.host}:${creds.port}/${schema}`;
    }
    if (u.includes('R2DBC')) {
      return `r2dbc:${prefix}://${creds.host}:${creds.port}/${schema}`;
    }
    return `${prefix}://${creds.username}:${creds.password}@${creds.host}:${creds.port}/${schema}`;
  }

  /**
   * Rewrites the host/port (and embedded credentials, if any) of an example
   * connection URL to point at a provisioned DB, preserving the scheme, path
   * (schema) and query. This keeps app-specific URL shapes intact — e.g. a
   * Flyway url without a schema (`jdbc:mysql://localhost:3306`) stays
   * schema-less, and a url with query params keeps them.
   */
  private rewriteDbUrl(
    example: string,
    host: string,
    port: number,
    user: string,
    pass: string,
  ): string {
    const m = example.match(
      /^(\w+:(?:\w+:)?\/\/)(?:([^@/]*)@)?([^/?#]+)(.*)$/,
    );
    if (!m) return example;
    const scheme = m[1];
    const hadCreds = !!m[2];
    const rest = m[4] ?? '';
    const authority = hadCreds
      ? `${user}:${pass}@${host}:${port}`
      : `${host}:${port}`;
    return `${scheme}${authority}${rest}`;
  }

  /** Polls the node until the DB reports ready (or times out). */
  private async waitReady(id: string, timeoutMs = 90000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const s = await this.status(id);
        if (s.ready) return true;
      } catch {
        // keep polling
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  }

  private engineOfExample(value: string): Engine | undefined {
    const v = value.toLowerCase();
    if (v.includes('postgres')) return 'POSTGRES';
    if (v.includes('mysql') || v.includes('mariadb')) return 'MYSQL';
    return undefined;
  }

  /**
   * Applies a detection plan: provisions one managed DB per requested engine
   * (creating every referenced schema inside it, attaching the first DB's
   * canonical DB_* vars), then seeds the selected env keys — filling
   * DB-connection keys from the provisioned DB/schema and leaving the rest
   * blank. Existing non-DB keys are never overwritten.
   */
  async applySetup(
    serviceId: string,
    dto: {
      databases: { engine: Engine; schemas: string[] }[];
      envKeys: AgentEnvKey[];
    },
  ) {
    const svc = await this.serviceRow(serviceId);

    const existing = new Set(
      (
        await this.db
          .select({ key: envVars.key })
          .from(envVars)
          .where(eq(envVars.serviceId, serviceId))
      ).map((e) => e.key),
    );

    type DbInfo = {
      engine: Engine;
      creds: Awaited<ReturnType<DatabasesService['credentials']>>;
    };
    const created: ReturnType<DatabasesService['view']>[] = [];
    const byEngine = new Map<Engine, DbInfo>();
    let primary: DbInfo | undefined;

    for (const need of dto.databases ?? []) {
      const wanted = Array.from(
        new Set(
          (need.schemas ?? [])
            .map((s) => this.sanitize(s, ''))
            .filter((s) => s.length > 0),
        ),
      );
      const primarySchema = wanted[0] ?? 'app';

      const view = await this.create(svc.projectId, {
        name: `${need.engine === 'POSTGRES' ? 'postgres' : 'mysql'}-${svc.name}`,
        engine: need.engine,
        nodeId: svc.nodeId,
        dbName: primarySchema,
      });
      created.push(view);

      const creds = await this.credentials(view.id);
      const node = await this.nodeRow(svc.nodeId);
      const extras = wanted.slice(1).filter((s) => s !== creds.dbName);
      // Elevate the app user so it can create/manage additional schemas at
      // runtime (multi-tenant apps that CREATE DATABASE per tenant). Safe: each
      // managed container is dedicated to this one service. Retried because the
      // MySQL image restarts mid-init: the app user (and a stable server) may
      // not exist yet right after the readiness probe first passes.
      if (need.engine === 'MYSQL') {
        await this.waitReady(view.id);
        for (let i = 0; i < 25; i++) {
          const res = await this.agent
            .grantPrivileges(node, {
              container: creds.host,
              engine: 'mysql',
              user: creds.username,
              password: creds.password,
            })
            .catch(() => ({ ok: false }));
          if (res.ok) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
      } else if (extras.length > 0) {
        // The container is up but the engine may still be initializing; wait
        // before issuing CREATE DATABASE for the extra schemas.
        await this.waitReady(view.id);
      }
      for (const extra of extras) {
        // Retry: readiness probes can pass while the engine is still finishing
        // user setup / restarting, which makes an immediate GRANT fail. The op
        // is idempotent (CREATE IF NOT EXISTS), so retrying is safe.
        for (let i = 0; i < 25; i++) {
          const res = await this.agent
            .createSchema(node, {
              container: creds.host,
              engine: need.engine.toLowerCase(),
              user: creds.username,
              password: creds.password,
              schema: extra,
            })
            .catch(() => ({ ok: false }));
          if (res.ok) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      const info: DbInfo = { engine: need.engine, creds };
      byEngine.set(need.engine, info);
      if (!primary) {
        primary = info;
        await this.attach(view.id, serviceId);
        for (const k of [
          'DATABASE_URL',
          'DB_HOST',
          'DB_PORT',
          'DB_NAME',
          'DB_USER',
          'DB_PASSWORD',
        ]) {
          existing.add(k);
        }
      }
    }

    const vars: { key: string; value: string; isSecret?: boolean }[] = [];
    for (const ev of dto.envKeys ?? []) {
      if (ev.dbRole) {
        const byScheme = ev.example ? this.engineOfExample(ev.example) : undefined;
        const db =
          (byScheme && byEngine.get(byScheme)) || primary || undefined;
        if (db) {
          const schema = ev.dbName ? this.sanitize(ev.dbName, db.creds.dbName) : db.creds.dbName;
          let value: string;
          switch (ev.dbRole) {
            case 'url':
              // Prefer rewriting the detected example URL so app-specific shapes
              // (schema-less Flyway urls, query params) are preserved; fall back
              // to constructing one when no example was captured.
              value = ev.example
                ? this.rewriteDbUrl(
                    ev.example,
                    db.creds.host,
                    db.creds.port,
                    db.creds.username,
                    db.creds.password,
                  )
                : this.buildUrlFor(ev.key, db.creds, db.engine, schema);
              break;
            case 'host':
              value = db.creds.host;
              break;
            case 'port':
              value = String(db.creds.port);
              break;
            case 'name':
              value = schema;
              break;
            case 'user':
              value = db.creds.username;
              break;
            case 'password':
              value = db.creds.password;
              break;
            default:
              value = '';
          }
          vars.push({
            key: ev.key,
            value,
            isSecret: ev.dbRole === 'password' || ev.dbRole === 'url',
          });
          continue;
        }
      }
      if (!existing.has(ev.key)) {
        vars.push({ key: ev.key, value: '', isSecret: SECRET_KEY_RE.test(ev.key) });
      }
    }

    if (vars.length > 0) {
      await this.services.setEnv(serviceId, { vars });
    }

    return { databases: created, envSet: vars.length };
  }

  async remove(id: string, keepVolume: boolean) {
    const row = await this.get(id);
    try {
      const node = await this.nodeRow(row.nodeId);
      await this.agent.removeDatabase(
        node,
        row.containerName,
        row.volumeName,
        keepVolume,
      );
    } catch {
      // Best-effort: remove the record even if the agent is unreachable.
    }
    await this.db
      .delete(managedDatabases)
      .where(and(eq(managedDatabases.id, id)));
    return { ok: true };
  }
}
