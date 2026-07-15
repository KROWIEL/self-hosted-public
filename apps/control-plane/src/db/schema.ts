import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// Enums (mirror @selfhosted/shared).
export const roleEnum = pgEnum('role', ['ADMIN', 'USER']);
export const memberRoleEnum = pgEnum('member_role', [
  'OWNER',
  'ADMIN',
  'MEMBER',
  'VIEWER',
]);
export const nodeStatusEnum = pgEnum('node_status', ['ONLINE', 'OFFLINE']);
export const gitProviderEnum = pgEnum('git_provider', ['GITHUB', 'GITLAB']);
export const serviceTypeEnum = pgEnum('service_type', ['BACKEND', 'FRONTEND']);
export const serviceStatusEnum = pgEnum('service_status', [
  'CREATED',
  'BUILDING',
  'RUNNING',
  'STOPPED',
  'ERROR',
]);
export const deployStatusEnum = pgEnum('deploy_status', [
  'QUEUED',
  'BUILDING',
  'DEPLOYING',
  'SUCCESS',
  'FAILED',
]);
export const dbEngineEnum = pgEnum('db_engine', ['POSTGRES', 'MYSQL']);
export const backupKindEnum = pgEnum('backup_kind', ['VOLUME', 'DATABASE']);
export const backupStatusEnum = pgEnum('backup_status', [
  'RUNNING',
  'SUCCESS',
  'FAILED',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  // Personal data captured during onboarding (stage 2 of registration).
  firstName: text('first_name'),
  lastName: text('last_name'),
  // TOTP shared secret, encrypted at rest (AES-256-GCM). Non-null = 2FA on.
  totpSecret: text('totp_secret'),
  role: roleEnum('role').notNull().default('USER'),
  // Set at login when the account password fails the current strength policy;
  // the UI then forces a password change (without blocking sign-in).
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  // Set when the user finishes onboarding (personal data + 2FA). Null = the
  // account exists but must still complete stage 2 before using the panel.
  onboardedAt: timestamp('onboarded_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/// A server running the Go agent that manages containers.
export const nodes = pgTable('nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  fqdn: text('fqdn').notNull(),
  agentPort: integer('agent_port').notNull().default(8443),
  daemonToken: text('daemon_token').notNull(),
  publicKey: text('public_key'),
  status: nodeStatusEnum('status').notNull().default('OFFLINE'),
  // Whether the local Go agent should be (re)started automatically on panel
  // boot. Set when the agent is started from the UI, cleared when stopped.
  enabled: boolean('enabled').notNull().default(false),
  cpuTotal: integer('cpu_total'),
  memTotal: integer('mem_total'),
  diskTotal: integer('disk_total'),
  // Remote-node fields (Track 4). `remote` marks a node whose agent runs on
  // another server (self-enrolls) vs the local dev agent spawned by the panel.
  // Pinned self-signed cert fingerprint (SHA-256 hex) captured at enrollment;
  // reported agent version; last heartbeat time.
  remote: boolean('remote').notNull().default(false),
  tlsFingerprint: text('tls_fingerprint'),
  agentVersion: text('agent_version'),
  lastSeen: timestamp('last_seen'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/// One-time join token that lets a fresh agent enroll itself with the panel.
/// Only the SHA-256 hash is stored; the plaintext is shown once at creation.
export const nodeEnrollments = pgTable('node_enrollments', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => nodes.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  cpuLimit: integer('cpu_limit').notNull().default(400),
  memLimit: integer('mem_limit').notNull().default(4096),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/// Project membership: which users can access a project and with what role.
/// The project owner also gets an OWNER row (backfilled on startup).
export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('MEMBER'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    projectUserUnique: unique('project_members_project_user_unique').on(
      t.projectId,
      t.userId,
    ),
  }),
);

/// Append-only audit trail of mutating actions (deploy, power, delete, env
/// change, member ops, exec-open, …). Never stores secret values.
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  userEmail: text('user_email'),
  action: text('action').notNull(), // 'service.deploy', 'db.delete', ...
  targetType: text('target_type').notNull(), // 'service', 'project', ...
  targetId: text('target_id'),
  projectId: uuid('project_id').references(() => projects.id, {
    onDelete: 'set null',
  }),
  meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
  ip: text('ip'),
  status: integer('status'), // HTTP status of the response
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/// Git credentials (PAT). PAT is encrypted at rest (AES-256-GCM).
export const gitCredentials = pgTable('git_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  provider: gitProviderEnum('provider').notNull().default('GITHUB'),
  username: text('username'),
  patEnc: text('pat_enc').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/// A stack template describing how to build & run a service.
export const templates = pgTable('templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  // Free-form grouping label (e.g. 'Java', 'JavaScript'); null = uncategorized.
  category: text('category'),
  type: serviceTypeEnum('type').notNull(),
  baseImage: text('base_image').notNull(),
  dockerfilePath: text('dockerfile_path'),
  installImage: text('install_image').notNull(),
  installScript: text('install_script').notNull(),
  defaultBuildCommand: text('default_build_command').notNull(),
  defaultRunCommand: text('default_run_command').notNull(),
  defaultPort: integer('default_port').notNull().default(8080),
  healthcheckPath: text('healthcheck_path'),
  // JSON array of TemplateVariable (see @selfhosted/shared).
  variables: jsonb('variables').notNull().default(sql`'[]'::jsonb`),
  isBuiltIn: boolean('is_built_in').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/// A deployable unit (backend or frontend).
export const services = pgTable('services', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: serviceTypeEnum('type').notNull(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => nodes.id),
  templateId: uuid('template_id')
    .notNull()
    .references(() => templates.id),
  repoUrl: text('repo_url').notNull(),
  branch: text('branch').notNull().default('main'),
  gitCredId: uuid('git_cred_id').references(() => gitCredentials.id),
  // When true, build from the repo's own Dockerfile (if present) instead of the
  // selected template's Dockerfile. Default: use the template (predictable builds).
  useRepoDockerfile: boolean('use_repo_dockerfile').notNull().default(false),
  buildCommand: text('build_command'),
  runCommand: text('run_command'),
  port: integer('port'),
  cpuLimit: integer('cpu_limit').notNull().default(100),
  memLimit: integer('mem_limit').notNull().default(512),
  containerId: text('container_id'),
  currentImage: text('current_image'),
  // Blue-green zero-downtime deploy: when true, a new container of the opposite
  // color is started + health-gated before the old one is retired.
  zeroDowntime: boolean('zero_downtime').notNull().default(false),
  // Currently live color ('blue' | 'green'); null = legacy single-container run.
  activeColor: text('active_color'),
  // Overrides template.healthcheckPath for the health gate (e.g. '/actuator/health').
  healthcheckPath: text('healthcheck_path'),
  // How long (seconds) to wait for the new color to become healthy before abort.
  healthTimeoutS: integer('health_timeout_s').notNull().default(60),
  status: serviceStatusEnum('status').notNull().default('CREATED'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/// Env var / secret for a service. Secret values encrypted at rest.
export const envVars = pgTable(
  'env_vars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    valueEnc: text('value_enc').notNull(),
    isSecret: boolean('is_secret').notNull().default(false),
  },
  (t) => ({
    serviceKeyUnique: unique('env_vars_service_key_unique').on(
      t.serviceId,
      t.key,
    ),
  }),
);

/// One build + release attempt of a service.
export const deployments = pgTable('deployments', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  commitSha: text('commit_sha'),
  imageTag: text('image_tag'),
  status: deployStatusEnum('status').notNull().default('QUEUED'),
  // Fine-grained pipeline stage for the UI stepper: 'build' | 'run' (in-place)
  // | 'start' | 'health' | 'switch' (blue-green). Null for legacy rows.
  phase: text('phase'),
  buildLog: text('build_log'),
  errorMsg: text('error_msg'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  finishedAt: timestamp('finished_at'),
});

/// A persistent Docker named volume mounted into a service container.
/// Data survives redeploys (containers are recreated, volumes are not).
export const volumes = pgTable(
  'volumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    // Docker volume name (e.g. vol-1a2b3c4d). Stable, generated on create.
    name: text('name').notNull().unique(),
    mountPath: text('mount_path').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    serviceMountUnique: unique('volumes_service_mount_unique').on(
      t.serviceId,
      t.mountPath,
    ),
  }),
);

/// A managed database (Postgres/MySQL) provisioned per project as a sidecar
/// container on the shared network. Password encrypted at rest (AES-256-GCM).
export const managedDatabases = pgTable('managed_databases', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => nodes.id),
  engine: dbEngineEnum('engine').notNull(),
  version: text('version').notNull(),
  name: text('name').notNull(),
  // Docker container + volume names (e.g. db-1a2b3c4d, dbvol-1a2b3c4d).
  containerName: text('container_name').notNull().unique(),
  volumeName: text('volume_name').notNull(),
  dbName: text('db_name').notNull(),
  username: text('username').notNull(),
  passwordEnc: text('password_enc').notNull(),
  // Port the engine listens on inside the network (5432 / 3306).
  internalPort: integer('internal_port').notNull(),
  status: serviceStatusEnum('status').notNull().default('CREATED'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/// A snapshot of a volume (tar.gz) or managed database (sql.gz) stored on the
/// node. `refId` points to the volume or database it belongs to.
export const backups = pgTable('backups', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: backupKindEnum('kind').notNull(),
  refId: uuid('ref_id').notNull(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => nodes.id),
  fileName: text('file_name').notNull(),
  sizeBytes: integer('size_bytes'),
  status: backupStatusEnum('status').notNull().default('RUNNING'),
  errorMsg: text('error_msg'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/// A recurring backup (cron) for a volume or database with simple retention.
export const backupSchedules = pgTable('backup_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: backupKindEnum('kind').notNull(),
  refId: uuid('ref_id').notNull(),
  cron: text('cron').notNull(),
  keepLast: integer('keep_last').notNull().default(7),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/// Public domain mapped to a service via the reverse proxy.
export const domains = pgTable('domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceId: uuid('service_id')
    .notNull()
    .unique()
    .references(() => services.id, { onDelete: 'cascade' }),
  host: text('host').notNull().unique(),
  https: boolean('https').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/// A reverse tunnel that exposes this (grey-IP) panel/Traefik through a public
/// VDS. The home-side client dials OUT to the VDS server; the VDS relays public
/// ports back. Token encrypted at rest (AES-256-GCM).
export const tunnels = pgTable('tunnels', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  // Public VDS host/IP the client dials and where the install command runs.
  serverHost: text('server_host').notNull(),
  // Control channel port on the VDS (client → server).
  controlPort: integer('control_port').notNull().default(7000),
  // Comma-separated public ports the VDS relays (e.g. "443" or "443,80").
  relayPorts: text('relay_ports').notNull().default('443'),
  // Local host the client forwards inbound connections to (usually Traefik).
  targetHost: text('target_host').notNull().default('127.0.0.1'),
  tokenEnc: text('token_enc').notNull(),
  // Optional pinned server cert SHA-256 (hex). Null = trust token only.
  fingerprint: text('fingerprint'),
  proxyProtocol: boolean('proxy_protocol').notNull().default(false),
  // Whether the client should be (re)started automatically on panel boot. Set
  // on start, cleared on stop.
  enabled: boolean('enabled').notNull().default(false),
  status: nodeStatusEnum('status').notNull().default('OFFLINE'),
  lastSeen: timestamp('last_seen'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/// The active commercial license for this installation. A singleton by
/// convention: setting a new key replaces any existing row. The signed `key`
/// is the source of truth; entitlements are derived by verifying it. An env
/// var `LICENSE_KEY` is used as a fallback when this table is empty.
export const licenses = pgTable('licenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Singleton row holding this installation's stable identity, used as the
// activation "seat" id when reporting heartbeats to the license server.
export const installation = pgTable('installation', {
  id: text('id').primaryKey().default('default'),
  instanceId: uuid('instance_id').notNull().defaultRandom(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/// Alerting (Pro: alerts). A destination for notifications (webhook, …).
export const alertChannels = pgTable('alert_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull().default('webhook'), // 'webhook'
  // Encrypted JSON config, e.g. {"url":"https://…"} — may embed secrets.
  configEnc: text('config_enc').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/// A rule wiring a monitored event to a channel.
export const alertRules = pgTable('alert_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  // 'node.offline' | 'deploy.failed' | 'backup.failed'
  event: text('event').notNull(),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => alertChannels.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/// A fired alert. Also the dedupe ledger: `dedupeKey` is unique so each incident
/// notifies exactly once.
export const alertEvents = pgTable('alert_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  event: text('event').notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('sent'), // 'sent' | 'failed'
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/// Offsite backups (Pro: offsite-backups). Singleton S3-compatible destination.
export const offsiteConfig = pgTable('offsite_config', {
  id: text('id').primaryKey().default('default'),
  enabled: boolean('enabled').notNull().default(false),
  endpoint: text('endpoint').notNull().default(''),
  region: text('region').notNull().default('us-east-1'),
  bucket: text('bucket').notNull().default(''),
  prefix: text('prefix').notNull().default(''),
  accessKeyId: text('access_key_id').notNull().default(''),
  secretKeyEnc: text('secret_key_enc').notNull().default(''),
  // MinIO and most non-AWS providers need path-style addressing.
  forcePathStyle: boolean('force_path_style').notNull().default(true),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/// Ledger of backup objects pushed to the offsite destination (one per backup).
export const offsiteUploads = pgTable('offsite_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  backupId: uuid('backup_id')
    .notNull()
    .references(() => backups.id, { onDelete: 'cascade' })
    .unique(),
  key: text('key').notNull(),
  status: text('status').notNull().default('uploaded'), // 'uploaded' | 'failed'
  sizeBytes: integer('size_bytes'),
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type DbSchema = {
  users: typeof users;
  nodes: typeof nodes;
  nodeEnrollments: typeof nodeEnrollments;
  projects: typeof projects;
  projectMembers: typeof projectMembers;
  auditLogs: typeof auditLogs;
  gitCredentials: typeof gitCredentials;
  templates: typeof templates;
  services: typeof services;
  envVars: typeof envVars;
  deployments: typeof deployments;
  domains: typeof domains;
  volumes: typeof volumes;
  managedDatabases: typeof managedDatabases;
  backups: typeof backups;
  backupSchedules: typeof backupSchedules;
  tunnels: typeof tunnels;
  licenses: typeof licenses;
  installation: typeof installation;
  alertChannels: typeof alertChannels;
  alertRules: typeof alertRules;
  alertEvents: typeof alertEvents;
  offsiteConfig: typeof offsiteConfig;
  offsiteUploads: typeof offsiteUploads;
};
