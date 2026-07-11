'use client';

import {
  Children,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useI18n, useStatusLabel } from '@/i18n';
import { useToast } from '@/components/toast';

export type Tone = 'green' | 'amber' | 'sky' | 'neutral' | 'red';

const STATUS_TONE: Record<string, Tone> = {
  RUNNING: 'green',
  SUCCESS: 'green',
  ONLINE: 'green',
  BUILDING: 'amber',
  DEPLOYING: 'amber',
  QUEUED: 'sky',
  CREATED: 'neutral',
  STOPPED: 'neutral',
  OFFLINE: 'neutral',
  ERROR: 'red',
  FAILED: 'red',
};

const TONE_CLASSES: Record<Tone, string> = {
  green: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  amber: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  sky: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  neutral: 'border-white/15 bg-white/5 text-neutral-300',
  red: 'border-red-400/30 bg-red-400/10 text-red-300',
};

const DOT_CLASSES: Record<Tone, string> = {
  green: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
  amber: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]',
  sky: 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]',
  neutral: 'bg-neutral-500',
  red: 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]',
};

const BAR_CLASSES: Record<Tone, string> = {
  green: 'bg-emerald-400',
  amber: 'bg-amber-400',
  sky: 'bg-sky-400',
  neutral: 'bg-neutral-600',
  red: 'bg-red-400',
};

const TEXT_TONE: Record<Tone, string> = {
  green: 'text-emerald-300',
  amber: 'text-amber-300',
  sky: 'text-sky-300',
  neutral: 'text-neutral-400',
  red: 'text-red-300',
};

/** Map a domain status string to a semantic tone. */
export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? 'neutral';
}

export function StatusBadge({ status }: { status: string }) {
  const statusLabel = useStatusLabel();
  const tone = STATUS_TONE[status] ?? 'neutral';
  const pulse = tone === 'amber' || tone === 'sky';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[tone]} ${
          pulse ? 'animate-pulse' : ''
        }`}
      />
      {statusLabel(status)}
    </span>
  );
}

/** A bare status dot (no label). Shows the label as a native tooltip. */
export function StatusDot({
  status,
  className = '',
}: {
  status: string;
  className?: string;
}) {
  const statusLabel = useStatusLabel();
  const tone = STATUS_TONE[status] ?? 'neutral';
  const pulse = tone === 'amber' || tone === 'sky';
  return (
    <span
      title={statusLabel(status)}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT_CLASSES[tone]} ${
        pulse ? 'animate-pulse' : ''
      } ${className}`}
    />
  );
}

/**
 * Status as a coloured dot + label, without a pill background. Meant to sit
 * next to an entity name (identity), not inside the actions cluster.
 */
export function StatusText({
  status,
  className = '',
}: {
  status: string;
  className?: string;
}) {
  const statusLabel = useStatusLabel();
  const tone = STATUS_TONE[status] ?? 'neutral';
  const pulse = tone === 'amber' || tone === 'sky';
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${TEXT_TONE[tone]} ${className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[tone]} ${
          pulse ? 'animate-pulse' : ''
        }`}
      />
      {statusLabel(status)}
    </span>
  );
}

export function Card({
  id,
  children,
  className = '',
  hover = false,
  accentTone,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  hover?: boolean;
  /** Renders a coloured status bar down the left edge of the card. */
  accentTone?: Tone;
}) {
  return (
    <div
      id={id}
      className={`glass ${hover ? 'glass-hover' : ''} relative overflow-hidden rounded-2xl p-5 ${className}`}
    >
      {accentTone && (
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-1 ${BAR_CLASSES[accentTone]}`}
        />
      )}
      {children}
    </div>
  );
}

