'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, login } from '@/lib/api';
import { ErrorBox } from '@/components/ui';
import { useErrorText, useI18n } from '@/i18n';
import { LangSwitcher } from '@/components/lang-switcher';
import { useBranding } from '@/components/branding';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const brand = useBranding();
  const errText = useErrorText();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email, password, needTotp ? totp : undefined);
      router.push(
        res.needsOnboarding
          ? '/onboarding'
          : res.mustChangePassword
            ? '/settings'
            : '/dashboard',
      );
    } catch (err) {
      // First correct password prompts for the 2FA code; keep the field shown.
      if (err instanceof ApiError && err.code === 'auth.totpRequired') {
        setNeedTotp(true);
        setError(null);
      } else {
        setError(errText(err, 'login.failed'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <div className="absolute right-6 top-6">
        <LangSwitcher />
      </div>
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt=""
              className="mb-4 h-12 w-12 rounded-2xl object-cover"
            />
          ) : (
            <span
              className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-glow"
              style={
                brand.accentColor
                  ? {
                      backgroundImage: 'none',
                      backgroundColor: brand.accentColor,
                    }
                  : undefined
              }
            >
              <span className="h-4 w-4 rounded-md bg-white/90" />
            </span>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {t('login.welcome')}
          </h1>
          <p className="mt-1 text-sm text-neutral-400">{t('login.subtitle')}</p>
        </div>

        <form onSubmit={onSubmit} className="glass space-y-4 rounded-2xl p-7">
          {error && <ErrorBox message={error} />}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">
              {t('login.email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
              placeholder="you@example.com"
              required
              disabled={needTotp}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">
              {t('login.password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
              placeholder="••••••••"
              required
              disabled={needTotp}
            />
          </div>
          {needTotp && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-400">
                {t('login.totp')}
              </label>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totp}
                onChange={(e) =>
                  setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                className="field tracking-[0.3em]"
                placeholder="123456"
                autoFocus
                required
              />
              <p className="text-xs text-neutral-500">{t('login.totpHint')}</p>
            </div>
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? t('login.signingIn') : t('login.signIn')}
          </button>
          <p className="pt-1 text-center text-xs text-neutral-500">
            {t('login.noAccount')}{' '}
            <Link
              href="/register"
              className="text-indigo-300 transition-colors hover:text-indigo-200"
            >
              {t('login.register')}
            </Link>
          </p>
        </form>
        {brand.showPoweredBy && (
          <p className="mt-6 text-center text-[11px] text-neutral-600">
            {t('brand.poweredBy')}
          </p>
        )}
      </div>
    </main>
  );
}
