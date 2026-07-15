'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setSession } from '@/lib/api';
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
 * Landing page for the OIDC redirect. The control plane bounces the browser
 * here with either session tokens or an error code in the URL fragment (so the
 * tokens never hit the server logs / Referer). We persist the tokens and move
 * on to the dashboard, or surface a localized error.
 */
export default function SsoCallbackPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const access = params.get('access');
    const refresh = params.get('refresh');
    const err = params.get('error');

    if (access && refresh) {
      setSession(access, refresh);
      // Drop the fragment so tokens aren't left in the address bar / history.
      window.history.replaceState(null, '', window.location.pathname);
      router.replace('/dashboard');
      return;
    }

    const code = err && KNOWN_ERRORS.has(err) ? err : 'sso_failed';
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
