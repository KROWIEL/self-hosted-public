'use client';

import { useEffect, useState } from 'react';
import {
  AuthMe,
  OffsiteConfig,
  OffsiteProvider,
  OffsiteProviderConfig,
  OffsiteUpload,
  getMe,
  getOffsiteConfig,
  listOffsiteUploads,
  setOffsiteConfig,
  syncOffsite,
  testOffsite,
} from '@/lib/api';
import { AppShell } from '@/components/shell';
import { useEntitlements } from '@/components/entitlements';
import { UpgradeNotice } from '@/components/upgrade-notice';
import {
  Card,
  EmptyState,
  ErrorBox,
  Field,
  GuideCard,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { TKey, useErrorText, useI18n } from '@/i18n';

const PROVIDERS: OffsiteProvider[] = ['s3', 'gcs', 'azure', 'sftp'];

const PROVIDER_LABELS: Record<OffsiteProvider, TKey> = {
  s3: 'offsite.provider.s3',
  gcs: 'offsite.provider.gcs',
  azure: 'offsite.provider.azure',
  sftp: 'offsite.provider.sftp',
};

type FormState = {
  enabled: boolean;
  provider: OffsiteProvider;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretKey: string;
  forcePathStyle: boolean;
  accountName: string;
  container: string;
  useConnectionString: boolean;
  host: string;
  port: string;
  username: string;
  remotePath: string;
  authMethod: 'password' | 'privateKey';
};

const emptyForm = (): FormState => ({
  enabled: false,
  provider: 's3',
  endpoint: '',
  region: 'us-east-1',
  bucket: '',
  prefix: '',
  accessKeyId: '',
  secretKey: '',
  forcePathStyle: true,
  accountName: '',
  container: '',
  useConnectionString: false,
  host: '',
  port: '22',
  username: '',
  remotePath: '',
  authMethod: 'password',
});

function formFromConfig(c: OffsiteConfig): FormState {
  const pc = c.providerConfig ?? {};
  return {
    enabled: c.enabled,
    provider: c.provider || 's3',
    endpoint: c.endpoint,
    region: c.region,
    bucket: c.bucket,
    prefix: c.prefix,
    accessKeyId: c.accessKeyId,
    secretKey: '',
    forcePathStyle: c.forcePathStyle,
    accountName: pc.accountName ?? '',
    container: pc.container ?? '',
    useConnectionString: !!pc.useConnectionString,
    host: pc.host ?? '',
    port: String(pc.port ?? 22),
    username: pc.username ?? '',
    remotePath: pc.remotePath ?? '',
    authMethod: pc.authMethod === 'privateKey' ? 'privateKey' : 'password',
  };
}

function providerConfigFromForm(form: FormState): OffsiteProviderConfig {
  if (form.provider === 'azure') {
    return {
      accountName: form.accountName.trim(),
      container: form.container.trim(),
      useConnectionString: form.useConnectionString,
    };
  }
  if (form.provider === 'sftp') {
    const port = Number(form.port);
    return {
      host: form.host.trim(),
      port: Number.isFinite(port) ? port : 22,
      username: form.username.trim(),
      remotePath: form.remotePath.trim(),
      authMethod: form.authMethod,
    };
  }
  return {};
}

export default function OffsitePage() {
  return (
    <AppShell>
      <OffsiteContent />
    </AppShell>
  );
}

function formatBytes(n: number | null): string {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function OffsiteContent() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { has } = useEntitlements();
  const unlocked = has('offsite-backups');

  const [me, setMe] = useState<AuthMe | null>(null);
  const [cfg, setCfg] = useState<OffsiteConfig | null>(null);
  const [uploads, setUploads] = useState<OffsiteUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [secretSet, setSecretSet] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | 'sync' | null>(null);

  const isAdmin = me?.role === 'ADMIN';

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  async function reload() {
    setLoading(true);
    try {
      const [c, u] = await Promise.all([
        getOffsiteConfig(),
        listOffsiteUploads(),
      ]);
      setCfg(c);
      setUploads(u);
      setForm(formFromConfig(c));
      setSecretSet(c.secretKeySet);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!unlocked || !isAdmin) {
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, isAdmin]);

  async function onSave() {
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const c = await setOffsiteConfig({
        enabled: form.enabled,
        provider: form.provider,
        endpoint: form.endpoint.trim(),
        region: form.region.trim() || 'us-east-1',
        bucket: form.bucket.trim(),
        prefix: form.prefix.trim(),
        accessKeyId: form.accessKeyId.trim(),
        secretKey: form.secretKey ? form.secretKey : undefined,
        forcePathStyle: form.forcePathStyle,
        providerConfig: providerConfigFromForm(form),
      });
      setCfg(c);
      setSecretSet(c.secretKeySet);
      setForm((f) => ({ ...f, secretKey: '' }));
      setNotice(t('offsite.saved'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setBusy('test');
    setError(null);
    setNotice(null);
    try {
      await testOffsite();
      setNotice(t('offsite.testOk'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function onSync() {
    setBusy('sync');
    setError(null);
    setNotice(null);
    try {
      const res = await syncOffsite();
      setNotice(
        t('offsite.syncResult')
          .replace('{uploaded}', String(res.uploaded))
          .replace('{failed}', String(res.failed)),
      );
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (!unlocked) {
    return (
      <>
        <PageHeader
          title={t('offsite.title')}
          subtitle={t('offsite.subtitle')}
        />
        <UpgradeNotice
          tier="pro"
          featureTitle={t('offsite.lockedTitle')}
          featureBody={t('offsite.lockedBody')}
        />
      </>
    );
  }

  if (me && !isAdmin) {
    return (
      <>
        <PageHeader
          title={t('offsite.title')}
          subtitle={t('offsite.subtitle')}
        />
        <EmptyState>{t('offsite.adminOnly')}</EmptyState>
      </>
    );
  }

  const isObjectStore = form.provider === 's3' || form.provider === 'gcs';

  return (
    <>
      <PageHeader title={t('offsite.title')} subtitle={t('offsite.subtitle')} />

      <GuideCard
        storageKey="offsite"
        title={t('offsite.aboutTitle')}
        body={t('offsite.aboutBody')}
      />

      {error && <ErrorBox message={error} />}
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <Card className="mb-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            {t('offsite.destTitle')}
          </h3>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) =>
                setForm({ ...form, enabled: e.target.checked })
              }
            />
            {t('offsite.enabled')}
          </label>
        </div>
        <p className="mt-1 text-sm text-neutral-400">{t('offsite.destHint')}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t('offsite.provider')}>
            <select
              value={form.provider}
              onChange={(e) =>
                setForm({
                  ...form,
                  provider: e.target.value as OffsiteProvider,
                  secretKey: '',
                })
              }
              className="field w-full"
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(PROVIDER_LABELS[p])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('offsite.prefix')}>
            <input
              value={form.prefix}
              onChange={(e) => setForm({ ...form, prefix: e.target.value })}
              placeholder="panel/"
              className="field w-full"
            />
          </Field>
        </div>

        {isObjectStore && (
          <>
            {form.provider === 'gcs' && (
              <p className="mt-3 text-sm text-neutral-400">
                {t('offsite.gcsHint')}
              </p>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label={t('offsite.endpoint')}>
                <input
                  value={form.endpoint}
                  onChange={(e) =>
                    setForm({ ...form, endpoint: e.target.value })
                  }
                  placeholder={
                    form.provider === 'gcs'
                      ? 'https://storage.googleapis.com'
                      : 'https://s3.amazonaws.com'
                  }
                  className="field w-full"
                />
              </Field>
              <Field label={t('offsite.region')}>
                <input
                  value={form.region}
                  onChange={(e) =>
                    setForm({ ...form, region: e.target.value })
                  }
                  placeholder="us-east-1"
                  className="field w-full"
                />
              </Field>
              <Field label={t('offsite.bucket')}>
                <input
                  value={form.bucket}
                  onChange={(e) =>
                    setForm({ ...form, bucket: e.target.value })
                  }
                  placeholder="my-backups"
                  className="field w-full"
                />
              </Field>
              <Field label={t('offsite.accessKeyId')}>
                <input
                  value={form.accessKeyId}
                  onChange={(e) =>
                    setForm({ ...form, accessKeyId: e.target.value })
                  }
                  className="field w-full"
                  autoComplete="off"
                />
              </Field>
              <Field label={t('offsite.secretKey')}>
                <input
                  type="password"
                  value={form.secretKey}
                  onChange={(e) =>
                    setForm({ ...form, secretKey: e.target.value })
                  }
                  placeholder={secretSet ? '••••••••' : ''}
                  className="field w-full"
                  autoComplete="off"
                />
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={form.forcePathStyle}
                onChange={(e) =>
                  setForm({ ...form, forcePathStyle: e.target.checked })
                }
              />
              {t('offsite.forcePathStyle')}
            </label>
          </>
        )}

        {form.provider === 'azure' && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label={t('offsite.azure.container')}>
              <input
                value={form.container}
                onChange={(e) =>
                  setForm({ ...form, container: e.target.value })
                }
                className="field w-full"
              />
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={form.useConnectionString}
                onChange={(e) =>
                  setForm({
                    ...form,
                    useConnectionString: e.target.checked,
                    secretKey: '',
                  })
                }
              />
              {t('offsite.azure.useConnectionString')}
            </label>
            {!form.useConnectionString && (
              <Field label={t('offsite.azure.accountName')}>
                <input
                  value={form.accountName}
                  onChange={(e) =>
                    setForm({ ...form, accountName: e.target.value })
                  }
                  className="field w-full"
                  autoComplete="off"
                />
              </Field>
            )}
            <Field
              label={
                form.useConnectionString
                  ? t('offsite.azure.connectionString')
                  : t('offsite.azure.accountKey')
              }
            >
              <input
                type="password"
                value={form.secretKey}
                onChange={(e) =>
                  setForm({ ...form, secretKey: e.target.value })
                }
                placeholder={secretSet ? '••••••••' : ''}
                className="field w-full"
                autoComplete="off"
              />
            </Field>
          </div>
        )}

        {form.provider === 'sftp' && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label={t('offsite.sftp.host')}>
              <input
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                className="field w-full"
              />
            </Field>
            <Field label={t('offsite.sftp.port')}>
              <input
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
                className="field w-full"
              />
            </Field>
            <Field label={t('offsite.sftp.username')}>
              <input
                value={form.username}
                onChange={(e) =>
                  setForm({ ...form, username: e.target.value })
                }
                className="field w-full"
                autoComplete="off"
              />
            </Field>
            <Field label={t('offsite.sftp.remotePath')}>
              <input
                value={form.remotePath}
                onChange={(e) =>
                  setForm({ ...form, remotePath: e.target.value })
                }
                placeholder="/backups"
                className="field w-full"
              />
            </Field>
            <Field label={t('offsite.sftp.authMethod')}>
              <select
                value={form.authMethod}
                onChange={(e) =>
                  setForm({
                    ...form,
                    authMethod: e.target.value as 'password' | 'privateKey',
                    secretKey: '',
                  })
                }
                className="field w-full"
              >
                <option value="password">{t('offsite.sftp.authPassword')}</option>
                <option value="privateKey">
                  {t('offsite.sftp.authPrivateKey')}
                </option>
              </select>
            </Field>
            <Field
              label={
                form.authMethod === 'privateKey'
                  ? t('offsite.sftp.privateKey')
                  : t('offsite.sftp.password')
              }
            >
              {form.authMethod === 'privateKey' ? (
                <textarea
                  value={form.secretKey}
                  onChange={(e) =>
                    setForm({ ...form, secretKey: e.target.value })
                  }
                  placeholder={secretSet ? '••••••••' : '-----BEGIN …'}
                  className="field min-h-[6rem] w-full font-mono text-xs"
                  autoComplete="off"
                />
              ) : (
                <input
                  type="password"
                  value={form.secretKey}
                  onChange={(e) =>
                    setForm({ ...form, secretKey: e.target.value })
                  }
                  placeholder={secretSet ? '••••••••' : ''}
                  className="field w-full"
                  autoComplete="off"
                />
              )}
            </Field>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={onSave}
            disabled={busy !== null}
            className="btn-primary"
          >
            {busy === 'save' ? t('offsite.saving') : t('offsite.save')}
          </button>
          <button
            onClick={onTest}
            disabled={busy !== null}
            className="btn-ghost"
          >
            {busy === 'test' ? t('offsite.testing') : t('offsite.test')}
          </button>
          <button
            onClick={onSync}
            disabled={busy !== null || !cfg?.enabled}
            className="btn-ghost"
          >
            {busy === 'sync' ? t('offsite.syncing') : t('offsite.syncNow')}
          </button>
        </div>
      </Card>

      <h3 className="mb-3 mt-8 text-lg font-semibold text-white">
        {t('offsite.uploadsTitle')}
      </h3>
      {loading && <Spinner />}
      {!loading && uploads.length === 0 && (
        <EmptyState>{t('offsite.noUploads')}</EmptyState>
      )}
      {!loading && uploads.length > 0 && (
        <Card className="overflow-hidden">
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2 font-medium">
                    {t('offsite.colTime')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('offsite.colKey')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('offsite.colSize')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('offsite.colStatus')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-white/5 text-neutral-300"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-400">
                      {new Date(u.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-neutral-300">
                      {u.key}
                      {u.error && (
                        <div className="text-rose-300">{u.error}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-400">
                      {formatBytes(u.sizeBytes)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          u.status === 'failed'
                            ? 'text-rose-300'
                            : 'text-emerald-300'
                        }
                      >
                        {u.status === 'failed'
                          ? t('offsite.statusFailed')
                          : t('offsite.statusUploaded')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
