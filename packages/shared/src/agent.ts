import { PowerAction } from './enums';

/**
 * Contracts for control-plane <-> agent communication.
 * The agent (Go) implements equivalents of these payloads.
 */

export interface AgentSystemInfo {
  version: string;
  cpuCores: number;
  memTotalMb: number;
  diskTotalMb: number;
  dockerVersion: string;
}

/** Request to build a service image from git on the node. */
export interface AgentBuildRequest {
  serviceId: string;
  repoUrl: string;
  branch: string;
  /** PAT passed only for the duration of the build; never persisted on the node. */
  patToken?: string;
  gitUsername?: string;
  /** Image with build tooling (e.g. maven/node). */
  installImage: string;
  /** Shell script that clones + builds. */
  installScript: string;
  /** Optional Dockerfile contents to build the runtime image. */
  dockerfile?: string;
  buildCommand: string;
  /** Resulting tag, e.g. app-<serviceId>:<sha>. */
  imageTag: string;
  env: Record<string, string>;
}

export interface AgentRunRequest {
  serviceId: string;
  imageTag: string;
  runCommand?: string;
  port: number;
  cpuLimit: number;
  memLimit: number;
  env: Record<string, string>;
  /** Traefik routing host, if a domain is attached. */
  domain?: string;
  https?: boolean;
  networkName: string;
}

export interface AgentPowerRequest {
  serviceId: string;
  action: PowerAction;
}

/** A line streamed over WebSocket from the agent. */
export interface AgentLogLine {
  ts: string;
  stream: 'build' | 'runtime' | 'system';
  line: string;
}

export interface AgentStats {
  serviceId: string;
  cpuPercent: number;
  memUsedMb: number;
  memLimitMb: number;
  netRxBytes: number;
  netTxBytes: number;
}
