'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { register } from '@/lib/api';
import { ErrorBox } from '@/components/ui';
import { PasswordChecklist } from '@/components/password-checklist';
import { isStrongPassword } from '@/lib/password';
import { useErrorText, useI18n } from '@/i18n';
import { LangSwitcher } from '@/components/lang-switcher';

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const errText = useErrorText();
  const inviteToken =
    searchParams.get('invite')?.trim() ||
    searchParams.get('token')?.trim() ||
    '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(email.trim(), password, inviteToken || undefined);
      router.push('/onboarding');
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
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-glow">
            <span className="h-4 w-4 rounded-md bg-white/90" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {t('register.title')}
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            {inviteToken
              ? t('register.subtitleInvite')
              : t('register.subtitle')}
          </p>
        </div>

        <form onSubmit={onSubmit} className="glass space-y-4 rounded-2xl p-7">
          {error && <ErrorBox message={error} />}
          {inviteToken && (
            <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              {t('register.inviteReady')}
            </p>
          )}
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
            />
            <PasswordChecklist value={password} />
          </div>
          <button
            type="submit"
            disabled={loading || !isStrongPassword(password)}
            className="btn-primary w-full"
          >
            {loading ? t('register.creating') : t('register.continue')}
          </button>
          <p className="pt-1 text-center text-xs text-neutral-500">
            {t('register.haveAccount')}{' '}
            <Link
              href="/login"
              className="text-indigo-300 transition-colors hover:text-indigo-200"
            >
              {t('register.signIn')}
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
