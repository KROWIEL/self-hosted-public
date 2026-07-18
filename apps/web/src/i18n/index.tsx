'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { en } from './en';
import { ru } from './ru';

export type Lang = 'ru' | 'en';
export type Dict = typeof en;
export type TKey = keyof Dict;

const DICTS: Record<Lang, Dict> = { en, ru };
const STORAGE_KEY = 'lang';
const DEFAULT_LANG: Lang = 'ru';

type Vars = Record<string, string | number>;

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Translate a key; supports `{name}`-style interpolation via `vars`. */
  t: (key: TKey, vars?: Vars) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  // Hydrate from storage after mount to avoid SSR/client mismatch.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ru' || saved === 'en') {
      setLangState(saved);
      document.documentElement.lang = saved;
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore storage failures (private mode) */
    }
    document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: TKey, vars?: Vars) => {
      let str = DICTS[lang][key] ?? en[key] ?? String(key);
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return str;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within a LanguageProvider');
  }
  return ctx;
}

/**
 * Localizes an error thrown by the API. Prefers the stable `code` (mapped to an
 * `error.*` key), then the raw English message, then a generic fallback — so the
 * user never sees an untranslated string when a code is available.
 */
const ROLE_VALUES = new Set(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'NONE']);

export function useErrorText() {
  const { t } = useI18n();
  return (err: unknown, fallback?: TKey): string => {
    const e =
      err && typeof err === 'object'
        ? (err as { code?: string; meta?: Record<string, unknown> })
        : undefined;
    const code = e?.code;
    if (code) {
      const key = `error.${code}` as TKey;
      if (key in en) {
        // Localize interpolation values that are role enums (e.g. VIEWER),
        // leaving everything else as-is.
        const vars: Vars = {};
        for (const [k, v] of Object.entries(e?.meta ?? {})) {
          const sv = String(v);
          vars[k] = ROLE_VALUES.has(sv)
            ? t(`members.role.${sv}` as TKey)
            : sv;
        }
        return t(key, vars);
      }
    }
    if (err instanceof Error && err.message) {
      // Nest's generic 500 English string — never show raw to the user.
      const m = err.message.trim().toLowerCase();
      if (m === 'internal server error' || m === 'internalservererror') {
        return t('error.common.internal');
      }
      return err.message;
    }
    return t(fallback ?? 'common.failed');
  };
}

/** Localizes a runtime status value (falls back to the raw value). */
export function useStatusLabel() {
  const { t } = useI18n();
  return (status: string) => {
    const key = `status.${status}` as TKey;
    return key in en ? t(key) : status;
  };
}

/** Localizes a runtime service type value (falls back to the raw value). */
export function useTypeLabel() {
  const { t } = useI18n();
  return (type: string) => {
    const key = `type.${type}` as TKey;
    return key in en ? t(key) : type;
  };
}
