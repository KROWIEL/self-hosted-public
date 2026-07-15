export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

// ---- Domain types (mirror the control plane responses) ----

export type ServiceType = 'BACKEND' | 'FRONTEND';
export type ServiceStatus =
  | 'CREATED'
  | 'BUILDING'
  | 'RUNNING'
  | 'STOPPED'
  | 'ERROR';
export type DeployStatus =
  | 'QUEUED'
  | 'BUILDING'
  | 'DEPLOYING'
  | 'SUCCESS'
  | 'FAILED';

export interface Service {
  id: string;
  name: string;
  type: ServiceType;
  status: ServiceStatus;
  projectId: string;
  nodeId: string;
  templateId: string;
  repoUrl: string;
  branch: string;
  useRepoDockerfile: boolean;
  port: number | null;
  cpuLimit: number;
  memLimit: number;
  gitCredId: string | null;
  containerId: string | null;
  currentImage: string | null;
  zeroDowntime: boolean;
  activeColor: string | null;
  healthcheckPath: string | null;
  healthTimeoutS: number;
  // Present only on the detail endpoint (getService).
  node?: { id: string; name: string; fqdn: string; agentPort: number } | null;
  template?: {
    id: string;
    name: string;
    defaultPort: number;
    type: ServiceType;
  } | null;
  domain?: { host: string; https: boolean } | null;
}

export interface UpdateServiceBody {
  name?: string;
  repoUrl?: string;
  branch?: string;
  gitCredId?: string;
  useRepoDockerfile?: boolean;
  port?: number;
  cpuLimit?: number;
  memLimit?: number;
  zeroDowntime?: boolean;
  healthcheckPath?: string;
  healthTimeoutS?: number;
}

export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface Project {
  id: string;
  name: string;
  cpuLimit: number;
  memLimit: number;
  createdAt: string;
  services: Service[];
  /** Caller's effective role on this project (present on the detail endpoint). */
  myRole?: MemberRole | null;
}

export interface Member {
  userId: string;
  email: string;
  role: MemberRole;
  createdAt: string;
}

export const listMembers = (projectId: string) =>
  api<Member[]>(`/projects/${projectId}/members`);

export const addMember = (projectId: string, email: string, role: MemberRole) =>
  api<Member>(`/projects/${projectId}/members`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });

