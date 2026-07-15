'use client';

import { useEffect, useState } from 'react';
import {
  AuthMe,
  OffsiteConfig,
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
  PageHeader,
  Spinner,
} from '@/components/ui';
import { useErrorText, useI18n } from '@/i18n';

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

  const [form, setForm] = useState({
    enabled: false,
    endpoint: '',
    region: 'us-east-1',
    bucket: '',
    prefix: '',
    accessKeyId: '',
    secretKey: '',
    forcePathStyle: true,
  });
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
      setForm({
        enabled: c.enabled,
        endpoint: c.endpoint,
        region: c.region,
        bucket: c.bucket,
        prefix: c.prefix,
        accessKeyId: c.accessKeyId,
        secretKey: '',
        forcePathStyle: c.forcePathStyle,
      });
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
        endpoint: form.endpoint.trim(),
        region: form.region.trim() || 'us-east-1',
        bucket: form.bucket.trim(),
        prefix: form.prefix.trim(),
        accessKeyId: form.accessKeyId.trim(),
        secretKey: form.secretKey ? form.secretKey : undefined,
        forcePathStyle: form.forcePathStyle,
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

  return (
    <>
      <PageHeader title={t('offsite.title')} subtitle={t('offsite.subtitle')} />

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
          <Field label={t('offsite.endpoint')}>
            <input
              value={form.endpoint}
              onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
              placeholder="https://s3.amazonaws.com"
              className="field w-full"
            />
          </Field>
          <Field label={t('offsite.region')}>
            <input
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
              placeholder="us-east-1"
              className="field w-full"
            />
          </Field>
          <Field label={t('offsite.bucket')}>
            <input
              value={form.bucket}
              onChange={(e) => setForm({ ...form, bucket: e.target.value })}
              placeholder="my-backups"
              className="field w-full"
            />
          </Field>
          <Field label={t('offsite.prefix')}>
            <input
              value={form.prefix}
              onChange={(e) => setForm({ ...form, prefix: e.target.value })}
              placeholder="panel/"
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
              onChange={(e) => setForm({ ...form, secretKey: e.target.value })}
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
