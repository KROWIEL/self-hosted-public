import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { services, templates } from '../../db/schema';
import { TemplateErrors } from '../../common/errors/app-errors';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class TemplatesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  list() {
    return this.db.select().from(templates).orderBy(asc(templates.name));
  }

  async get(id: string) {
    const rows = await this.db
      .select()
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1);
    if (!rows[0]) throw TemplateErrors.notFound();
    return rows[0];
  }

  async create(dto: CreateTemplateDto) {
    const rows = await this.db
      .insert(templates)
      .values({
        name: dto.name.trim(),
        description: emptyToNull(dto.description),
        category: emptyToNull(dto.category),
        type: dto.type,
        baseImage: dto.baseImage.trim(),
        dockerfilePath: emptyToNull(dto.dockerfilePath),
        installImage: dto.installImage.trim(),
        installScript: dto.installScript,
        defaultBuildCommand: dto.defaultBuildCommand,
        defaultRunCommand: dto.defaultRunCommand,
        defaultPort: dto.defaultPort,
        healthcheckPath: emptyToNull(dto.healthcheckPath),
        variables: dto.variables ?? [],
        isBuiltIn: false,
      })
      .returning();
    return rows[0];
  }

  async update(id: string, dto: UpdateTemplateDto) {
    await this.get(id); // 404 if missing (built-ins are editable too)

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.description !== undefined)
      patch.description = emptyToNull(dto.description);
    if (dto.category !== undefined) patch.category = emptyToNull(dto.category);
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.baseImage !== undefined) patch.baseImage = dto.baseImage.trim();
    if (dto.dockerfilePath !== undefined)
      patch.dockerfilePath = emptyToNull(dto.dockerfilePath);
    if (dto.installImage !== undefined)
      patch.installImage = dto.installImage.trim();
    if (dto.installScript !== undefined) patch.installScript = dto.installScript;
    if (dto.defaultBuildCommand !== undefined)
      patch.defaultBuildCommand = dto.defaultBuildCommand;
    if (dto.defaultRunCommand !== undefined)
      patch.defaultRunCommand = dto.defaultRunCommand;
    if (dto.defaultPort !== undefined) patch.defaultPort = dto.defaultPort;
    if (dto.healthcheckPath !== undefined)
      patch.healthcheckPath = emptyToNull(dto.healthcheckPath);
    if (dto.variables !== undefined) patch.variables = dto.variables;

    const rows = await this.db
      .update(templates)
      .set(patch)
      .where(eq(templates.id, id))
      .returning();
    return rows[0];
  }

  async remove(id: string) {
    await this.get(id); // 404 if missing

    // Block deletion while services still reference this template (FK).
    const inUse = await this.db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.templateId, id))
      .limit(1);
    if (inUse.length > 0) throw TemplateErrors.inUse();

    await this.db.delete(templates).where(eq(templates.id, id));
    return { ok: true };
  }
}

function emptyToNull(v: string | undefined): string | null {
  if (v === undefined) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}
