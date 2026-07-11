'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  TwoFactorSetup,
  begin2fa,
  completeOnboarding,
  isAuthed,
} from '@/lib/api';
import { ErrorBox, Spinner } from '@/components/ui';
import { useErrorText, useI18n } from '@/i18n';
import { LangSwitcher } from '@/components/lang-switcher';

export default function OnboardingPage() {
  const router = useRouter();
  const { t } = useI18n();
  const errText = useErrorText();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthed()) {
      router.replace('/login');
      return;
    }
    begin2fa()
      .then(setSetup)
      .catch((err) => setError(errText(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!setup) return;
    setError(null);
    setLoading(true);
    try {
      await completeOnboarding({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        totpSecret: setup.secret,
        totpCode: code,
      });
      router.push('/dashboard');
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <div className="absolute right-6 top-6">
        <LangSwitcher />
      </div>
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-glow">
            <span className="h-4 w-4 rounded-md bg-white/90" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {t('onboarding.title')}
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            {t('onboarding.subtitle')}
          </p>
        </div>

        <form onSubmit={onSubmit} className="glass space-y-5 rounded-2xl p-7">
          {error && <ErrorBox message={error} />}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-400">
                {t('onboarding.firstName')}
              </label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="field"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-400">
                {t('onboarding.lastName')}
              </label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="field"
                required
              />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h2 className="text-sm font-semibold text-white">
              {t('onboarding.2faTitle')}
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              {t('onboarding.2faHint')}
            </p>

            <div className="mt-4 flex flex-col items-center gap-3">
              {setup ? (
                <Image
                  src={setup.qrDataUrl}
                  alt="TOTP QR"
                  width={176}
                  height={176}
                  unoptimized
                  className="h-44 w-44 rounded-lg bg-white p-2"
                />
              ) : (
                <div className="flex h-44 w-44 items-center justify-center rounded-lg border border-white/10">
                  <Spinner />
                </div>
              )}
              {setup && (
                <div className="w-full text-center">
                  <p className="text-xs text-neutral-500">
                    {t('onboarding.secretManual')}
                  </p>
                  <code className="mt-1 block break-all font-mono text-xs text-neutral-300">
                    {setup.secret}
                  </code>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-1.5">
              <label className="text-xs font-medium text-neutral-400">
                {t('onboarding.code')}
              </label>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                className="field tracking-[0.3em]"
                placeholder="123456"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !setup || code.length !== 6}
            className="btn-primary w-full"
          >
            {loading ? t('onboarding.finishing') : t('onboarding.finish')}
          </button>
        </form>
      </div>
    </main>
  );
}
