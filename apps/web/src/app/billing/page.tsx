'use client';

import { useEffect, useState } from 'react';
import {
  AuthMe,
  LicenseTier,
  clearLicense,
  getMe,
  setLicense,
} from '@/lib/api';
import { AppShell } from '@/components/shell';
import { useEntitlements } from '@/components/entitlements';
import { Card, ErrorBox, Field, PageHeader, Spinner } from '@/components/ui';
import { TKey, useI18n } from '@/i18n';
import { useToast } from '@/components/toast';

const BUY_URL: Record<Exclude<LicenseTier, 'free'>, string> = {
  homelab:
    process.env.NEXT_PUBLIC_BUY_HOMELAB_URL ??
    'https://selfhosted.example.com/buy/home-lab',
  pro:
    process.env.NEXT_PUBLIC_BUY_PRO_URL ??
    'https://selfhosted.example.com/buy/pro',
};

export default function BillingPage() {
  return (
    <AppShell>
      <BillingContent />
    </AppShell>
  );
}

function BillingContent() {
  const { t } = useI18n();
  const toast = useToast();
  const { entitlements, loading, refresh } = useEntitlements();
  const [me, setMe] = useState<AuthMe | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const isAdmin = me?.role === 'ADMIN';

  async function activate() {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await setLicense(key.trim());
      await refresh();
      setKey('');
      toast.success(t('billing.activated'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await clearLicense();
      await refresh();
      toast.success(t('billing.removed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title={t('nav.billing')} subtitle={t('billing.subtitle')} />
        <Spinner />
      </>
    );
  }

  const tierLabel = t(`billing.tier.${entitlements.tier}` as TKey);
  const expiry =
    entitlements.expiresAt != null
      ? new Date(entitlements.expiresAt * 1000).toLocaleDateString()
      : t('billing.perpetual');

  return (
    <>
      <PageHeader title={t('nav.billing')} subtitle={t('billing.subtitle')} />

      {/* Current plan */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              {t('billing.currentPlan')}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-2xl font-semibold text-white">
                {tierLabel}
              </span>
              {entitlements.licensed ? (
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                  {t('billing.active')}
                </span>
              ) : (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-neutral-400">
                  {t('billing.free')}
                </span>
              )}
            </div>
            {entitlements.name && (
              <p className="mt-1 text-sm text-neutral-400">
                {entitlements.name}
              </p>
            )}
            <p className="mt-2 text-sm text-neutral-400">
              {t('billing.expires')}: {expiry}
            </p>
            {entitlements.activation?.required && (
              <p
                className={`mt-2 flex items-center gap-1.5 text-sm ${
                  entitlements.activation.ok
                    ? 'text-emerald-300'
                    : 'text-amber-300'
                }`}
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    entitlements.activation.ok ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                {entitlements.activation.ok
                  ? t('billing.activation.online')
                  : t('billing.activation.offline')}
                {entitlements.activation.lastCheckAt != null && (
                  <span className="text-neutral-500">
                    · {t('billing.activation.lastCheck')}:{' '}
                    {new Date(
                      entitlements.activation.lastCheckAt * 1000,
                    ).toLocaleString()}
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              {t('billing.unlockedModules')}
            </p>
            {entitlements.modules.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-500">
                {t('billing.noModules')}
              </p>
            ) : (
              <div className="mt-1.5 flex max-w-xs flex-wrap justify-end gap-1.5">
                {entitlements.modules.map((m) => (
                  <span
                    key={m}
                    className="rounded-md border border-indigo-400/20 bg-indigo-400/10 px-2 py-0.5 text-xs text-indigo-200"
                  >
                    {t(`billing.module.${m}` as TKey)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      {error && <ErrorBox message={error} />}

      {/* License key management (admin only) */}
      {isAdmin ? (
        <Card className="mb-6">
          <h3 className="text-sm font-semibold text-white">
            {t('billing.licenseKey')}
          </h3>
          <p className="mt-1 text-sm text-neutral-400">
            {t('billing.licenseKeyHint')}
          </p>
          <div className="mt-4">
            <Field label={t('billing.licenseKey')}>
              <textarea
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t('billing.licenseKeyPlaceholder')}
                rows={3}
                className="field w-full resize-none break-all font-mono text-xs"
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={activate}
              disabled={busy || !key.trim()}
              className="btn-primary"
            >
              {busy ? t('billing.activating') : t('billing.activate')}
            </button>
            {entitlements.licensed && (
              <button
                onClick={remove}
                disabled={busy}
                className="btn-danger-ghost"
              >
                {t('billing.remove')}
              </button>
            )}
          </div>
        </Card>
      ) : (
        <Card className="mb-6">
          <p className="text-sm text-neutral-400">{t('billing.adminOnly')}</p>
        </Card>
      )}

      {/* Plans */}
      <h3 className="mb-3 mt-8 text-lg font-semibold text-white">
        {t('billing.plansTitle')}
      </h3>
      <div className="grid gap-4 md:grid-cols-3">
        <PlanCard
          tier="free"
          price={t('billing.price.free')}
          period={t('billing.forever')}
          current={entitlements.tier === 'free'}
          features={[t('billing.feat.core'), t('billing.feat.dbLogs'), t('billing.feat.rbac')]}
        />
        <PlanCard
          tier="homelab"
          price={t('billing.price.homelab')}
          period={t('billing.perMonth')}
          current={entitlements.tier === 'homelab'}
          highlight
          features={[t('billing.feat.allFree'), t('billing.feat.tunnels')]}
        />
        <PlanCard
          tier="pro"
          price={t('billing.price.pro')}
          period={t('billing.perMonth')}
          current={entitlements.tier === 'pro'}
          features={[t('billing.feat.allHomelab'), t('billing.feat.proAll')]}
        />
      </div>
    </>
  );
}

function PlanCard({
  tier,
  price,
  period,
  features,
  current,
  highlight = false,
}: {
  tier: LicenseTier;
  price: string;
  period: string;
  features: string[];
  current: boolean;
  highlight?: boolean;
}) {
  const { t } = useI18n();
  const name = t(`billing.tier.${tier}` as TKey);

  return (
    <Card
      className={highlight ? 'border-indigo-400/40 ring-1 ring-indigo-400/20' : ''}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-base font-semibold text-white">{name}</h4>
        {current && (
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
            {t('billing.yourPlan')}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-white">{price}</span>
        <span className="text-sm text-neutral-500">{period}</span>
      </div>
      <ul className="mt-4 space-y-2">
        {features.map((f, i) => (
          <li key={i} className="flex gap-2 text-sm text-neutral-300">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 shrink-0 text-emerald-400"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {tier !== 'free' && !current && (
        <a
          href={BUY_URL[tier]}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-5 block w-full text-center ${
            highlight ? 'btn-primary' : 'btn-ghost'
          }`}
        >
          {t('billing.buy')}
        </a>
      )}
    </Card>
  );
}