export const updateMember = (
  projectId: string,
  userId: string,
  role: MemberRole,
) =>
  api<Member>(`/projects/${projectId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });

export const removeMember = (projectId: string, userId: string) =>
  api<{ ok: boolean }>(`/projects/${projectId}/members/${userId}`, {
    method: 'DELETE',
  });

export interface AuditLog {
  id: string;
  userEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  projectId: string | null;
  ip: string | null;
  status: number | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export const listProjectAudit = (projectId: string) =>
  api<AuditLog[]>(`/projects/${projectId}/audit`);

export const listAudit = () => api<AuditLog[]>('/audit');

/** Downloads the platform-wide audit trail as CSV/JSON (Pro: audit-export). */
export async function exportAudit(
  format: 'csv' | 'json',
  opts: { action?: string; from?: string; to?: string; limit?: number } = {},
) {
  const token = getToken();
  const qs = new URLSearchParams({ format });
  if (opts.action) qs.set('action', opts.action);
  if (opts.from) qs.set('from', opts.from);
  if (opts.to) qs.set('to', opts.to);
  if (opts.limit) qs.set('limit', String(opts.limit));
  let res: Response;
  try {
    res = await fetch(`${API_URL}/audit/export?${qs.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  if (!res.ok) throw parseApiError(res.status, await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Alerts (Pro: alerts) ----

export interface AlertChannel {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  /** Redacted target (host only); the full URL is never returned. */
  target: string;
  createdAt: string;
}

export interface AlertRule {
  id: string;
  name: string;
  event: string;
  channelId: string;
  enabled: boolean;
  createdAt: string;
}

export interface AlertEvent {
  id: string;
  event: string;
  dedupeKey: string;
  title: string;
  body: string;
  status: string;
  error: string | null;
  createdAt: string;
}

export const listAlertMeta = () => api<{ events: string[] }>('/alerts/meta');

export const listAlertChannels = () =>
  api<AlertChannel[]>('/alerts/channels');
export const createAlertChannel = (body: { name: string; url: string }) =>
  api<AlertChannel>('/alerts/channels', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const updateAlertChannel = (
  id: string,
  body: { name?: string; url?: string; enabled?: boolean },
) =>
  api<AlertChannel>(`/alerts/channels/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
export const deleteAlertChannel = (id: string) =>
  api<{ ok: true }>(`/alerts/channels/${id}`, { method: 'DELETE' });
export const testAlertChannel = (id: string) =>
  api<{ ok: true }>(`/alerts/channels/${id}/test`, { method: 'POST' });

export const listAlertRules = () => api<AlertRule[]>('/alerts/rules');
export const createAlertRule = (body: {
  name: string;
  event: string;
  channelId: string;
}) =>
  api<AlertRule>('/alerts/rules', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const updateAlertRule = (
  id: string,
  body: { name?: string; enabled?: boolean },
) =>
  api<AlertRule>(`/alerts/rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
export const deleteAlertRule = (id: string) =>
  api<{ ok: true }>(`/alerts/rules/${id}`, { method: 'DELETE' });

export const listAlertEvents = () => api<AlertEvent[]>('/alerts/events');

// ---- Offsite backups (Pro: offsite-backups) ----

export interface OffsiteConfig {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  forcePathStyle: boolean;
  /** Whether a secret key is stored; the value itself is never returned. */
  secretKeySet: boolean;
  updatedAt: string | null;
}

export interface OffsiteConfigInput {
  enabled?: boolean;
  endpoint?: string;
  region?: string;
  bucket?: string;
  prefix?: string;
  accessKeyId?: string;
  /** Omit to keep the stored secret; send a value to rotate it. */
  secretKey?: string;
  forcePathStyle?: boolean;
}

export interface OffsiteUpload {
  id: string;
  backupId: string;
  key: string;
  status: string;
  sizeBytes: number | null;
  error: string | null;
  createdAt: string;
  fileName: string | null;
}

export const getOffsiteConfig = () => api<OffsiteConfig>('/offsite/config');
export const setOffsiteConfig = (body: OffsiteConfigInput) =>
  api<OffsiteConfig>('/offsite/config', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
export const testOffsite = () =>
  api<{ ok: true }>('/offsite/test', { method: 'POST' });
export const listOffsiteUploads = () =>
  api<OffsiteUpload[]>('/offsite/uploads');
export const syncOffsite = () =>
  api<{ uploaded: number; failed: number }>('/offsite/sync', {
    method: 'POST',
  });
export const uploadBackupOffsite = (id: string) =>
  api<{ ok: boolean; key?: string; error?: string }>(`/offsite/backups/${id}`, {
    method: 'POST',
  });

// ---- Personal API tokens (Pro: api-cli) ----

export interface ApiToken {
  id: string;
  name: string;
  preview: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export const listApiTokens = () => api<ApiToken[]>('/api-tokens');
export const createApiToken = (body: {
  name: string;
  expiresInDays?: number;
}) =>
  api<{ token: string; item: ApiToken }>('/api-tokens', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const revokeApiToken = (id: string) =>
  api<{ ok: true }>(`/api-tokens/${id}`, { method: 'DELETE' });

// ---- White-label branding (Pro: white-label) ----

export interface BrandingEffective {
  appName: string;
  logoUrl: string;
  accentColor: string;
  showPoweredBy: boolean;
}

export interface BrandingConfig {
  appName: string;
  logoUrl: string;
  accentColor: string;
  hidePoweredBy: boolean;
}

/** Public, license-aware branding (safe to call before login). */
export const getBranding = () => api<BrandingEffective>('/branding');
export const getBrandingConfig = () =>
  api<BrandingConfig>('/branding/config');
export const setBranding = (body: Partial<BrandingConfig>) =>
  api<BrandingConfig>('/branding/config', {
    method: 'PUT',
    body: JSON.stringify(body),
  });

// ---- Metrics history (Pro: metrics-history) ----

export interface MetricPoint {
  ts: string;
  cpuPct: number | null;
  memPct: number | null;
  diskPct: number | null;
}

export const getNodeMetrics = (nodeId: string, hours: number) =>
  api<MetricPoint[]>(`/metrics/nodes/${nodeId}?hours=${hours}`);

// ---- Single sign-on / OIDC (Pro: sso) ----

/** Public login-page status: whether the SSO button should be shown. */
export interface SsoStatus {
  enabled: boolean;
  label: string;
}

/** Admin config view (the client secret is never returned). */
export interface SsoConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  allowedDomains: string;
  autoCreate: boolean;
  buttonLabel: string;
  /** The exact redirect URI to register at the identity provider. */
  redirectUri: string;
}

export interface SsoConfigInput {
  enabled?: boolean;
  issuer?: string;
  clientId?: string;
  /** Only sent when set/changed; omit to keep the stored secret. */
  clientSecret?: string;
  allowedDomains?: string;
  autoCreate?: boolean;
  buttonLabel?: string;
}

/** Public, license-aware SSO status (safe to call before login). */
export const getSsoStatus = () => api<SsoStatus>('/auth/sso/status');

export const getSsoConfig = () => api<SsoConfig>('/auth/sso/config');

export const setSsoConfig = (body: SsoConfigInput) =>
  api<SsoConfig>('/auth/sso/config', {
    method: 'PUT',
    body: JSON.stringify(body),
  });

/** Top-level URL to begin the OIDC flow (browser navigates here directly). */
export const ssoStartUrl = () => `${API_URL}/auth/sso/start`;

/** Persist a session obtained out-of-band (e.g. from the SSO callback). */
export function setSession(accessToken: string, refreshToken: string) {
  window.localStorage.setItem('accessToken', accessToken);
  window.localStorage.setItem('refreshToken', refreshToken);
}

export interface Node {
  id: string;
  name: string;
  fqdn: string;
  agentPort: number;
  cpuTotal: number | null;
  memTotal: number | null;
  status: 'ONLINE' | 'OFFLINE';
  remote: boolean;
  tlsFingerprint: string | null;
  agentVersion: string | null;
  lastSeen: string | null;
  createdAt: string;
}

export interface NodeWithToken extends Node {
  daemonTokenPlaintext: string;
}

export interface NodeInstall {
  nodeId: string;
  joinToken: string;
  agentPort: number;
  binUrls: Record<string, string>;
  commands: { linux: string };
}

export interface TemplateVariable {
  name: string;
  envVariable: string;
  defaultValue: string;
  description?: string;
  rules?: string;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  type: ServiceType;
  baseImage: string;
  dockerfilePath: string | null;
  installImage: string;
  installScript: string;
  defaultBuildCommand: string;
  defaultRunCommand: string;
  defaultPort: number;
  healthcheckPath: string | null;
  variables: TemplateVariable[];
  isBuiltIn: boolean;
}

/** Editable fields for creating/updating a template. */
export interface TemplateInput {
  name: string;
  description?: string;
  category?: string;
  type: ServiceType;
  baseImage: string;
  dockerfilePath?: string;
  installImage: string;
  installScript: string;
  defaultBuildCommand: string;
  defaultRunCommand: string;
  defaultPort: number;
  healthcheckPath?: string;
  variables: TemplateVariable[];
}

export type DeployPhase = 'build' | 'run' | 'start' | 'health' | 'switch';

export interface Deployment {
  id: string;
  serviceId: string;
  status: DeployStatus;
  phase: DeployPhase | null;
  commitSha: string | null;
  imageTag: string | null;
  buildLog: string | null;
  errorMsg: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface EnvVar {
  key: string;
  value: string;
  isSecret: boolean;
}

export type GitProvider = 'GITHUB' | 'GITLAB';

export interface GitCredential {
  id: string;
  name: string;
  provider: GitProvider;
  username: string | null;
  createdAt: string;
}

// ---- Auth token storage ----

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('accessToken');
}

export function isAuthed(): boolean {
  return getToken() !== null;
}

export function logout() {
  window.localStorage.removeItem('accessToken');
  window.localStorage.removeItem('refreshToken');
  window.localStorage.removeItem('mustChangePassword');
}

const MUST_CHANGE_KEY = 'mustChangePassword';

/** Whether the signed-in account must change its (weak) password. */
export function getMustChangePassword(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(MUST_CHANGE_KEY) === '1';
}

export function setMustChangePassword(value: boolean) {
  if (typeof window === 'undefined') return;
  if (value) window.localStorage.setItem(MUST_CHANGE_KEY, '1');
  else window.localStorage.removeItem(MUST_CHANGE_KEY);
}

// ---- Core fetch helper ----

/** Error carrying the HTTP status, an optional stable code and a message. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Machine-readable code (e.g. 'auth.emailTaken') for localization. */
    public readonly code?: string,
    /** Interpolation values for the localized message (e.g. roles). */
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Extracts a readable message + code from the control-plane's unified body. */
function parseApiError(status: number, raw: string): ApiError {
  try {
    const body = JSON.parse(raw) as {
      message?: string | string[];
      code?: string;
      meta?: Record<string, unknown>;
    };
    const msg = Array.isArray(body.message)
      ? body.message.join(', ')
      : body.message;
    if (msg) return new ApiError(status, msg, body.code, body.meta);
  } catch {
    /* not JSON — fall through */
  }
  return new ApiError(status, raw || `Request failed (${status})`);
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    });
  } catch {
    // Network/connection failure (server down, offline, CORS).
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  if (!res.ok) {
    throw parseApiError(res.status, await res.text());
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---- Auth ----

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface AuthResult extends TokenPair {
  needsOnboarding?: boolean;
  mustChangePassword?: boolean;
}

// ---- Commercial licensing / entitlements (mirror @selfhosted/shared) ----

export type LicenseTier = 'free' | 'homelab' | 'pro';

export type LicenseModule =
  | 'reverse-tunnels'
  | 'preview-envs'
  | 'offsite-backups'
  | 'alerts'
  | 'metrics-history'
  | 'sso'
  | 'audit-export'
  | 'api-cli'
  | 'white-label';

export interface ActivationStatus {
  required: boolean;
  ok: boolean;
  lastCheckAt: number | null;
  reason?: string;
}

export interface Entitlements {
  tier: LicenseTier;
  modules: LicenseModule[];
  expiresAt: number | null;
  licensed: boolean;
  subject?: string;
  name?: string;
  activation?: ActivationStatus;
}

export const FREE_ENTITLEMENTS: Entitlements = {
  tier: 'free',
  modules: [],
  expiresAt: null,
  licensed: false,
};

export interface AuthMe {
  id: string;
  email: string;
  role: 'ADMIN' | 'USER';
  firstName: string | null;
  lastName: string | null;
  twoFactor: boolean;
  onboardedAt: string | null;
  needsOnboarding: boolean;
  mustChangePassword: boolean;
  entitlements: Entitlements;
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

function storeTokens(tokens: TokenPair) {
  window.localStorage.setItem('accessToken', tokens.accessToken);
  window.localStorage.setItem('refreshToken', tokens.refreshToken);
}

export async function login(email: string, password: string, totp?: string) {
  const res = await api<AuthResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }),
  });
  storeTokens(res);
  setMustChangePassword(!!res.mustChangePassword);
  return res;
}

/** Stage 1: create the account and sign in (still needs onboarding). */
export async function register(email: string, password: string) {
  const res = await api<AuthResult>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  storeTokens(res);
  return res;
}

/** Stage 2: fetch a fresh TOTP secret + QR to display. */
export const begin2fa = () =>
  api<TwoFactorSetup>('/auth/2fa/setup', { method: 'POST' });

/** Stage 2: submit personal data + confirm the TOTP code. */
export const completeOnboarding = (body: {
  firstName: string;
  lastName: string;
  totpSecret: string;
  totpCode: string;
}) =>
  api<{ ok: boolean }>('/auth/onboarding', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const getMe = () => api<AuthMe>('/auth/me');

/** Settings: update personal data on the current account. */
export const updateProfile = (body: { firstName: string; lastName: string }) =>
  api<{ ok: boolean }>('/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

/** Settings: change the account password (requires the current one). */
export const changePassword = async (body: {
  currentPassword: string;
  newPassword: string;
}) => {
  const res = await api<{ ok: boolean }>('/auth/password', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  setMustChangePassword(false);
  return res;
};

/** Settings: enable 2FA by confirming a code for a freshly issued secret. */
export const enable2fa = (body: { totpSecret: string; totpCode: string }) =>
  api<{ ok: boolean }>('/auth/2fa/enable', {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** Settings: disable 2FA after re-entering the account password. */
export const disable2fa = (body: { password: string }) =>
  api<{ ok: boolean }>('/auth/2fa/disable', {
    method: 'POST',
    body: JSON.stringify(body),
  });

// ---- Projects ----

export const listProjects = () => api<Project[]>('/projects');
export const getProject = (id: string) => api<Project>(`/projects/${id}`);
export const createProject = (body: {
  name: string;
  cpuLimit?: number;
  memLimit?: number;
}) => api<Project>('/projects', { method: 'POST', body: JSON.stringify(body) });
export const updateProjectLimits = (
  id: string,
  body: { cpuLimit: number; memLimit: number },
) =>
  api<Project>(`/projects/${id}/limits`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
export const deleteProject = (id: string) =>
  api<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' });

export interface PlatformResourceSummary {
  nodes: number;
  projects: number;
  services: number;
  hostCpuCores: number;
  hostMemMb: number;
  capacityCpu: number;
  capacityMemMb: number;
  projectCpuLimit: number;
  projectMemLimit: number;
  serviceCpuAllocated: number;
  serviceMemAllocated: number;
  availableProjectCpu: number;
  availableProjectMemMb: number;
  currentCpuPerc: number;
  currentMemMb: number;
}

export const getPlatformResourceSummary = () =>
  api<PlatformResourceSummary>('/projects/resource-summary/platform');

// ---- Nodes ----

export const listNodes = () => api<Node[]>('/nodes');
export const createNode = (body: {
  name: string;
  fqdn: string;
  agentPort?: number;
  cpuTotal?: number;
  memTotal?: number;
}) =>
  api<NodeWithToken>('/nodes', { method: 'POST', body: JSON.stringify(body) });
export const updateNodeCapacity = (
  id: string,
  body: { cpuTotal: number; memTotal: number },
) =>
  api<Node>(`/nodes/${id}/capacity`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
export const deleteNode = (id: string) =>
  api<{ ok: boolean }>(`/nodes/${id}`, { method: 'DELETE' });

export const createRemoteNode = (body: {
  name: string;
  fqdn: string;
  agentPort?: number;
}) =>
  api<Node>('/nodes/remote', { method: 'POST', body: JSON.stringify(body) });

export const getNodeInstall = (id: string) =>
  api<NodeInstall>(`/nodes/${id}/install`);

export interface AgentStatus {
  enabled: boolean;
  running: boolean;
  startedAt: string | null;
  logs: string[];
}

export const startNodeAgent = (id: string) =>
  api<AgentStatus>(`/nodes/${id}/agent/start`, { method: 'POST' });
export const stopNodeAgent = (id: string) =>
  api<{ running: boolean }>(`/nodes/${id}/agent/stop`, { method: 'POST' });
export const nodeAgentStatus = (id: string) =>
  api<AgentStatus>(`/nodes/${id}/agent/status`);

// ---- Templates ----

export const listTemplates = () => api<Template[]>('/templates');

export const createTemplate = (body: TemplateInput) =>
  api<Template>('/templates', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateTemplate = (id: string, body: Partial<TemplateInput>) =>
  api<Template>(`/templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const deleteTemplate = (id: string) =>
  api<{ ok: boolean }>(`/templates/${id}`, { method: 'DELETE' });

// ---- Git credentials ----

export const listGitCredentials = () =>
  api<GitCredential[]>('/git-credentials');
export const createGitCredential = (body: {
  name: string;
  provider: GitProvider;
  username?: string;
  pat: string;
}) =>
  api<GitCredential>('/git-credentials', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const verifyGitCredential = (id: string, repoUrl: string) =>
  api<{ ok: boolean; message: string }>(`/git-credentials/${id}/verify`, {
    method: 'POST',
    body: JSON.stringify({ repoUrl }),
  });
export const deleteGitCredential = (id: string) =>
  api<{ ok: boolean }>(`/git-credentials/${id}`, { method: 'DELETE' });

// ---- Services ----

export interface CreateServiceBody {
  name: string;
  type: ServiceType;
  nodeId: string;
  templateId: string;
  repoUrl: string;
  branch?: string;
  gitCredId?: string;
  useRepoDockerfile?: boolean;
  port?: number;
  cpuLimit?: number;
  memLimit?: number;
  env?: Record<string, string>;
}

export const getService = (id: string) => api<Service>(`/services/${id}`);
export const createService = (projectId: string, body: CreateServiceBody) =>
  api<Service>(`/projects/${projectId}/services`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const deleteService = (id: string) =>
  api<{ ok: boolean }>(`/services/${id}`, { method: 'DELETE' });
export const deployService = (id: string) =>
  api<Deployment>(`/services/${id}/deploy`, { method: 'POST' });
export const listDeployments = (id: string) =>
  api<Deployment[]>(`/services/${id}/deployments`);
export const powerService = (
  id: string,
  action: 'start' | 'stop' | 'restart',
) => api<Service>(`/services/${id}/${action}`, { method: 'POST' });
/**
 * Opens the live runtime log stream for a service. Returns the raw Response so
 * the caller can read `response.body` as a ReadableStream.
 */
export async function streamServiceLogs(
  id: string,
  signal?: AbortSignal,
): Promise<Response> {
  const token = getToken();
  const res = await fetch(`${API_URL}/services/${id}/logs/stream`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`API ${res.status}`);
  }
  return res;
}

/**
 * Builds the WebSocket URL for an interactive container shell. The access token
 * is passed as a query param because browsers can't set WS headers.
 */
export function execSocketUrl(serviceId: string): string {
  const token = getToken() ?? '';
  const wsBase = API_URL.replace(/^http/, 'ws');
  return `${wsBase}/services/${serviceId}/exec?token=${encodeURIComponent(token)}`;
}

/** Opens the live build-log stream for a deployment (see streamServiceLogs). */
export async function streamDeploymentLogs(
  deploymentId: string,
  signal?: AbortSignal,
): Promise<Response> {
  const token = getToken();
  const res = await fetch(`${API_URL}/deployments/${deploymentId}/logs/stream`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`API ${res.status}`);
  }
  return res;
}

export interface ServiceStats {
  running: boolean;
  state: string;
  error?: string;
  health?: string;
  cpuPerc?: string;
  memUsage?: string;
  memPerc?: string;
  netIO?: string;
  blockIO?: string;
  pids?: string;
}

export const getServiceStats = (id: string) =>
  api<ServiceStats>(`/services/${id}/stats`);

export interface NodeSystem {
  version: string;
  reachable?: boolean;
  error?: string;
  containersRunning?: number;
  containersTotal?: number;
  imagesCount?: string;
  imagesSize?: string;
  imagesReclaimable?: string;
  volumesSize?: string;
  buildCacheSize?: string;
}

export const getNodeSystem = (id: string) =>
  api<NodeSystem>(`/nodes/${id}/system`);

export interface NodeStats {
  reachable: boolean;
  /** Aggregate CPU across all containers, in Docker units (100 = one core). */
  cpuPerc: number;
  /** Aggregate used memory across all containers, in MB. */
  memUsageMb: number;
  containers: number;
}

export const getNodeStats = (id: string) =>
  api<NodeStats>(`/nodes/${id}/stats`);

export interface NodeHost {
  reachable: boolean;
  error?: string;
  cpuCores?: number;
  load1?: number;
  load5?: number;
  load15?: number;
  memTotalMb?: number;
  memUsedMb?: number;
  memUsedPerc?: number;
  diskTotalGb?: number;
  diskUsedGb?: number;
  diskUsedPerc?: number;
}

export const getNodeHost = (id: string) =>
  api<NodeHost>(`/nodes/${id}/host`);

export interface NodePruneResult {
  ok: boolean;
  error?: string;
  system?: string;
  builder?: string;
  volumes?: string;
  imagesReclaimable?: string;
}

export const pruneNode = (
  id: string,
  opts: { all?: boolean; volumes?: boolean } = {},
) =>
  api<NodePruneResult>(`/nodes/${id}/prune`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });

export interface NodeWorkloadService {
  id: string;
  name: string;
  type: ServiceType;
  status: ServiceStatus;
  projectId: string;
  projectName: string | null;
}

export interface NodeWorkloadDatabase {
  id: string;
  name: string;
  engine: DbEngine;
  status: ServiceStatus;
  projectId: string;
  projectName: string | null;
}

export interface NodeWorkloads {
  services: NodeWorkloadService[];
  databases: NodeWorkloadDatabase[];
}

export const getNodeWorkloads = (id: string) =>
  api<NodeWorkloads>(`/nodes/${id}/workloads`);

export interface ProjectResourceSummary {
  servicesTotal: number;
  servicesRunning: number;
  allocatedCpu: number;
  allocatedMemMb: number;
  cpuLimit: number;
  memLimit: number;
  availableCpu: number;
  availableMemMb: number;
  currentCpuPerc: number;
  currentMemMb: number;
  partial: boolean;
  unavailable: { serviceId: string; name: string; error: string }[];
}

export const getProjectResourceSummary = (id: string) =>
  api<ProjectResourceSummary>(`/projects/${id}/resource-summary`);

export const updateService = (id: string, body: UpdateServiceBody) =>
  api<Service>(`/services/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const rollbackDeployment = (deploymentId: string) =>
  api<Deployment>(`/deployments/${deploymentId}/rollback`, { method: 'POST' });

export const getWebhook = (id: string) =>
  api<{ token: string; path: string }>(`/services/${id}/webhook`);

export const listEnv = (id: string) => api<EnvVar[]>(`/services/${id}/env`);
export const setEnv = (
  id: string,
  vars: { key: string; value: string; isSecret?: boolean }[],
) =>
  api<EnvVar[]>(`/services/${id}/env`, {
    method: 'PUT',
    body: JSON.stringify({ vars }),
  });
export const deleteEnv = (id: string, key: string) =>
  api<EnvVar[]>(`/services/${id}/env/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });

// ---- Repo auto-setup (scan .env.example + databases) ----

export type DbRole = 'url' | 'host' | 'port' | 'name' | 'user' | 'password';

export interface InspectEnvKey {
  key: string;
  example: string;
  dbRole?: DbRole;
  dbName?: string;
}

export interface DatabaseNeed {
  engine: DbEngine;
  schemas: string[];
}

export interface RepoInspect {
  envFile: string;
  envKeys: InspectEnvKey[];
  databases: DatabaseNeed[];
  existingKeys: string[];
}

export const inspectRepo = (serviceId: string) =>
  api<RepoInspect>(`/services/${serviceId}/inspect`);
export const setupFromRepo = (
  serviceId: string,
  body: { databases: DatabaseNeed[]; envKeys: InspectEnvKey[] },
) =>
  api<{ databases: ManagedDatabase[]; envSet: number }>(
    `/services/${serviceId}/setup`,
    { method: 'POST', body: JSON.stringify(body) },
  );
export const setDomain = (id: string, host: string, https = true) =>
  api<unknown>(`/services/${id}/domain`, {
    method: 'PUT',
    body: JSON.stringify({ host, https }),
  });

// ---- Persistent volumes ----

export interface Volume {
  id: string;
  serviceId: string;
  name: string;
  mountPath: string;
  createdAt: string;
}

export const listVolumes = (serviceId: string) =>
  api<Volume[]>(`/services/${serviceId}/volumes`);
export const addVolume = (serviceId: string, mountPath: string) =>
  api<Volume>(`/services/${serviceId}/volumes`, {
    method: 'POST',
    body: JSON.stringify({ mountPath }),
  });
export const removeVolume = (serviceId: string, volumeId: string) =>
  api<{ ok: boolean }>(`/services/${serviceId}/volumes/${volumeId}`, {
    method: 'DELETE',
  });

// ---- Managed databases ----

export type DbEngine = 'POSTGRES' | 'MYSQL';

export interface ManagedDatabase {
  id: string;
  projectId: string;
  nodeId: string;
  name: string;
  engine: DbEngine;
  version: string;
  status: ServiceStatus;
  host: string;
  port: number;
  dbName: string;
  username: string;
}

export interface DbCredentials {
  host: string;
  port: number;
  dbName: string;
  username: string;
  password: string;
  url: string;
}

export interface DbStatus {
  running: boolean;
  state: string;
  ready: boolean;
}

export interface CreateDatabaseBody {
  name: string;
  engine: DbEngine;
  version?: string;
  nodeId: string;
  dbName?: string;
  username?: string;
}

export const listDatabases = (projectId: string) =>
  api<ManagedDatabase[]>(`/projects/${projectId}/databases`);
export const createDatabase = (projectId: string, body: CreateDatabaseBody) =>
  api<ManagedDatabase>(`/projects/${projectId}/databases`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const databaseStatus = (id: string) =>
  api<DbStatus>(`/databases/${id}/status`);
export const databaseCredentials = (id: string) =>
  api<DbCredentials>(`/databases/${id}/credentials`);
export const powerDatabase = (id: string, action: 'start' | 'stop' | 'restart') =>
  api<ManagedDatabase>(`/databases/${id}/power`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
export const attachDatabase = (id: string, serviceId: string) =>
  api<{ ok: boolean }>(`/databases/${id}/attach`, {
    method: 'POST',
    body: JSON.stringify({ serviceId }),
  });
export const deleteDatabase = (id: string, keepVolume: boolean) =>
  api<{ ok: boolean }>(
    `/databases/${id}?keepVolume=${keepVolume ? 'true' : 'false'}`,
    { method: 'DELETE' },
  );

// ---- Backups ----

export type BackupKind = 'VOLUME' | 'DATABASE';
export type BackupStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface Backup {
  id: string;
  kind: BackupKind;
  refId: string;
  nodeId: string;
  fileName: string;
  sizeBytes: number | null;
  status: BackupStatus;
  errorMsg: string | null;
  createdAt: string;
}

export interface BackupSchedule {
  id: string;
  kind: BackupKind;
  refId: string;
  cron: string;
  keepLast: number;
  enabled: boolean;
  createdAt: string;
}

export const listBackups = (kind: BackupKind, refId: string) =>
  api<Backup[]>(`/backups?kind=${kind}&refId=${refId}`);
export const createBackup = (kind: BackupKind, refId: string) =>
  api<Backup>('/backups', {
    method: 'POST',
    body: JSON.stringify({ kind, refId }),
  });
export const restoreBackup = (id: string) =>
  api<{ ok: boolean }>(`/backups/${id}/restore`, { method: 'POST' });
export const deleteBackup = (id: string) =>
  api<{ ok: boolean }>(`/backups/${id}`, { method: 'DELETE' });

/** Streams a backup file to the browser as a download (auth via header). */
export async function downloadBackup(id: string, fileName: string) {
  const token = getToken();
  const res = await fetch(`${API_URL}/backups/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const listBackupSchedules = (kind: BackupKind, refId: string) =>
  api<BackupSchedule[]>(`/backup-schedules?kind=${kind}&refId=${refId}`);
export const createBackupSchedule = (body: {
  kind: BackupKind;
  refId: string;
  cron: string;
  keepLast?: number;
}) =>
  api<BackupSchedule>('/backup-schedules', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const deleteBackupSchedule = (id: string) =>
  api<{ ok: boolean }>(`/backup-schedules/${id}`, { method: 'DELETE' });

// ---- Tunnels (exposure via public VDS relay) ----

export interface Tunnel {
  id: string;
  name: string;
  serverHost: string;
  controlPort: number;
  relayPorts: string;
  targetHost: string;
  proxyProtocol: boolean;
  enabled: boolean;
  status: 'ONLINE' | 'OFFLINE';
  lastSeen: string | null;
  running: boolean;
  connected: boolean;
  createdAt: string;
}

export interface TunnelStatus {
  enabled: boolean;
  running: boolean;
  connected: boolean;
  status: 'ONLINE' | 'OFFLINE';
  startedAt: string | null;
  logs: string[];
}

export interface TunnelInstall extends Tunnel {
  token: string;
  serverAddr: string;
  binUrls: Record<string, string>;
  commands: { linux: string; windows: string };
  offline: { download: string; copy: string; run: string };
}

export interface CreateTunnelBody {
  name: string;
  serverHost: string;
  controlPort?: number;
  relayPorts?: string;
  targetHost?: string;
  proxyProtocol?: boolean;
}

export const listTunnels = () => api<Tunnel[]>('/tunnels');
export const createTunnel = (body: CreateTunnelBody) =>
  api<Tunnel>('/tunnels', { method: 'POST', body: JSON.stringify(body) });
export const updateTunnel = (id: string, body: Partial<CreateTunnelBody>) =>
  api<Tunnel>(`/tunnels/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteTunnel = (id: string) =>
  api<{ ok: boolean }>(`/tunnels/${id}`, { method: 'DELETE' });
export const startTunnel = (id: string) =>
  api<TunnelStatus>(`/tunnels/${id}/start`, { method: 'POST' });
export const stopTunnel = (id: string) =>
  api<TunnelStatus>(`/tunnels/${id}/stop`, { method: 'POST' });
export const tunnelStatus = (id: string) =>
  api<TunnelStatus>(`/tunnels/${id}/status`);
export const tunnelInstall = (id: string) =>
  api<TunnelInstall>(`/tunnels/${id}/install`);

// ---- Licensing / billing ----

/** Current effective entitlements for this installation. */
export const getLicense = () => api<Entitlements>('/license');

/** Activate / replace the installation license key (admin only). */
export const setLicense = (key: string) =>
  api<Entitlements>('/license', {
    method: 'PUT',
    body: JSON.stringify({ key }),
  });

/** Remove the stored license key, reverting to Free (admin only). */
export const clearLicense = () =>
  api<Entitlements>('/license', { method: 'DELETE' });
