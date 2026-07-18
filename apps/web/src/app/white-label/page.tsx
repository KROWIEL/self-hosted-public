'use client';

import { useEffect, useState } from 'react';
import {
  AuthMe,
  BrandingConfig,
  getBrandingConfig,
  getMe,
  setBranding,
} from '@/lib/api';
import { AppShell } from '@/components/shell';
import { refreshBranding, isSafeLogoUrl, safeLogoUrl } from '@/components/branding';
import { useEntitlements } from '@/components/entitlements';
import { UpgradeNotice } from '@/components/upgrade-notice';
import {
  Card,
  EmptyState,
  ErrorBox,
  Field,
  GuideCard,
  PageHeader,
} from '@/components/ui';
import { useErrorText, useI18n } from '@/i18n';

export default function WhiteLabelPage() {
  return (
    <AppShell>
      <WhiteLabelContent />
    </AppShell>
  );
}

function WhiteLabelContent() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { has } = useEntitlements();
  const unlocked = has('white-label');

  const [me, setMe] = useState<AuthMe | null>(null);
  const [form, setForm] = useState<BrandingConfig>({
    appName: '',
    logoUrl: '',
    accentColor: '#6366f1',
    hidePoweredBy: false,
  });
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
    getBrandingConfig()
      .then((c) =>
        setForm({
          appName: c.appName,
          logoUrl: c.logoUrl,
          accentColor: c.accentColor || '#6366f1',
          hidePoweredBy: c.hidePoweredBy,
        }),
      )
      .catch((e) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, isAdmin]);

  async function onSave() {
    const logoUrl = form.logoUrl.trim();
    if (!isSafeLogoUrl(logoUrl)) {
      setNotice(null);
      setError(t('whiteLabel.invalidLogoUrl'));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await setBranding({
        appName: form.appName.trim() || 'Self-Hosted',
        logoUrl,
        accentColor: form.accentColor.trim(),
        hidePoweredBy: form.hidePoweredBy,
      });
      // Re-fetch effective branding so the header, favicon, tab title and accent
      // update immediately across the app — no manual reload needed.
      await refreshBranding();
      setNotice(t('whiteLabel.saved'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!unlocked) {
    return (
      <>
        <PageHeader
          title={t('whiteLabel.title')}
          subtitle={t('whiteLabel.subtitle')}
        />
        <UpgradeNotice
          tier="pro"
          featureTitle={t('whiteLabel.lockedTitle')}
          featureBody={t('whiteLabel.lockedBody')}
        />
      </>
    );
  }

  if (me && !isAdmin) {
    return (
      <>
        <PageHeader
          title={t('whiteLabel.title')}
          subtitle={t('whiteLabel.subtitle')}
        />
        <EmptyState>{t('whiteLabel.adminOnly')}</EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('whiteLabel.title')}
        subtitle={t('whiteLabel.subtitle')}
      />

      <GuideCard
        storageKey="white-label"
        title={t('whiteLabel.aboutTitle')}
        body={t('whiteLabel.aboutBody')}
      />

      {error && <ErrorBox message={error} />}
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <Card className="mb-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('whiteLabel.appName')}>
            <input
              value={form.appName}
              onChange={(e) => setForm({ ...form, appName: e.target.value })}
              placeholder="Self-Hosted"
              className="field w-full"
            />
          </Field>
          <Field label={t('whiteLabel.accentColor')}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(form.accentColor) ? form.accentColor : '#6366f1'}
                onChange={(e) =>
                  setForm({ ...form, accentColor: e.target.value })
                }
                className="h-10 w-12 cursor-pointer rounded border border-white/10 bg-transparent"
              />
              <input
                value={form.accentColor}
                onChange={(e) =>
                  setForm({ ...form, accentColor: e.target.value })
                }
                placeholder="#6366f1"
                className="field w-full"
              />
            </div>
          </Field>
          <Field label={t('whiteLabel.logoUrl')}>
            <input
              value={form.logoUrl}
              onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
              placeholder="https://…/logo.png"
              className="field w-full"
            />
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={form.hidePoweredBy}
                onChange={(e) =>
                  setForm({ ...form, hidePoweredBy: e.target.checked })
                }
              />
              {t('whiteLabel.hidePoweredBy')}
            </label>
          </div>
        </div>

        {/* Live preview */}
        <div className="mt-6">
          <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
            {t('whiteLabel.preview')}
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-ink-950/40 px-4 py-3">
            {safeLogoUrl(form.logoUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={safeLogoUrl(form.logoUrl)}
                alt=""
                className="h-8 w-8 rounded-xl object-cover"
              />
            ) : (
              <span
                className="flex h-8 w-8 items-center justify-center rounded-xl shadow-glow"
                style={{ backgroundColor: form.accentColor || '#6366f1' }}
              >
                <span className="h-3 w-3 rounded-[5px] bg-white/90" />
              </span>
            )}
            <span className="text-[15px] font-semibold tracking-tight text-white">
              {form.appName || 'Self-Hosted'}
            </span>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={onSave}
            disabled={busy}
            className="btn-primary"
          >
            {busy ? t('whiteLabel.saving') : t('whiteLabel.save')}
          </button>
          <span className="text-xs text-neutral-500">
            {t('whiteLabel.reloadHint')}
          </span>
        </div>
      </Card>
    </>
  );
}
