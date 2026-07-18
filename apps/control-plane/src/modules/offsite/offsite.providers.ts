/**
 * Pure helpers for offsite provider config validation. Kept free of Nest/DB
 * so unit tests can run without crypto or AWS/Azure/SFTP clients.
 */

export const OFFSITE_PROVIDERS = ['s3', 'gcs', 'azure', 'sftp'] as const;
export type OffsiteProvider = (typeof OFFSITE_PROVIDERS)[number];

export function isOffsiteProvider(v: string): v is OffsiteProvider {
  return (OFFSITE_PROVIDERS as readonly string[]).includes(v);
}

/** Non-secret Azure fields stored in provider_config jsonb. */
export interface AzureProviderConfig {
  accountName?: string;
  container?: string;
  /** When true, secretKey holds a full connection string instead of account key. */
  useConnectionString?: boolean;
}

/** Non-secret SFTP fields stored in provider_config jsonb. */
export interface SftpProviderConfig {
  host?: string;
  port?: number;
  username?: string;
  remotePath?: string;
  /** password (default) | privateKey */
  authMethod?: 'password' | 'privateKey';
}

export type ProviderConfig = AzureProviderConfig & SftpProviderConfig;

export interface OffsiteConfigShape {
  provider: OffsiteProvider;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  forcePathStyle: boolean;
  providerConfig: ProviderConfig;
  /** Whether a secret is stored (never the value itself). */
  secretKeySet: boolean;
}

export interface ValidateOffsiteInput {
  provider: OffsiteProvider;
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretKeySet: boolean;
  providerConfig?: ProviderConfig;
}

/**
 * Returns a list of missing/invalid field messages. Empty = valid enough to
 * attempt a connection (secrets may still be wrong at runtime).
 */
export function validateOffsiteConfig(input: ValidateOffsiteInput): string[] {
  const errors: string[] = [];
  const cfg = input.providerConfig ?? {};

  switch (input.provider) {
    case 's3':
    case 'gcs': {
      const endpoint =
        input.endpoint?.trim() ||
        (input.provider === 'gcs' ? 'https://storage.googleapis.com' : '');
      if (!endpoint) errors.push('endpoint is required');
      if (!input.bucket?.trim()) errors.push('bucket is required');
      if (!input.accessKeyId?.trim()) errors.push('accessKeyId is required');
      if (!input.secretKeySet) errors.push('secretKey is required');
      break;
    }
    case 'azure': {
      if (!cfg.container?.trim()) errors.push('container is required');
      if (cfg.useConnectionString) {
        if (!input.secretKeySet) errors.push('connectionString is required');
      } else {
        if (!cfg.accountName?.trim()) errors.push('accountName is required');
        if (!input.secretKeySet) errors.push('accountKey is required');
      }
      break;
    }
    case 'sftp': {
      if (!cfg.host?.trim()) errors.push('host is required');
      if (!cfg.username?.trim()) errors.push('username is required');
      const port = cfg.port ?? 22;
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        errors.push('port must be 1-65535');
      }
      if (!input.secretKeySet) {
        errors.push(
          cfg.authMethod === 'privateKey'
            ? 'privateKey is required'
            : 'password is required',
        );
      }
      break;
    }
  }
  return errors;
}

/** Default GCS interoperable XML API endpoint (S3-compatible HMAC). */
export const GCS_S3_ENDPOINT = 'https://storage.googleapis.com';

export function joinRemoteKey(prefix: string, name: string): string {
  const p = (prefix || '').replace(/^\/+|\/+$/g, '');
  return p ? `${p}/${name}` : name;
}

export function asProviderConfig(raw: unknown): ProviderConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: ProviderConfig = {};
  if (typeof o.accountName === 'string') out.accountName = o.accountName;
  if (typeof o.container === 'string') out.container = o.container;
  if (typeof o.useConnectionString === 'boolean') {
    out.useConnectionString = o.useConnectionString;
  }
  if (typeof o.host === 'string') out.host = o.host;
  if (typeof o.port === 'number' && Number.isFinite(o.port)) out.port = o.port;
  if (typeof o.username === 'string') out.username = o.username;
  if (typeof o.remotePath === 'string') out.remotePath = o.remotePath;
  if (o.authMethod === 'password' || o.authMethod === 'privateKey') {
    out.authMethod = o.authMethod;
  }
  return out;
}
