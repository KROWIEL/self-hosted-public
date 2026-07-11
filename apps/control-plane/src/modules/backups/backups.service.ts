import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import {
  backups,
  managedDatabases,
  nodes,
  services,
  volumes,
} from '../../db/schema';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AgentClient, AgentBackupInput, NodeRow } from '../nodes/agent.client';

type BackupKind = 'VOLUME' | 'DATABASE';

interface Resolved {
  node: NodeRow;
  nodeId: string;
  base: AgentBackupInput;
  ext: string;
}

@Injectable()
export class BackupsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly agent: AgentClient,
  ) {}

  private async nodeRow(nodeId: string) {
    const [node] = await this.db
      .select()
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);
    if (!node) throw new NotFoundException('Node not found');
    return node;
  }

  /** Resolves the agent target + base backup params for a volume or database. */
  private async resolve(kind: BackupKind, refId: string): Promise<Resolved> {
    if (kind === 'DATABASE') {
      const [db] = await this.db
        .select()
        .from(managedDatabases)
        .where(eq(managedDatabases.id, refId))
        .limit(1);
      if (!db) throw new NotFoundException('Database not found');
      const node = await this.nodeRow(db.nodeId);
      return {
        node,
        nodeId: db.nodeId,
        ext: 'sql.gz',
        base: {
          kind: 'DATABASE',
          file: '',
          container: db.containerName,
          engine: db.engine.toLowerCase(),
          user: db.username,
          password: this.crypto.decrypt(db.passwordEnc),
          dbName: db.dbName,
        },
      };
    }

    const [vol] = await this.db
      .select()
      .from(volumes)
      .where(eq(volumes.id, refId))
      .limit(1);
    if (!vol) throw new NotFoundException('Volume not found');
    const [svc] = await this.db
      .select()
      .from(services)
      .where(eq(services.id, vol.serviceId))
      .limit(1);
    if (!svc) throw new NotFoundException('Service not found');
    const node = await this.nodeRow(svc.nodeId);
    return {
      node,
      nodeId: svc.nodeId,
      ext: 'tar.gz',
      base: { kind: 'VOLUME', file: '', volume: vol.name },
    };
  }

  list(kind: BackupKind, refId: string) {
    return this.db
      .select()
      .from(backups)
      .where(and(eq(backups.kind, kind), eq(backups.refId, refId)))
      .orderBy(desc(backups.createdAt));
  }

  async get(id: string) {
    const [row] = await this.db
      .select()
      .from(backups)
      .where(eq(backups.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Backup not found');
    return row;
  }

  /** Runs a snapshot on the node and records the result. */
  async create(kind: BackupKind, refId: string) {
    const r = await this.resolve(kind, refId);

    const [row] = await this.db
      .insert(backups)
      .values({ kind, refId, nodeId: r.nodeId, fileName: 'pending', status: 'RUNNING' })
      .returning();

    const fileName = `backup-${row.id}.${r.ext}`;
    await this.db
      .update(backups)
      .set({ fileName })
      .where(eq(backups.id, row.id));

    try {
      const res = await this.agent.backup(r.node, { ...r.base, file: fileName });
      if (!res.ok) throw new Error(res.error ?? 'agent backup failed');
      await this.db
        .update(backups)
        .set({ status: 'SUCCESS', sizeBytes: res.sizeBytes ?? null })
        .where(eq(backups.id, row.id));
    } catch (e) {
      await this.db
        .update(backups)
        .set({
          status: 'FAILED',
          errorMsg: e instanceof Error ? e.message : String(e),
        })
        .where(eq(backups.id, row.id));
      throw new BadRequestException(
        `Backup failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    return this.get(row.id);
  }

  async restore(id: string) {
    const row = await this.get(id);
    if (row.status !== 'SUCCESS') {
      throw new BadRequestException('Only a successful backup can be restored');
    }
    const r = await this.resolve(row.kind, row.refId);
    const res = await this.agent.restoreBackup(r.node, {
      ...r.base,
      file: row.fileName,
    });
    if (!res.ok) {
      throw new BadRequestException(res.error ?? 'restore failed');
    }
    return { ok: true };
  }

  async remove(id: string) {
    const row = await this.get(id);
    try {
      const node = await this.nodeRow(row.nodeId);
      await this.agent.deleteBackup(node, row.fileName);
    } catch {
      // Best-effort: remove the record even if the file/agent is unavailable.
    }
    await this.db.delete(backups).where(eq(backups.id, id));
    return { ok: true };
  }

  /** Returns node + file name for streaming a download (used by the controller). */
  async getForDownload(id: string) {
    const row = await this.get(id);
    const node = await this.nodeRow(row.nodeId);
    return { node, fileName: row.fileName };
  }

  /** Opens the raw download stream of a backup from its node. */
  async openDownload(id: string, signal?: AbortSignal) {
    const { node, fileName } = await this.getForDownload(id);
    const res = await this.agent.downloadBackup(node, fileName, signal);
    return { res, fileName };
  }

  /** Deletes successful backups beyond the newest `keepLast` for a ref. */
  async applyRetention(kind: BackupKind, refId: string, keepLast: number) {
    const rows = await this.db
      .select()
      .from(backups)
      .where(and(eq(backups.kind, kind), eq(backups.refId, refId)))
      .orderBy(desc(backups.createdAt));
    const successful = rows.filter((r) => r.status === 'SUCCESS');
    for (const old of successful.slice(keepLast)) {
      await this.remove(old.id).catch(() => undefined);
    }
  }
}
