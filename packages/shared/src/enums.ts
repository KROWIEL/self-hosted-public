export enum Role {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

export enum MemberRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}

export enum NodeStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
}

export enum GitProvider {
  GITHUB = 'GITHUB',
  GITLAB = 'GITLAB',
}

export enum ServiceType {
  BACKEND = 'BACKEND',
  FRONTEND = 'FRONTEND',
}

export enum ServiceStatus {
  CREATED = 'CREATED',
  BUILDING = 'BUILDING',
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED',
  ERROR = 'ERROR',
}

export enum DeployStatus {
  QUEUED = 'QUEUED',
  BUILDING = 'BUILDING',
  DEPLOYING = 'DEPLOYING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export enum PowerAction {
  START = 'start',
  STOP = 'stop',
  RESTART = 'restart',
  KILL = 'kill',
}

/** How a service is deployed onto a node. */
export type DeployKind = 'git' | 'image' | 'compose';

/** Lowest commercial tier that can install a catalog app. */
export type CatalogTier = 'free' | 'homelab';
