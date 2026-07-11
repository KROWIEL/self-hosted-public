'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
  error: 'border-red-400/30 bg-red-500/10 text-red-100',
  info: 'border-white/15 bg-white/[0.06] text-neutral-100',
};

// Color of the shrinking timer bar along the toast's bottom edge.
const BAR_STYLES: Record<ToastTone, string> = {
  success: 'bg-emerald-400/70',
  error: 'bg-red-400/70',
  info: 'bg-white/50',
};

const TOAST_TTL_MS = 5000;

const ICONS: Record<ToastTone, string> = {
  success: 'M20 6 9 17l-5-5',
  error: 'M18 6 6 18M6 6l12 12',
  info: 'M12 16v-4M12 8h.01',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone) => {
      const id = nextId.current++;
      // Skip an identical toast that's already on screen (guards against
      // accidental double-calls and React StrictMode's double effect run).
      setToasts((list) =>
        list.some((x) => x.message === message && x.tone === tone)
          ? list
          : [...list, { id, message, tone }],
      );
      setTimeout(() => remove(id), TOAST_TTL_MS);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error'),
      info: (m) => push(m, 'info'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={`pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl border px-4 py-3 text-sm shadow-[0_10px_40px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl transition-all ${TONE_STYLES[t.tone]}`}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 shrink-0"
            >
              <path d={ICONS[t.tone]} />
            </svg>
            <span className="flex-1 break-words">{t.message}</span>
            <button
              onClick={() => remove(t.id)}
              className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Dismiss"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
            <span
              className={`absolute bottom-0 left-0 h-0.5 w-full origin-left ${BAR_STYLES[t.tone]}`}
              style={{ animation: `toast-timer ${TOAST_TTL_MS}ms linear forwards` }}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Access the toast API. Safe no-op if used outside the provider. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  // Fallback keeps callers crash-free even if the provider is missing.
  return {
    success: () => undefined,
    error: () => undefined,
    info: () => undefined,
  };
}
