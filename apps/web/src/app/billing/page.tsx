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
import { TKey, useErrorText, useI18n } from '@/i18n';
import { useToast } from '@/components/toast';

const BUY_URL: Record<Exclude<LicenseTier, 'free'>, string> = {
  homelab:
    process.env.NEXT_PUBLIC_BUY_HOMELAB_URL ??
    'https://sh.m2by.ru/buy?tier=homelab',
  pro:
    process.env.NEXT_PUBLIC_BUY_PRO_URL ??
    'https://sh.m2by.ru/buy?tier=pro',
};

/** Pro add-on modules, in display order (mirrors ALL_MODULES in shared). */
const PRO_MODULES = [
  'reverse-tunnels',
  'service-cron',
  'preview-envs',
  'offsite-backups',
  'alerts',
  'metrics-history',
  'sso',
  'audit-export',
  'api-cli',
  'white-label',
  'email',
] as const;

/** Tier ordering for upgrade/downgrade comparisons (free < homelab < pro). */
const TIER_RANK: Record<LicenseTier, number> = {
  free: 0,
  homelab: 1,
  pro: 2,
};

/** A single scannable capability: a short title plus an optional "why" line. */
type Feature = { title: string; desc?: string };

export default function BillingPage() {
  return (
    <AppShell>
      <BillingContent />
    </AppShell>
  );
}

function BillingContent() {
  const { t } = useI18n();
  const errorText = useErrorText();
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
      setError(errorText(e));
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
      setError(errorText(e));
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
  const daysLeft =
    entitlements.expiresAt != null
      ? Math.ceil((entitlements.expiresAt * 1000 - Date.now()) / 86_400_000)
      : null;
  const expiringSoon = daysLeft != null && daysLeft <= 14;

  // Build a title/desc feature from a base i18n key (`<base>.title`, `<base>.desc`).
  const feat = (base: string): Feature => ({
    title: t(`${base}.title` as TKey),
    desc: t(`${base}.desc` as TKey),
  });

  // A plan cheaper than the active one can't be "bought" — you cancel the
  // current subscription to move down instead.
  const currentRank = TIER_RANK[entitlements.tier];

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
              ) : entitlements.tier !== 'free' ? (
                <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                  {t('billing.inactive')}
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
            {expiringSoon && (
              <p className="mt-1 text-sm text-amber-300">
                {t('billing.expiresSoon', { days: Math.max(daysLeft ?? 0, 0) })}
              </p>
            )}
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
      <div className="grid items-start gap-4 md:grid-cols-3">
        <PlanCard
          tier="free"
          price={t('billing.price.free')}
          period={t('billing.forever')}
          current={entitlements.tier === 'free'}
          lowerThanCurrent={TIER_RANK.free < currentRank}
          features={[
            feat('billing.feat.free.deploy'),
            feat('billing.feat.free.https'),
            feat('billing.feat.free.databases'),
            feat('billing.feat.free.observability'),
            feat('billing.feat.free.access'),
            feat('billing.feat.free.node'),
          ]}
        />
        <PlanCard
          tier="homelab"
          price={t('billing.price.homelab')}
          period={t('billing.perMonth')}
          current={entitlements.tier === 'homelab'}
          lowerThanCurrent={TIER_RANK.homelab < currentRank}
          highlight
          features={[
            feat('billing.feat.homelab.allFree'),
            {
              title: t('billing.feat.homelab.tunnels.title'),
              desc: t('billing.moduleDesc.reverse-tunnels'),
            },
            {
              title: t('billing.feat.homelab.cron.title'),
              desc: t('billing.moduleDesc.service-cron'),
            },
            feat('billing.feat.homelab.limits'),
          ]}
        />
        <PlanCard
          tier="pro"
          price={t('billing.price.pro')}
          period={t('billing.perMonth')}
          current={entitlements.tier === 'pro'}
          lowerThanCurrent={TIER_RANK.pro < currentRank}
          features={[
            feat('billing.feat.pro.allHomelab'),
            feat('billing.feat.pro.unlimited'),
          ]}
          modulesTitle={t('billing.proModulesTitle')}
          modules={PRO_MODULES.map((m) => ({
            title: t(`billing.module.${m}` as TKey),
            desc: t(`billing.moduleDesc.${m}` as TKey),
          }))}
        />
      </div>
    </>
  );
}

function CheckIcon() {
  return (
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
  );
}

function FeatureItem({ feature }: { feature: Feature }) {
  return (
    <li className="flex gap-2 text-sm">
      <CheckIcon />
      <span>
        <span className="text-neutral-200">{feature.title}</span>
        {feature.desc && (
          <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">
            {feature.desc}
          </span>
        )}
      </span>
    </li>
  );
}

function PlanCard({
  tier,
  price,
  period,
  features,
  modules,
  modulesTitle,
  current,
  lowerThanCurrent = false,
  highlight = false,
}: {
  tier: LicenseTier;
  price: string;
  period: string;
  features: Feature[];
  modules?: Feature[];
  modulesTitle?: string;
  current: boolean;
  lowerThanCurrent?: boolean;
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
      <ul className="mt-4 space-y-2.5">
        {features.map((f, i) => (
          <FeatureItem key={i} feature={f} />
        ))}
      </ul>
      {modules && modules.length > 0 && (
        <div className="mt-5 border-t border-white/5 pt-4">
          {modulesTitle && (
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {modulesTitle}
            </p>
          )}
          <ul className="mt-3 space-y-2.5">
            {modules.map((m, i) => (
              <FeatureItem key={i} feature={m} />
            ))}
          </ul>
        </div>
      )}
      {!current && lowerThanCurrent ? (
        <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-center text-xs leading-relaxed text-neutral-400">
          {t('billing.downgradeHint')}
        </p>
      ) : !current && tier !== 'free' ? (
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
      ) : null}
    </Card>
  );
}
