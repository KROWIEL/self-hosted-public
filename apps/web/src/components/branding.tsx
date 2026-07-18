'use client';

import { useEffect, useState } from 'react';
import { BrandingEffective, getBranding } from '@/lib/api';

const DEFAULT: BrandingEffective = {
  appName: 'Self-Hosted',
  logoUrl: '',
  accentColor: '',
  showPoweredBy: false,
};

// Module-level cache so the branding endpoint is hit once per page load,
// shared across the shell, login screen, etc. A tiny pub/sub lets every
// consumer update live when branding changes (e.g. right after an admin saves).
let cache: BrandingEffective | null = null;
let inflight: Promise<BrandingEffective> | null = null;
const listeners = new Set<(b: BrandingEffective) => void>();

function fetchBranding(force: boolean): Promise<BrandingEffective> {
  if (!force && cache) return Promise.resolve(cache);
  if (!force && inflight) return inflight;
  inflight = getBranding()
    .then((b) => {
      cache = b;
      inflight = null;
      listeners.forEach((l) => l(b));
      return b;
    })
    .catch(() => {
      inflight = null;
      return cache ?? DEFAULT;
    });
  return inflight;
}

/** Force a re-fetch and notify all consumers (call after saving branding). */
export function refreshBranding(): Promise<BrandingEffective> {
  return fetchBranding(true);
}

/** Reads license-aware branding (app name / logo / accent). Falls back to the
 * default brand while loading or on error. */
export function useBranding(): BrandingEffective {
  const [branding, setBranding] = useState<BrandingEffective>(cache ?? DEFAULT);

  useEffect(() => {
    const listener = (b: BrandingEffective) => setBranding(b);
    listeners.add(listener);
    fetchBranding(false).then(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return branding;
}

/**
 * Applies the effective branding to the whole document: browser tab title,
 * favicon (swapped to the custom logo) and the accent-colour CSS variables that
 * drive primary buttons, focus rings and glows. Renders nothing; mount once in
 * the root layout so it also covers the login screen.
 */
export function BrandingApplier(): null {
  const brand = useBranding();

  useEffect(() => {
    if (brand.appName) document.title = brand.appName;
  }, [brand.appName]);

  useEffect(() => {
    applyFavicon(brand.logoUrl);
  }, [brand.logoUrl]);

  useEffect(() => {
    applyAccent(brand.accentColor);
  }, [brand.accentColor]);

  return null;
}

/**
 * Guards against a hostile branding logo URL. Only `https:` URLs, same-origin
 * URLs, and relative same-origin paths are allowed; `data:`, `javascript:`,
 * `blob:` and plain remote `http:` are rejected so a stored logo can't smuggle
 * script or exfiltrate via a favicon/`<img>` (L-1). An empty value means "no
 * logo" and is considered valid. Runs both on save and on apply.
 */
export function isSafeLogoUrl(raw: string): boolean {
  const url = (raw ?? '').trim();
  if (!url) return true;
  // Relative same-origin path (but not a protocol-relative "//host" URL).
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  let parsed: URL;
  try {
    const base =
      typeof window !== 'undefined' ? window.location.origin : undefined;
    parsed = new URL(url, base);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  if (
    typeof window !== 'undefined' &&
    parsed.origin === window.location.origin
  ) {
    return true;
  }
  return false;
}

/** Returns the URL when safe, otherwise an empty string (renders no logo). */
export function safeLogoUrl(raw: string): string {
  const url = (raw ?? '').trim();
  return isSafeLogoUrl(url) ? url : '';
}

const FAVICON_ID = 'brand-favicon';

function applyFavicon(rawUrl: string) {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(FAVICON_ID) as HTMLLinkElement | null;
  const url = safeLogoUrl(rawUrl);
  if (!url) {
    existing?.remove();
    return;
  }
  // Append (or reuse) our own <link> last in <head>; browsers use the last
  // declared icon, so this overrides the framework's default favicon.
  const link =
    existing ??
    (() => {
      const el = document.createElement('link');
      el.id = FAVICON_ID;
      el.rel = 'icon';
      document.head.appendChild(el);
      return el;
    })();
  link.href = url;
}

const ACCENT_VARS = [
  '--accent',
  '--accent-2',
  '--accent-strong',
  '--accent-glow',
  '--accent-ring',
] as const;

function applyAccent(hex: string) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const rgb = hexToRgb(hex);
  if (!rgb) {
    // Fall back to the defaults declared in globals.css.
    ACCENT_VARS.forEach((v) => root.style.removeProperty(v));
    return;
  }
  const { r, g, b } = rgb;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-2', adjust(hex, 14));
  root.style.setProperty('--accent-strong', adjust(hex, -14));
  root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.45)`);
  root.style.setProperty('--accent-ring', `rgba(${r}, ${g}, ${b}, 0.3)`);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Lighten (pct > 0) or darken (pct < 0) a hex colour toward white/black. */
function adjust(hex: string, pct: number): string {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const target = pct >= 0 ? 255 : 0;
  const amt = Math.abs(pct) / 100;
  const mix = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v + (target - v) * amt)));
  const to2 = (v: number) => v.toString(16).padStart(2, '0');
  return `#${to2(mix(c.r))}${to2(mix(c.g))}${to2(mix(c.b))}`;
}