export function PanelCard({
  id,
  title,
  description,
  action,
  children,
  className = '',
}: {
  id?: string;
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card id={id} className={className}>
      {(title || description || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </Card>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={`rounded-xl border p-3 ${TONE_CLASSES[tone]}`}>
      <p className="text-xs opacity-80">{label}</p>
      <p className="mt-1 truncate font-mono text-lg font-semibold text-white">
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-xs opacity-75">{sub}</p>}
    </div>
  );
}

export function ResponsiveGrid({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid gap-6 md:grid-cols-2 xl:grid-cols-3 ${className}`}>
      {children}
    </div>
  );
}

const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function sameOrder(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * True masonry layout. Unlike CSS multi-column (which splits the list in
 * document order and balances poorly with tall, unbreakable cards), this
 * measures each card and drops it into the currently shortest column, so cards
 * flow left-to-right and fill gaps instead of piling up in one column. The
 * column count flexes with the container width and it re-balances whenever a
 * card resizes (e.g. a form entering edit mode).
 */
export function Masonry({
  children,
  className = '',
  minColWidth = 360,
  maxColumns = 3,
  gap = 24,
}: {
  children: ReactNode;
  className?: string;
  minColWidth?: number;
  maxColumns?: number;
  gap?: number;
}) {
  const items = Children.toArray(children);
  const count = items.length;
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [columns, setColumns] = useState(1);
  const [assignment, setAssignment] = useState<number[]>(() =>
    new Array(count).fill(0),
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const fit = Math.floor((w + gap) / (minColWidth + gap));
      setColumns(Math.max(1, Math.min(maxColumns, fit)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gap, minColWidth, maxColumns]);

  const recompute = useCallback(() => {
    const heights = new Array(columns).fill(0);
    const next = new Array(count).fill(0);
    for (let i = 0; i < count; i++) {
      let col = 0;
      for (let k = 1; k < columns; k++) if (heights[k] < heights[col]) col = k;
      next[i] = col;
      heights[col] += (itemRefs.current[i]?.offsetHeight ?? 0) + gap;
    }
    setAssignment((prev) => (sameOrder(prev, next) ? prev : next));
  }, [columns, count, gap]);

  useIsoLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const ro = new ResizeObserver(() => recompute());
    itemRefs.current.forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, [recompute, count]);

  return (
    <div
      ref={containerRef}
      className={`flex items-start ${className}`}
      style={{ gap }}
    >
      {Array.from({ length: columns }).map((_, col) => (
        <div
          key={col}
          className="flex min-w-0 flex-1 flex-col"
          style={{ gap }}
        >
          {items.map((child, i) =>
            (assignment[i] ?? 0) === col ? (
              <div
                key={i}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
              >
                {child}
              </div>
            ) : null,
          )}
        </div>
      ))}
    </div>
  );
}

export function MasonryItem({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return className ? <div className={className}>{children}</div> : <>{children}</>;
}

export function Modal({
  title,
  description,
  children,
  onClose,
  footer,
  className = '',
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/60 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-950 shadow-2xl sm:max-h-[calc(100dvh-3rem)] ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            {description && (
              <div className="mt-1 text-sm leading-relaxed text-neutral-400">
                {description}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-white/10 px-5 py-4 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: 'danger' | 'warning';
}

export function useConfirmDialog() {
  const { t } = useI18n();
  const [state, setState] = useState<
    (ConfirmOptions & { resolve: (value: boolean) => void }) | null
  >(null);

  function confirm(options: ConfirmOptions) {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, resolve });
    });
  }

  function close(value: boolean) {
    state?.resolve(value);
    setState(null);
  }

  const dialog = state ? (
    <Modal
      title={state.title}
      onClose={() => close(false)}
      className="max-w-md"
      footer={
        <>
          <button onClick={() => close(false)} className="btn-ghost">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => close(true)}
            className={state.tone === 'danger' ? 'btn-danger' : 'btn-primary'}
          >
            {state.confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-neutral-300">{state.message}</p>
    </Modal>
  ) : null;

  return { confirm, dialog };
}

export function ResourceMeter({
  label,
  used,
  limit,
  unit,
  hint,
  formatValue,
  inUse,
  inUseValue,
}: {
  label: string;
  used: number;
  limit: number;
  unit: string;
  hint?: ReactNode;
  formatValue?: (value: number) => string;
  /** Real-time consumption label shown next to the allocated value. */
  inUse?: ReactNode;
  /** Numeric consumption (same unit as limit) used to draw the bar marker. */
  inUseValue?: number;
}) {
  const { t } = useI18n();
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const value = formatValue
    ? `${formatValue(used)} / ${formatValue(limit)}`
    : `${used} / ${limit} ${unit}`;
  const tone =
    pct >= 90 ? 'bg-red-400' : pct >= 75 ? 'bg-amber-400' : 'bg-emerald-400';
  // Fraction of the allocation currently consumed (best-effort overlay marker).
  const inUsePct =
    inUseValue != null && limit > 0
      ? Math.min(100, Math.round((inUseValue / limit) * 100))
      : null;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-neutral-400">{label}</span>
        <span className="font-mono text-neutral-300">
          {value}
          {inUse != null && (
            <span className="text-neutral-500">
              {' '}| {inUse} {t('resources.inUse')}
            </span>
          )}
        </span>
      </div>
      <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        {inUsePct != null && (
          <span
            className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-white/70"
            style={{ left: `calc(${inUsePct}% - 1px)` }}
          />
        )}
      </div>
      {hint && <p className="mt-1.5 text-xs text-neutral-600">{hint}</p>}
    </div>
  );
}

export function formatCpu(value: number) {
  const cores = value / 100;
  return `${Number.isInteger(cores) ? cores.toFixed(0) : cores.toFixed(1)} cores`;
}

export function ResourceSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
  hint,
  recommendedValue,
  recommendedLabel,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
  hint?: ReactNode;
  recommendedValue?: number;
  recommendedLabel?: string;
  disabled?: boolean;
}) {
  const safeMax = Math.max(min, max);
  const safeValue = Math.min(Math.max(value, min), safeMax);
  const recommended =
    recommendedValue === undefined
      ? undefined
      : Math.min(Math.max(recommendedValue, min), safeMax);
  const recommendedPct =
    recommended === undefined || safeMax === min
      ? 0
      : ((recommended - min) / (safeMax - min)) * 100;
  const marks = [min, min + (safeMax - min) * 0.25, min + (safeMax - min) * 0.5, min + (safeMax - min) * 0.75, safeMax];
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-neutral-400">{label}</span>
        <span className="font-mono text-sm text-neutral-200">
          {formatValue(safeValue)}
        </span>
      </div>
      <div className="relative pt-3">
        {recommended !== undefined && (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2"
            style={{ left: `${recommendedPct}%` }}
          >
            <span className="block h-3 w-px bg-emerald-400" />
          </div>
        )}
        <input
          type="range"
          min={min}
          max={safeMax}
          step={step}
          value={safeValue}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          className="w-full accent-indigo-500 disabled:opacity-50"
        />
      </div>
      <div className="mt-1 grid grid-cols-5 gap-1 font-mono text-[10px] text-neutral-600">
        {marks.map((mark, idx) => (
          <span
            key={idx}
            className={
              idx === 0
                ? 'text-left'
                : idx === marks.length - 1
                  ? 'text-right'
                  : 'text-center'
            }
          >
            {formatValue(Math.round(mark / step) * step)}
          </span>
        ))}
      </div>
      {recommended !== undefined && (
        <p className="mt-1 text-xs text-emerald-400">
          {(recommendedLabel ?? 'recommended')}: {formatValue(recommended)}
        </p>
      )}
      {hint && <p className="mt-1.5 text-xs text-neutral-600">{hint}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-8 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>
        )}
      </div>
      {action}
    </header>
  );
}

/** A labelled form control: a caption above its input/select children. */
export function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-neutral-400">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-600">{hint}</span>}
    </label>
  );
}

export interface GuideStep {
  title: string;
  body: string;
}

/**
 * A collapsible explainer card: what a screen is for and how to use it.
 * Collapse state is remembered per screen via localStorage (key `guide:<id>`).
 */
export function GuideCard({
  storageKey,
  title,
  body,
  steps,
  note,
}: {
  storageKey: string;
  title: string;
  body: string;
  steps?: GuideStep[];
  note?: { title: string; body: string };
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(`guide:${storageKey}`) === '0') setOpen(false);
    } catch {
      /* localStorage may be unavailable */
    }
  }, [storageKey]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(`guide:${storageKey}`, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const cols =
    steps && steps.length >= 3
      ? 'sm:grid-cols-3'
      : steps && steps.length === 2
        ? 'sm:grid-cols-2'
        : 'sm:grid-cols-1';

  return (
    <Card className="mb-6 border-white/10 bg-white/[0.025]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-400/30 bg-indigo-400/10 text-indigo-300">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-neutral-400">
              {body}
            </p>
          </div>
        </div>
        <button
          onClick={toggle}
          className="shrink-0 text-xs text-neutral-400 transition-colors hover:text-white"
        >
          {open ? t('common.guideHide') : t('common.guideShow')}
        </button>
      </div>

      {open && (steps?.length || note) && (
        <>
          {steps && steps.length > 0 && (
            <ol className={`mt-5 grid gap-3 ${cols}`}>
              {steps.map((s, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-300">
                    {i + 1}
                  </span>
                  <p className="mt-2 text-sm font-medium text-white">
                    {s.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                    {s.body}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {note && (
            <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <p className="text-xs font-medium text-neutral-300">
                {note.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                {note.body}
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * Surfaces an error only as a bottom-screen toast — no inline body box — so the
 * message doesn't linger in the page. Renders nothing; each new message value
 * (per mount) fires one auto-dismissing toast.
 */
export function ErrorBox({ message }: { message: string }) {
  const toast = useToast();
  useEffect(() => {
    if (message) toast.error(message);
    // toast is stable (memoized); re-fire only when the message changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);
  return null;
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 text-sm text-neutral-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
      {label ?? t('common.loading')}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center text-sm text-neutral-500">
      {children}
    </div>
  );
}
