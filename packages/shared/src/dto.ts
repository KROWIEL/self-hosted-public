import { GitProvider, ServiceType } from './enums';

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
  templateId: string;
  repoUrl: string;
  branch?: string;
  gitCredId?: string;
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
