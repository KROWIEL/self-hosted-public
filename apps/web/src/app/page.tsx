'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import { LangSwitcher } from '@/components/lang-switcher';

export default function Home() {
  const { t } = useI18n();
  return (
    <main className="relative mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="absolute right-6 top-6">
        <LangSwitcher />
      </div>
      <div className="animate-fade-up">
        <span className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-glow">
          <span className="h-5 w-5 rounded-lg bg-white/90" />
        </span>
        <h1 className="text-5xl font-bold tracking-tight">
          <span className="text-gradient">Self-Hosted</span> PaaS
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-neutral-400">{t('home.subtitle')}</p>
      </div>
      <div className="flex animate-fade-up gap-3">
        <Link href="/login" className="btn-primary px-6 py-2.5">
          {t('home.signIn')}
        </Link>
        <Link href="/dashboard" className="btn-ghost px-6 py-2.5">
          {t('home.openDashboard')}
        </Link>
      </div>
    </main>
  );
}
