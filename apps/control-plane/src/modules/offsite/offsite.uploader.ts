import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
import { Readable } from 'node:stream';
import SftpClient from 'ssh2-sftp-client';
import {
  GCS_S3_ENDPOINT,
  type AzureProviderConfig,
  type OffsiteProvider,
  type ProviderConfig,
  type SftpProviderConfig,
  joinRemoteKey,
} from './offsite.providers';

export interface OffsiteUploader {
  /** Upload a stream/buffer to the remote key (already includes prefix). */
  upload(body: Readable | Buffer, remoteKey: string): Promise<void>;
  /** Round-trip a tiny object to verify credentials. */
  test(prefix: string): Promise<void>;
}

export interface BuildUploaderInput {
  provider: OffsiteProvider;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretKey: string;
  forcePathStyle: boolean;
  providerConfig: ProviderConfig;
}

export function buildUploader(input: BuildUploaderInput): OffsiteUploader {
  switch (input.provider) {
    case 's3':
      return new S3CompatibleUploader(input);
    case 'gcs':
      return new S3CompatibleUploader({
        ...input,
        endpoint: input.endpoint.trim() || GCS_S3_ENDPOINT,
        // GCS XML API prefers virtual-hosted; path-style still works with HMAC.
        forcePathStyle: input.forcePathStyle,
      });
    case 'azure':
      return new AzureBlobUploader(input.secretKey, input.providerConfig);
    case 'sftp':
      return new SftpUploader(input.secretKey, input.providerConfig);
    default: {
      const _exhaustive: never = input.provider;
      throw new Error(`unsupported offsite provider: ${_exhaustive}`);
    }
  }
}

class S3CompatibleUploader implements OffsiteUploader {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(input: BuildUploaderInput) {
    this.bucket = input.bucket;
    this.s3 = new S3Client({
      endpoint: input.endpoint,
      region: input.region || 'us-east-1',
      forcePathStyle: input.forcePathStyle,
      credentials: {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretKey,
      },
    });
  }

  async upload(body: Readable | Buffer, remoteKey: string): Promise<void> {
    const upload = new Upload({
      client: this.s3,
      params: { Bucket: this.bucket, Key: remoteKey, Body: body },
    });
    await upload.done();
  }

  async test(prefix: string): Promise<void> {
    const key = joinRemoteKey(prefix, `.offsite-test-${Date.now()}`);
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: 'ok' }),
    );
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

class AzureBlobUploader implements OffsiteUploader {
  private readonly client: BlobServiceClient;
  private readonly container: string;

  constructor(secret: string, cfg: AzureProviderConfig) {
    const container = (cfg.container || '').trim();
    if (!container) throw new Error('Azure container is required');
    this.container = container;

    if (cfg.useConnectionString) {
      this.client = BlobServiceClient.fromConnectionString(secret);
    } else {
      const account = (cfg.accountName || '').trim();
      if (!account) throw new Error('Azure accountName is required');
      const cred = new StorageSharedKeyCredential(account, secret);
      this.client = new BlobServiceClient(
        `https://${account}.blob.core.windows.net`,
        cred,
      );
    }
  }

  async upload(body: Readable | Buffer, remoteKey: string): Promise<void> {
    const container = this.client.getContainerClient(this.container);
    const blob = container.getBlockBlobClient(remoteKey);
    if (Buffer.isBuffer(body)) {
      await blob.uploadData(body);
      return;
    }
    await blob.uploadStream(body);
  }

  async test(prefix: string): Promise<void> {
    const key = joinRemoteKey(prefix, `.offsite-test-${Date.now()}`);
    const container = this.client.getContainerClient(this.container);
    const blob = container.getBlockBlobClient(key);
    await blob.uploadData(Buffer.from('ok'));
    await blob.deleteIfExists();
  }
}

class SftpUploader implements OffsiteUploader {
  constructor(
    private readonly secret: string,
    private readonly cfg: SftpProviderConfig,
  ) {}

  private async withClient<T>(fn: (c: SftpClient) => Promise<T>): Promise<T> {
    const host = (this.cfg.host || '').trim();
    const username = (this.cfg.username || '').trim();
    if (!host || !username) throw new Error('SFTP host and username are required');
    const port = this.cfg.port ?? 22;
    const client = new SftpClient();
    const auth =
      this.cfg.authMethod === 'privateKey'
        ? { privateKey: this.secret }
        : { password: this.secret };
    try {
      await client.connect({ host, port, username, ...auth });
      return await fn(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private remotePath(remoteKey: string): string {
    const base = (this.cfg.remotePath || '').replace(/\/+$/g, '');
    const key = remoteKey.replace(/^\/+/g, '');
    return base ? `${base}/${key}` : `/${key}`;
  }

  async upload(body: Readable | Buffer, remoteKey: string): Promise<void> {
    const dest = this.remotePath(remoteKey);
    await this.withClient(async (c) => {
      const dir = dest.includes('/') ? dest.slice(0, dest.lastIndexOf('/')) : '';
      if (dir) await c.mkdir(dir, true);
      if (Buffer.isBuffer(body)) {
        await c.put(body, dest);
      } else {
        await c.put(body, dest);
      }
    });
  }

  async test(prefix: string): Promise<void> {
    const key = joinRemoteKey(prefix, `.offsite-test-${Date.now()}`);
    const dest = this.remotePath(key);
    await this.withClient(async (c) => {
      const dir = dest.includes('/') ? dest.slice(0, dest.lastIndexOf('/')) : '';
      if (dir) await c.mkdir(dir, true);
      await c.put(Buffer.from('ok'), dest);
      await c.delete(dest);
    });
  }
}
