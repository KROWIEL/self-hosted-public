'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TKey, useI18n } from '@/i18n';

/** Error codes we have a localized message for; anything else is generic. */
const KNOWN_ERRORS = new Set([
  'invalid_request',
  'not_licensed',
  'not_configured',
  'bad_state',
  'no_email',
  'email_unverified',
  'domain_not_allowed',
  'no_account',
  'access_denied',
  'sso_failed',
]);

/**
 * Landing page for the OIDC redirect. On success the control plane sets the
 * session as HttpOnly cookies (H-1) and redirects straight to the dashboard, so
 * this page is normally only reached with an `error` code in the URL fragment
 * (kept out of the query string so it never hits server logs / Referer). If we
 * somehow arrive without an error, fall through to the dashboard.
 */
export default function SsoCallbackPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const err = params.get('error');

    if (!err) {
      // No error → the cookies were set server-side; head to the dashboard.
      router.replace('/dashboard');
      return;
    }

    const code = KNOWN_ERRORS.has(err) ? err : 'sso_failed';
    setError(`sso.error.${code}` as TKey);
  }, [router, t]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        {error ? (
          <div className="glass rounded-2xl p-7">
            <h1 className="text-lg font-semibold text-white">
              {t('sso.error.title')}
            </h1>
            <p className="mt-2 text-sm text-neutral-400">
              {t(error as TKey)}
            </p>
            <Link
              href="/login"
              className="btn-primary mt-6 inline-flex w-full justify-center"
            >
              {t('sso.error.backToLogin')}
            </Link>
          </div>
        ) : (
          <p className="text-sm text-neutral-400">{t('sso.signingIn')}</p>
        )}
      </div>
    </main>
  );
}
