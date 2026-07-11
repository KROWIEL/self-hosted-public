'use client';

import { Lang, useI18n } from '@/i18n';

const OPTIONS: Lang[] = ['ru', 'en'];

export function LangSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div
      className={`inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5 text-xs font-medium ${className}`}
    >
      {OPTIONS.map((l) => {
        const active = lang === l;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            aria-pressed={active}
            className={`rounded-md px-2 py-1 transition-colors ${
              active
                ? 'bg-white/10 text-white'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            {l.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
