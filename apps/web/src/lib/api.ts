export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

// ---- Domain types (mirror the control plane responses) ----

export type ServiceType = 'BACKEND' | 'FRONTEND';
export type DeployKind = 'git' | 'image' | 'compose';
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
  templateId: string | null;
  deployKind: DeployKind;
  repoUrl: string | null;
  image: string | null;
  composeFile: string | null;
  composeYaml: string | null;
  branch: string;
  useRepoDockerfile: boolean;
  buildMode: 'template' | 'dockerfile' | 'nixpacks';
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
  buildMode?: 'template' | 'dockerfile' | 'nixpacks';
  image?: string;
  composeFile?: string;
  composeYaml?: string;
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
  const qs = new URLSearchParams({ format });
  if (opts.action) qs.set('action', opts.action);
  if (opts.from) qs.set('from', opts.from);
  if (opts.to) qs.set('to', opts.to);
  if (opts.limit) qs.set('limit', String(opts.limit));
  let res: Response;
  try {
    // Session travels in the HttpOnly cookie (H-1); include credentials.
    res = await fetch(`${API_URL}/audit/export?${qs.toString()}`, {
      credentials: 'include',
    });
  } catch {
    throw new ApiError(
      0,
      'Cannot reach the server. Check your connection.',
      'network.unreachable',
    );
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

export interface AlertEventGroup {
  group: string;
  events: string[];
}

export const listAlertMeta = () =>
  api<{ events: string[]; groups: AlertEventGroup[] }>('/alerts/meta');

export type AlertChannelType = 'webhook' | 'discord' | 'slack' | 'telegram';

export const listAlertChannels = () =>
  api<AlertChannel[]>('/alerts/channels');
export const createAlertChannel = (body: {
  name: string;
  type?: AlertChannelType;
  url?: string;
  botToken?: string;
  chatId?: string;
}) =>
  api<AlertChannel>('/alerts/channels', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const updateAlertChannel = (
  id: string,
  body: {
    name?: string;
    url?: string;
    botToken?: string;
    chatId?: string;
    enabled?: boolean;
  },
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

export type OffsiteProvider = 's3' | 'gcs' | 'azure' | 'sftp';

export interface OffsiteProviderConfig {
  accountName?: string;
  container?: string;
  useConnectionString?: boolean;
  host?: string;
  port?: number;
  username?: string;
  remotePath?: string;
  authMethod?: 'password' | 'privateKey';
}

export interface OffsiteConfig {
  enabled: boolean;
  provider: OffsiteProvider;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  forcePathStyle: boolean;
  providerConfig: OffsiteProviderConfig;
  /** Whether a secret key is stored; the value itself is never returned. */
  secretKeySet: boolean;
  updatedAt: string | null;
}

export interface OffsiteConfigInput {
  enabled?: boolean;
  provider?: OffsiteProvider;
  endpoint?: string;
  region?: string;
  bucket?: string;
  prefix?: string;
  accessKeyId?: string;
  /** Omit to keep the stored secret; send a value to rotate it. */
  secretKey?: string;
  forcePathStyle?: boolean;
  providerConfig?: OffsiteProviderConfig;
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

// ---- Certificates (Free core) ----

export interface DomainCertificate {
  id: string;
  host: string;
  https: boolean;
  certSource: 'acme' | 'custom';
  customCertSet: boolean;
  status: 'acme' | 'custom' | 'http-only';
  serviceId: string;
  serviceName: string;
  nodeId: string;
  nodeName: string | null;
  createdAt: string;
}

export interface TlsSettings {
  acmeEmail: string;
  dnsProvider: string;
  wildcardEnabled: boolean;
  cloudflareTokenSet: boolean;
  env: {
    acmeEmail: string;
    dnsProvider: string;
    wildcardEnabled: boolean;
    cloudflareTokenSet: boolean;
  };
  updatedAt: string | null;
}

export interface TlsSettingsInput {
  acmeEmail?: string;
  dnsProvider?: string;
  wildcardEnabled?: boolean;
  cloudflareToken?: string;
}

export const listDomainCertificates = () =>
  api<DomainCertificate[]>('/certificates');
export const setDomainCustomCert = (
  id: string,
  body: { certPem: string; keyPem: string },
) =>
  api<DomainCertificate>(`/certificates/${id}/custom`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
export const clearDomainCustomCert = (id: string) =>
  api<DomainCertificate>(`/certificates/${id}/custom`, { method: 'DELETE' });
export const getTlsSettings = () =>
  api<TlsSettings>('/certificates/tls-settings');
export const setTlsSettings = (body: TlsSettingsInput) =>
  api<TlsSettings>('/certificates/tls-settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  });

// ---- Email (Pro: email) ----

export interface EmailConfig {
  enabled: boolean;
  host: string;
  port: number;
  /** true = implicit TLS (:465); false = STARTTLS (:587). */
  secure: boolean;
  username: string;
  fromName: string;
  fromEmail: string;
  /** Whether an SMTP password is stored; the value itself is never returned. */
  passwordSet: boolean;
  updatedAt: string | null;
}

export interface EmailConfigInput {
  enabled?: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  /** Omit to keep the stored password; send a value to rotate it. */
  password?: string;
  fromName?: string;
  fromEmail?: string;
}

export interface EmailMessage {
  id: string;
  subject: string;
  recipientKind: string;
  recipientCount: number;
  status: string;
  error: string | null;
  createdAt: string;
}

export const getEmailConfig = () => api<EmailConfig>('/email/config');
export const setEmailConfig = (body: EmailConfigInput) =>
  api<EmailConfig>('/email/config', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
export const sendTestEmail = (to?: string) =>
  api<{ ok: true; to: string }>('/email/test', {
    method: 'POST',
    body: JSON.stringify(to ? { to } : {}),
  });
export const sendEmailMessage = (body: {
  subject: string;
  body: string;
  recipientKind: 'all' | 'custom';
  recipients?: string;
}) =>
  api<{ ok: true; recipientCount: number; id: string }>('/email/send', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const listEmailMessages = () => api<EmailMessage[]>('/email/messages');

// ---- Personal API tokens (Pro: api-cli) ----

export type ApiTokenScope = 'read' | 'full' | 'admin';

export interface ApiToken {
  id: string;
  name: string;
  preview: string;
  scopes: ApiTokenScope[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export const listApiTokens = () => api<ApiToken[]>('/api-tokens');
export const createApiToken = (body: {
  name: string;
  expiresInDays?: number;
  /** Defaults to least-privilege `read` on the client. */
  scopes?: ApiTokenScope[];
}) =>
  api<{ token: string; item: ApiToken }>('/api-tokens', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const revokeApiToken = (id: string) =>
  api<{ ok: true }>(`/api-tokens/${id}`, { method: 'DELETE' });

// ---- Admin registration invites (when ALLOW_OPEN_REGISTRATION is off) ----

export interface Invite {
  id: string;
  email: string | null;
  role: 'USER' | 'ADMIN';
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  status: 'pending' | 'used' | 'expired';
}

export const listInvites = () => api<Invite[]>('/invites');
export const createInvite = (body: {
  email?: string;
  expiresInDays?: number;
  role?: 'USER' | 'ADMIN';
}) =>
  api<{ token: string; url?: string; invite: Invite }>('/invites', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const revokeInvite = (id: string) =>
  api<{ ok: true }>(`/invites/${id}`, { method: 'DELETE' });

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

// ---- Preview environments (Pro: preview-envs) ----

export interface PreviewEnv {
  id: string;
  parentServiceId: string;
  parentName: string | null;
  serviceId: string;
  serviceName: string | null;
  branch: string;
  host: string | null;
  https: boolean;
  serviceStatus: ServiceStatus | null;
  latestDeployStatus: DeployStatus | null;
  latestDeployPhase: DeployPhase | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreatePreviewInput {
  branch: string;
  host?: string;
  ttlHours?: number;
}

export const listPreviews = () => api<PreviewEnv[]>('/previews');

export const listServicePreviews = (serviceId: string) =>
  api<PreviewEnv[]>(`/services/${serviceId}/previews`);

export const createPreview = (serviceId: string, body: CreatePreviewInput) =>
  api<PreviewEnv>(`/services/${serviceId}/previews`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const redeployPreview = (id: string) =>
  api<PreviewEnv>(`/previews/${id}/redeploy`, { method: 'POST' });

export const deletePreview = (id: string) =>
  api<{ ok: boolean }>(`/previews/${id}`, { method: 'DELETE' });

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

// ---- Auth session (HttpOnly cookies + CSRF, H-1) ----

/**
 * The access/refresh tokens now live in HttpOnly cookies the browser sends
 * automatically; JavaScript can no longer read them. The only client-readable
 * marker is the non-HttpOnly `csrf` cookie, set at login and cleared at logout —
 * we treat its presence as "there is a session" and echo its value back in the
 * `x-csrf-token` header on mutating requests (double-submit CSRF).
 */
const CSRF_COOKIE = 'csrf';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/** The current CSRF token (from the readable `csrf` cookie), or null. */
export function getCsrfToken(): string | null {
  return readCookie(CSRF_COOKIE);
}

export function isAuthed(): boolean {
  return getCsrfToken() !== null;
}

/** Best-effort client-side clear of the readable session marker. */
function clearCsrfCookie() {
  if (typeof document === 'undefined') return;
  document.cookie = `${CSRF_COOKIE}=; Max-Age=0; path=/`;
}

export function logout() {
  // Best-effort server-side invalidation: bump the account's session epoch and
  // clear the auth cookies. Fire-and-forget — the CSRF header is captured
  // synchronously by the fetch before we drop the local marker below.
  try {
    void api<{ ok: boolean }>('/auth/logout', { method: 'POST' }).catch(
      () => undefined,
    );
  } catch {
    /* ignore */
  }
  clearCsrfCookie();
  // Legacy cleanup: remove any tokens left in localStorage by an older build.
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
  if (raw) return new ApiError(status, raw);
  return new ApiError(status, `Request failed (${status})`, 'http.requestFailed', {
    status,
  });
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Silently exchange the (HttpOnly) refresh cookie for a fresh access cookie.
 * Returns true on success so the caller can retry the original request once.
 */
async function tryRefreshSession(): Promise<boolean> {
  try {
    const csrf = getCsrfToken();
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
      body: '{}',
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit,
  allowRefresh: boolean,
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const csrf = getCsrfToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      // Send the HttpOnly session cookies (H-1) on every call.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        // Double-submit CSRF: echo the readable csrf cookie on mutations.
        ...(MUTATING_METHODS.has(method) && csrf
          ? { 'x-csrf-token': csrf }
          : {}),
        ...(options.headers ?? {}),
      },
    });
  } catch {
    // Network/connection failure (server down, offline, CORS).
    throw new ApiError(
      0,
      'Cannot reach the server. Check your connection.',
      'network.unreachable',
    );
  }
  // Access token expired but we still hold a session marker: transparently
  // refresh once and replay the request. Never loop on the auth endpoints.
  if (
    res.status === 401 &&
    allowRefresh &&
    getCsrfToken() &&
    !path.startsWith('/auth/')
  ) {
    if (await tryRefreshSession()) {
      return apiRequest<T>(path, options, false);
    }
  }
  if (!res.ok) {
    throw parseApiError(res.status, await res.text());
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return apiRequest<T>(path, options, true);
}

// ---- Auth ----

/**
 * Login/register responses no longer carry raw tokens (H-1): the session is set
 * as HttpOnly cookies by the control plane. Only routing flags come back.
 */
interface AuthResult {
  needsOnboarding?: boolean;
  mustChangePassword?: boolean;
}

// ---- Commercial licensing / entitlements (mirror @selfhosted/shared) ----

export type LicenseTier = 'free' | 'homelab' | 'pro';

export type LicenseModule =
  | 'reverse-tunnels'
  | 'service-cron'
  | 'preview-envs'
  | 'offsite-backups'
  | 'alerts'
  | 'metrics-history'
  | 'sso'
  | 'audit-export'
  | 'api-cli'
  | 'white-label'
  | 'email';

export interface ActivationStatus {
  required: boolean;
  ok: boolean;
  lastCheckAt: number | null;
  reason?: string;
}

export interface TierLimits {
  /** Max nodes; `null` = unlimited. */
  maxNodes: number | null;
  /** Max reverse tunnels; `null` = unlimited. */
  maxTunnels: number | null;
}

export interface Entitlements {
  tier: LicenseTier;
  modules: LicenseModule[];
  limits: TierLimits;
  expiresAt: number | null;
  licensed: boolean;
  subject?: string;
  name?: string;
  activation?: ActivationStatus;
}

export const FREE_ENTITLEMENTS: Entitlements = {
  tier: 'free',
  modules: [],
  limits: { maxNodes: 1, maxTunnels: 0 },
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

export async function login(email: string, password: string, totp?: string) {
  // The control plane sets the session cookies on this response; we only keep
  // the (non-secret) weak-password flag for the client-side redirect.
  const res = await api<AuthResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }),
  });
  setMustChangePassword(!!res.mustChangePassword);
  return res;
}

/** Stage 1: create the account and sign in (still needs onboarding). */
export async function register(
  email: string,
  password: string,
  inviteToken?: string,
) {
  return api<AuthResult>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      ...(inviteToken?.trim() ? { inviteToken: inviteToken.trim() } : {}),
    }),
  });
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
  templateId?: string;
  deployKind?: DeployKind;
  repoUrl?: string;
  image?: string;
  composeFile?: string;
  composeYaml?: string;
  branch?: string;
  gitCredId?: string;
  useRepoDockerfile?: boolean;
  buildMode?: 'template' | 'dockerfile' | 'nixpacks';
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

// ---- Catalog ----

export interface CatalogEnvDefault {
  key: string;
  value?: string;
  secret?: boolean;
  required?: boolean;
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
  recommendedVolumes: { mountPath: string }[];
  envDefaults: CatalogEnvDefault[];
  locked?: boolean;
}

export const listCatalog = () =>
  api<(CatalogApp & { locked: boolean })[]>('/catalog');
export const getCatalogApp = (slug: string) =>
  api<CatalogApp & { locked: boolean }>(`/catalog/${slug}`);
export const installCatalogApp = (
  slug: string,
  body: {
    projectId: string;
    nodeId: string;
    name?: string;
    env?: Record<string, string>;
    deploy?: boolean;
  },
) =>
  api<{ service: Service; deployment: Deployment | null }>(
    `/catalog/${slug}/install`,
    { method: 'POST', body: JSON.stringify(body) },
  );

/**
 * Opens the live runtime log stream for a service. Returns the raw Response so
 * the caller can read `response.body` as a ReadableStream.
 */
export async function streamServiceLogs(
  id: string,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch(`${API_URL}/services/${id}/logs/stream`, {
    credentials: 'include',
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`API ${res.status}`);
  }
  return res;
}

/**
 * Requests a short-lived, single-use exec ticket for a service. The ticket —
 * not the access JWT — is what opens the WebSocket, keeping bearer tokens out
 * of proxy logs/history.
 */
export async function createExecTicket(serviceId: string): Promise<string> {
  const { ticket } = await api<{ ticket: string }>(
    `/services/${serviceId}/exec-ticket`,
    { method: 'POST' },
  );
  return ticket;
}

/**
 * Builds the WebSocket URL for an interactive container shell. A single-use
 * ticket (from createExecTicket) is passed as a query param because browsers
 * can't set WS headers; unlike a JWT it's opaque, short-lived and one-shot.
 */
export function execSocketUrl(serviceId: string, ticket: string): string {
  const wsBase = API_URL.replace(/^http/, 'ws');
  return `${wsBase}/services/${serviceId}/exec?ticket=${encodeURIComponent(ticket)}`;
}

/** Opens the live build-log stream for a deployment (see streamServiceLogs). */
export async function streamDeploymentLogs(
  deploymentId: string,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch(`${API_URL}/deployments/${deploymentId}/logs/stream`, {
    credentials: 'include',
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

// ---- Per-service cron (Home-Lab: service-cron) ----

export interface ServiceCron {
  id: string;
  serviceId: string;
  name: string;
  cron: string;
  command: string;
  enabled: boolean;
  timeoutSec: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastOutput: string | null;
  createdAt: string;
  updatedAt: string;
}

export const listServiceCrons = (serviceId: string) =>
  api<ServiceCron[]>(`/services/${serviceId}/crons`);

export const createServiceCron = (
  serviceId: string,
  body: {
    name: string;
    cron: string;
    command: string;
    enabled?: boolean;
    timeoutSec?: number;
  },
) =>
  api<ServiceCron>(`/services/${serviceId}/crons`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateServiceCron = (
  serviceId: string,
  id: string,
  body: Partial<{
    name: string;
    cron: string;
    command: string;
    enabled: boolean;
    timeoutSec: number;
  }>,
) =>
  api<ServiceCron>(`/services/${serviceId}/crons/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const deleteServiceCron = (serviceId: string, id: string) =>
  api<{ ok: boolean }>(`/services/${serviceId}/crons/${id}`, {
    method: 'DELETE',
  });

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
  const res = await fetch(`${API_URL}/backups/${id}/download`, {
    credentials: 'include',
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
