'use client';

import Link from 'next/link';
import { LicenseTier } from '@/lib/api';
import { TKey, useI18n } from '@/i18n';

/**
 * Full-panel placeholder shown when a licensed feature is locked. Explains the
 * feature and links to Billing to upgrade — turning a gate into a sales touch.
 */
export function UpgradeNotice({
  tier,
  featureTitle,
  featureBody,
}: {
  /** Lowest tier that unlocks the feature (e.g. 'homelab'). */
  tier: LicenseTier;
  featureTitle: string;
  featureBody: string;
}) {
  const { t } = useI18n();
  const tierLabel = t(`billing.tier.${tier}` as TKey);

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/10 via-transparent to-violet-500/10 p-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      </div>
      <h2 className="mt-5 text-xl font-semibold text-white">{featureTitle}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-neutral-400">
        {featureBody}
      </p>
      <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300">
        {t('billing.requiresPlan', { plan: tierLabel })}
      </span>
      <div className="mt-6">
        <Link href="/billing" className="btn-primary">
          {t('billing.viewPlans')}
        </Link>
      </div>
    </div>
  );
}
