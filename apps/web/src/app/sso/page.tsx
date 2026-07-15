'use client';

import { useEffect, useState } from 'react';
import {
  AuthMe,
  SsoConfig,
  getMe,
  getSsoConfig,
  setSsoConfig,
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
} from '@/components/ui';
import { useErrorText, useI18n } from '@/i18n';

export default function SsoPage() {
  return (
    <AppShell>
      <SsoContent />
    </AppShell>
  );
}

function SsoContent() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { has } = useEntitlements();
  const unlocked = has('sso');

  const [me, setMe] = useState<AuthMe | null>(null);
  const [cfg, setCfg] = useState<SsoConfig | null>(null);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = me?.role === 'ADMIN';

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!unlocked || !isAdmin) return;
    getSsoConfig()
      .then(setCfg)
      .catch((e) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, isAdmin]);

  async function onSave() {
    if (!cfg) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await setSsoConfig({
        enabled: cfg.enabled,
        issuer: cfg.issuer.trim(),
        clientId: cfg.clientId.trim(),
        allowedDomains: cfg.allowedDomains.trim(),
        autoCreate: cfg.autoCreate,
        buttonLabel: cfg.buttonLabel.trim(),
        ...(secret ? { clientSecret: secret } : {}),
      });
      setCfg(saved);
      setSecret('');
      setNotice(t('sso.saved'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!unlocked) {
    return (
      <>
        <PageHeader title={t('sso.title')} subtitle={t('sso.subtitle')} />
        <UpgradeNotice
          tier="pro"
          featureTitle={t('sso.lockedTitle')}
          featureBody={t('sso.lockedBody')}
        />
      </>
    );
  }

  if (me && !isAdmin) {
    return (
      <>
        <PageHeader title={t('sso.title')} subtitle={t('sso.subtitle')} />
        <EmptyState>{t('sso.adminOnly')}</EmptyState>
      </>
    );
  }

  if (!cfg) {
    return (
      <>
        <PageHeader title={t('sso.title')} subtitle={t('sso.subtitle')} />
        {error && <ErrorBox message={error} />}
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('sso.title')} subtitle={t('sso.subtitle')} />

      {error && <ErrorBox message={error} />}
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <Card className="mb-6">
        <label className="flex items-center gap-2 text-sm text-neutral-200">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
          />
          {t('sso.enabled')}
        </label>
        <p className="mt-1 text-xs text-neutral-500">{t('sso.enabledHint')}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label={t('sso.issuer')}>
            <input
              value={cfg.issuer}
              onChange={(e) => setCfg({ ...cfg, issuer: e.target.value })}
              placeholder="https://accounts.google.com"
              className="field w-full"
            />
          </Field>
          <Field label={t('sso.buttonLabel')}>
            <input
              value={cfg.buttonLabel}
              onChange={(e) => setCfg({ ...cfg, buttonLabel: e.target.value })}
              placeholder="Sign in with SSO"
              className="field w-full"
            />
          </Field>
          <Field label={t('sso.clientId')}>
            <input
              value={cfg.clientId}
              onChange={(e) => setCfg({ ...cfg, clientId: e.target.value })}
              placeholder="client-id"
              className="field w-full"
            />
          </Field>
          <Field
            label={
              cfg.hasSecret ? t('sso.clientSecretSet') : t('sso.clientSecret')
            }
          >
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={cfg.hasSecret ? '••••••••' : 'client-secret'}
              autoComplete="new-password"
              className="field w-full"
            />
          </Field>
          <Field label={t('sso.allowedDomains')}>
            <input
              value={cfg.allowedDomains}
              onChange={(e) =>
                setCfg({ ...cfg, allowedDomains: e.target.value })
              }
              placeholder="example.com, team.example.com"
              className="field w-full"
            />
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={cfg.autoCreate}
                onChange={(e) =>
                  setCfg({ ...cfg, autoCreate: e.target.checked })
                }
              />
              {t('sso.autoCreate')}
            </label>
          </div>
        </div>

        {/* Redirect URI the admin must register at the provider. */}
        <div className="mt-6">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
            {t('sso.redirectUri')}
          </div>
          <code className="block break-all rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2 text-sm text-neutral-200">
            {cfg.redirectUri}
          </code>
          <p className="mt-1 text-xs text-neutral-500">
            {t('sso.redirectUriHint')}
          </p>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button onClick={onSave} disabled={busy} className="btn-primary">
            {busy ? t('sso.saving') : t('sso.save')}
          </button>
        </div>
      </Card>
    </>
  );
}
