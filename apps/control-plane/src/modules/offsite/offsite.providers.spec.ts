import {
  asProviderConfig,
  GCS_S3_ENDPOINT,
  isOffsiteProvider,
  joinRemoteKey,
  OFFSITE_PROVIDERS,
  validateOffsiteConfig,
  type OffsiteProvider,
  type ProviderConfig,
} from './offsite.providers';

describe('offsite.providers', () => {
  describe('isOffsiteProvider', () => {
    it('accepts known providers', () => {
      for (const p of OFFSITE_PROVIDERS) {
        expect(isOffsiteProvider(p)).toBe(true);
      }
    });
    it('rejects unknown', () => {
      expect(isOffsiteProvider('ftp')).toBe(false);
    });
  });

  describe('validateOffsiteConfig', () => {
    it('requires S3 endpoint bucket and keys', () => {
      const errs = validateOffsiteConfig({
        provider: 's3',
        secretKeySet: false,
      });
      expect(errs).toEqual(
        expect.arrayContaining([
          'endpoint is required',
          'bucket is required',
          'accessKeyId is required',
          'secretKey is required',
        ]),
      );
    });

    it('allows GCS without endpoint (defaults to XML API)', () => {
      const errs = validateOffsiteConfig({
        provider: 'gcs',
        bucket: 'b',
        accessKeyId: 'GOOG',
        secretKeySet: true,
      });
      expect(errs).toEqual([]);
    });

    it('requires Azure container + account or connection string', () => {
      expect(
        validateOffsiteConfig({
          provider: 'azure',
          secretKeySet: false,
          providerConfig: {},
        }),
      ).toEqual(
        expect.arrayContaining([
          'container is required',
          'accountName is required',
          'accountKey is required',
        ]),
      );

      expect(
        validateOffsiteConfig({
          provider: 'azure',
          secretKeySet: true,
          providerConfig: {
            useConnectionString: true,
            container: 'backups',
          },
        }),
      ).toEqual([]);
    });

    it('requires SFTP host username and secret', () => {
      const errs = validateOffsiteConfig({
        provider: 'sftp',
        secretKeySet: false,
        providerConfig: { host: '', username: '', port: 0 },
      });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs).toEqual(
        expect.arrayContaining([
          'host is required',
          'username is required',
          'port must be 1-65535',
          'password is required',
        ]),
      );
    });

    it('asks for privateKey when authMethod is privateKey', () => {
      const errs = validateOffsiteConfig({
        provider: 'sftp',
        secretKeySet: false,
        providerConfig: {
          host: 'sftp.example.com',
          username: 'u',
          port: 22,
          authMethod: 'privateKey',
        },
      });
      expect(errs).toContain('privateKey is required');
    });
  });

  describe('asProviderConfig', () => {
    it('strips unknown keys and bad types', () => {
      expect(
        asProviderConfig({
          host: 'h',
          port: '22',
          extra: true,
          authMethod: 'password',
        }),
      ).toEqual({ host: 'h', authMethod: 'password' });
    });
  });

  describe('joinRemoteKey', () => {
    it('joins prefix and name', () => {
      expect(joinRemoteKey('panel/', 'a.tar')).toBe('panel/a.tar');
      expect(joinRemoteKey('', 'a.tar')).toBe('a.tar');
    });
  });

  it('exports GCS default endpoint', () => {
    expect(GCS_S3_ENDPOINT).toContain('storage.googleapis.com');
  });

  it('types OffsiteProvider as union', () => {
    const p: OffsiteProvider = 'azure';
    const cfg: ProviderConfig = { container: 'c' };
    expect(p).toBe('azure');
    expect(cfg.container).toBe('c');
  });
});
