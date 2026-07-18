'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AuthMe,
  DomainCertificate,
  TlsSettings,
  clearDomainCustomCert,
  getMe,
  getTlsSettings,
  listDomainCertificates,
  setDomainCustomCert,
  setTlsSettings,
} from '@/lib/api';
import { AppShell } from '@/components/shell';
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

const STATUS_LABEL: Record<DomainCertificate['status'], TKey> = {
  acme: 'certs.status.acme',
  custom: 'certs.status.custom',
  'http-only': 'certs.status.httpOnly',
};

export default function CertificatesPage() {
  return (
    <AppShell>
      <CertificatesContent />
    </AppShell>
  );
}

function CertificatesContent() {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [me, setMe] = useState<AuthMe | null>(null);
  const [domains, setDomains] = useState<DomainCertificate[]>([]);
  const [tls, setTls] = useState<TlsSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState('');
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [busy, setBusy] = useState<'save' | 'clear' | 'tls' | null>(null);

  const [tlsForm, setTlsForm] = useState({
    acmeEmail: '',
    dnsProvider: 'cloudflare',
    wildcardEnabled: false,
    cloudflareToken: '',
  });
  const [tokenSet, setTokenSet] = useState(false);

  const isAdmin = me?.role === 'ADMIN';

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  async function reload() {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([
        listDomainCertificates(),
        getTlsSettings(),
      ]);
      setDomains(d);
      setTls(s);
      setTlsForm({
        acmeEmail: s.acmeEmail,
        dnsProvider: s.dnsProvider || 'cloudflare',
        wildcardEnabled: s.wildcardEnabled,
        cloudflareToken: '',
      });
      setTokenSet(s.cloudflareTokenSet);
      if (!selectedId && d.length) setSelectedId(d[0].id);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function onUpload() {
    if (!selectedId) return;
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      await setDomainCustomCert(selectedId, {
        certPem: certPem.trim(),
        keyPem: keyPem.trim(),
      });
      setCertPem('');
      setKeyPem('');
      setNotice(t('certs.uploaded'));
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function onClear(id: string) {
    setBusy('clear');
    setError(null);
    setNotice(null);
    try {
      await clearDomainCustomCert(id);
      setNotice(t('certs.cleared'));
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function onSaveTls() {
    setBusy('tls');
    setError(null);
    setNotice(null);
    try {
      const s = await setTlsSettings({
        acmeEmail: tlsForm.acmeEmail.trim(),
        dnsProvider: tlsForm.dnsProvider.trim() || 'cloudflare',
        wildcardEnabled: tlsForm.wildcardEnabled,
        cloudflareToken: tlsForm.cloudflareToken
          ? tlsForm.cloudflareToken
          : undefined,
      });
      setTls(s);
      setTlsForm((f) => ({ ...f, cloudflareToken: '' }));
      setTokenSet(s.cloudflareTokenSet);
      setNotice(t('certs.tlsSaved'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (me && !isAdmin) {
    return (
      <>
        <PageHeader title={t('certs.title')} subtitle={t('certs.subtitle')} />
        <EmptyState>{t('certs.adminOnly')}</EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('certs.title')} subtitle={t('certs.subtitle')} />

      <GuideCard
        storageKey="certificates"
        title={t('certs.aboutTitle')}
        body={t('certs.aboutBody')}
      />

      {error && <ErrorBox message={error} />}
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <h3 className="mb-3 text-lg font-semibold text-white">
        {t('certs.domainsTitle')}
      </h3>
      {loading && <Spinner />}
      {!loading && domains.length === 0 && (
        <EmptyState>{t('certs.noDomains')}</EmptyState>
      )}
      {!loading && domains.length > 0 && (
        <Card className="mb-6 overflow-hidden">
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2 font-medium">{t('certs.colHost')}</th>
                  <th className="px-3 py-2 font-medium">
                    {t('certs.colService')}
                  </th>
                  <th className="px-3 py-2 font-medium">{t('certs.colHttps')}</th>
                  <th className="px-3 py-2 font-medium">
                    {t('certs.colStatus')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('certs.colActions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b border-white/5 text-neutral-300"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-white">
                      {d.host}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/services/${d.serviceId}`}
                        className="text-sky-300 hover:underline"
                      >
                        {d.serviceName}
                      </Link>
                      {d.nodeName && (
                        <div className="text-xs text-neutral-500">
                          {d.nodeName}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {d.https ? t('certs.yes') : t('certs.no')}
                    </td>
                    <td className="px-3 py-2">{t(STATUS_LABEL[d.status])}</td>
                    <td className="px-3 py-2">
                      {d.certSource === 'custom' && (
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          disabled={busy !== null}
                          onClick={() => onClear(d.id)}
                        >
                          {t('certs.clearCustom')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-white">
          {t('certs.uploadTitle')}
        </h3>
        <p className="mt-1 text-sm text-neutral-400">{t('certs.uploadHint')}</p>
        <div className="mt-4 grid gap-3">
          <Field label={t('certs.domain')}>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="field w-full"
            >
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.host}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('certs.certPem')}>
            <textarea
              value={certPem}
              onChange={(e) => setCertPem(e.target.value)}
              placeholder="-----BEGIN CERTIFICATE-----"
              className="field min-h-[8rem] w-full font-mono text-xs"
              autoComplete="off"
            />
          </Field>
          <Field label={t('certs.keyPem')}>
            <textarea
              value={keyPem}
              onChange={(e) => setKeyPem(e.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----"
              className="field min-h-[8rem] w-full font-mono text-xs"
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="mt-4">
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null || !selectedId || !certPem || !keyPem}
            onClick={onUpload}
          >
            {busy === 'save' ? t('certs.uploading') : t('certs.upload')}
          </button>
        </div>
      </Card>

      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-white">
          {t('certs.tlsTitle')}
        </h3>
        <p className="mt-1 text-sm text-neutral-400">{t('certs.tlsHint')}</p>
        {tls && (
          <div className="mt-3 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-400">
            <div>
              {t('certs.envAcmeEmail')}:{' '}
              <span className="text-neutral-200">
                {tls.env.acmeEmail || '—'}
              </span>
            </div>
            <div>
              {t('certs.envWildcard')}:{' '}
              <span className="text-neutral-200">
                {tls.env.wildcardEnabled ? t('certs.yes') : t('certs.no')}
              </span>
            </div>
            <div>
              {t('certs.envCfToken')}:{' '}
              <span className="text-neutral-200">
                {tls.env.cloudflareTokenSet
                  ? t('certs.tokenSet')
                  : t('certs.tokenMissing')}
              </span>
            </div>
          </div>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t('certs.acmeEmail')}>
            <input
              value={tlsForm.acmeEmail}
              onChange={(e) =>
                setTlsForm({ ...tlsForm, acmeEmail: e.target.value })
              }
              className="field w-full"
            />
          </Field>
          <Field label={t('certs.dnsProvider')}>
            <input
              value={tlsForm.dnsProvider}
              onChange={(e) =>
                setTlsForm({ ...tlsForm, dnsProvider: e.target.value })
              }
              placeholder="cloudflare"
              className="field w-full"
            />
          </Field>
          <Field label={t('certs.cfToken')}>
            <input
              type="password"
              value={tlsForm.cloudflareToken}
              onChange={(e) =>
                setTlsForm({ ...tlsForm, cloudflareToken: e.target.value })
              }
              placeholder={tokenSet ? '••••••••' : ''}
              className="field w-full"
              autoComplete="off"
            />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={tlsForm.wildcardEnabled}
              onChange={(e) =>
                setTlsForm({
                  ...tlsForm,
                  wildcardEnabled: e.target.checked,
                })
              }
            />
            {t('certs.wildcardEnabled')}
          </label>
        </div>
        <div className="mt-4">
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null}
            onClick={onSaveTls}
          >
            {busy === 'tls' ? t('certs.savingTls') : t('certs.saveTls')}
          </button>
        </div>
      </Card>
    </>
  );
}
