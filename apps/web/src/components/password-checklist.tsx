'use client';

import {
  PASSWORD_RULE_ORDER,
  PasswordRuleKey,
  passwordChecks,
} from '@/lib/password';
import { TKey, useI18n } from '@/i18n';

const RULE_KEYS: Record<PasswordRuleKey, TKey> = {
  length: 'password.rule.length',
  upper: 'password.rule.upper',
  lower: 'password.rule.lower',
  digits: 'password.rule.digits',
  special: 'password.rule.special',
};

/** A live checklist of the strong-password requirements. */
export function PasswordChecklist({ value }: { value: string }) {
  const { t } = useI18n();
  const checks = passwordChecks(value);
  return (
    <ul className="mt-2 space-y-1">
      {PASSWORD_RULE_ORDER.map((key) => {
        const met = checks[key];
        return (
          <li
            key={key}
            className={`flex items-center gap-2 text-xs transition-colors ${
              met ? 'text-emerald-400' : 'text-neutral-500'
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              {met ? (
                <path d="M20 6 9 17l-5-5" />
              ) : (
                <circle cx="12" cy="12" r="9" strokeWidth="1.5" />
              )}
            </svg>
            <span>{t(RULE_KEYS[key])}</span>
          </li>
        );
      })}
    </ul>
  );
}
