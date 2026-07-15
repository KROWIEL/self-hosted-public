import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import {
  backupSchedules,
  backups,
  deployments,
  managedDatabases,
  previewEnvironments,
  services,
  volumes,
} from '../../db/schema';

/** The kind of entity a route param points at, used to resolve its project. */
export type ResolveKind =
  | 'project'
  | 'service'
  | 'deployment'
  | 'database'
  | 'volume'
  | 'backup'
  | 'schedule'
  | 'preview';

/**
 * Maps an entity id to the project it belongs to, so a single guard can enforce
 * project-scoped roles across service/deployment/database/etc. routes.
 */
@Injectable()
export class ProjectResolver {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async resolve(kind: ResolveKind, id: string): Promise<string> {
    switch (kind) {
      case 'project':
        return id;
      case 'service':
        return this.fromService(id);
      case 'deployment': {
        const dep = (
          await this.db
            .select({ serviceId: deployments.serviceId })
            .from(deployments)
            .where(eq(deployments.id, id))
            .limit(1)
        )[0];
        if (!dep) throw new NotFoundException('Deployment not found');
        return this.fromService(dep.serviceId);
      }
      case 'database': {
        const row = (
          await this.db
            .select({ projectId: managedDatabases.projectId })
            .from(managedDatabases)
            .where(eq(managedDatabases.id, id))
            .limit(1)
        )[0];
        if (!row) throw new NotFoundException('Database not found');
        return row.projectId;
      }
      case 'volume': {
        const row = (
          await this.db
            .select({ serviceId: volumes.serviceId })
            .from(volumes)
            .where(eq(volumes.id, id))
            .limit(1)
        )[0];
        if (!row) throw new NotFoundException('Volume not found');
        return this.fromService(row.serviceId);
      }
      case 'backup': {
        const bk = (
          await this.db
            .select({ kind: backups.kind, refId: backups.refId })
            .from(backups)
            .where(eq(backups.id, id))
            .limit(1)
        )[0];
        if (!bk) throw new NotFoundException('Backup not found');
        return this.fromRef(bk.kind, bk.refId);
      }
      case 'schedule': {
        const sc = (
          await this.db
            .select({ kind: backupSchedules.kind, refId: backupSchedules.refId })
            .from(backupSchedules)
            .where(eq(backupSchedules.id, id))
            .limit(1)
        )[0];
        if (!sc) throw new NotFoundException('Schedule not found');
        return this.fromRef(sc.kind, sc.refId);
      }
      case 'preview': {
        const pe = (
          await this.db
            .select({ serviceId: previewEnvironments.serviceId })
            .from(previewEnvironments)
            .where(eq(previewEnvironments.id, id))
            .limit(1)
        )[0];
        if (!pe) throw new NotFoundException('Preview environment not found');
        return this.fromService(pe.serviceId);
      }
    }
  }

  /** Resolves the project of a backup/schedule ref (a volume or database id). */
  fromRef(kind: 'VOLUME' | 'DATABASE', refId: string): Promise<string> {
    return kind === 'DATABASE'
      ? this.resolve('database', refId)
      : this.resolve('volume', refId);
  }

  private async fromService(serviceId: string): Promise<string> {
    const row = (
      await this.db
        .select({ projectId: services.projectId })
        .from(services)
        .where(eq(services.id, serviceId))
        .limit(1)
    )[0];
    if (!row) throw new NotFoundException('Service not found');
    return row.projectId;
  }
}
