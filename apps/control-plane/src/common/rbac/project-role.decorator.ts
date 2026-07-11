import { SetMetadata } from '@nestjs/common';
import { MemberRole } from '@selfhosted/shared';
import type { ResolveKind } from '../../modules/members/project-resolver.service';

export const PROJECT_ROLE_KEY = 'project_role';

export interface ProjectRoleMeta {
  min: MemberRole;
  kind: ResolveKind;
  /** Route param holding the entity id (defaults per kind). */
  param?: string;
}

const DEFAULT_PARAM: Record<ResolveKind, string> = {
  project: 'id',
  service: 'id',
  deployment: 'deploymentId',
  database: 'id',
  volume: 'volumeId',
  backup: 'id',
  schedule: 'id',
};

/**
 * Guards a route by project role. `kind` says what the id param points at so the
 * guard can resolve the owning project, then checks the caller's role there.
 *
 * @example @ProjectRole(MemberRole.MEMBER, 'service')  // param :id is a serviceId
 */
export const ProjectRole = (
  min: MemberRole,
  kind: ResolveKind,
  param?: string,
) =>
  SetMetadata<string, ProjectRoleMeta>(PROJECT_ROLE_KEY, {
    min,
    kind,
    param: param ?? DEFAULT_PARAM[kind],
  });
