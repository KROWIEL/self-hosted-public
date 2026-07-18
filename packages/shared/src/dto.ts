import { GitProvider, ServiceType, type DeployKind } from './enums';

export interface LoginDto {
  email: string;
  password: string;
  totp?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface CreateNodeDto {
  name: string;
  fqdn: string;
  agentPort?: number;
  cpuTotal?: number;
  memTotal?: number;
}

export interface CreateProjectDto {
  name: string;
  cpuLimit?: number;
  memLimit?: number;
}

export interface CreateGitCredentialDto {
  name: string;
  provider: GitProvider;
  username?: string;
  pat: string;
}

export interface CreateServiceDto {
  name: string;
  type: ServiceType;
  nodeId: string;
  /** Required when deployKind is git (default). Null for image/compose. */
  templateId?: string | null;
  deployKind?: DeployKind;
  /** Required for git/compose (unless composeYaml is set). Null for image. */
  repoUrl?: string | null;
  /** Docker image ref when deployKind=image. */
  image?: string;
  /** Compose file path in the repo when deployKind=compose. */
  composeFile?: string;
  /** Inline compose YAML (catalog-owned stacks). */
  composeYaml?: string;
  branch?: string;
  gitCredId?: string;
  useRepoDockerfile?: boolean;
  buildCommand?: string;
  runCommand?: string;
  port?: number;
  cpuLimit?: number;
  memLimit?: number;
  env?: Record<string, string>;
}

export interface SetEnvDto {
  vars: Array<{ key: string; value: string; isSecret?: boolean }>;
}

export interface SetDomainDto {
  host: string;
  https?: boolean;
}

export interface CatalogEnvDefault {
  key: string;
  value?: string;
  secret?: boolean;
  required?: boolean;
}

export interface CatalogVolumeHint {
  mountPath: string;
}

export interface CatalogApp {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  minTier: 'free' | 'homelab';
  deployKind: DeployKind;
  image: string | null;
  composeYaml: string | null;
  composeGitUrl: string | null;
  composeFile: string | null;
  defaultPort: number | null;
  recommendedVolumes: CatalogVolumeHint[];
  envDefaults: CatalogEnvDefault[];
}

export interface InstallCatalogAppDto {
  projectId: string;
  nodeId: string;
  name?: string;
  env?: Record<string, string>;
  /** When true (default), enqueue a deploy after create. */
  deploy?: boolean;
}
