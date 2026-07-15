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
// shared across the shell, login screen, etc.
let cache: BrandingEffective | null = null;
let inflight: Promise<BrandingEffective> | null = null;

/** Reads license-aware branding (app name / logo / accent). Falls back to the
 * default brand while loading or on error. */
export function useBranding(): BrandingEffective {
  const [branding, setBranding] = useState<BrandingEffective>(cache ?? DEFAULT);

  useEffect(() => {
    if (cache) {
      setBranding(cache);
      return;
    }
    if (!inflight) {
      inflight = getBranding()
        .then((b) => {
          cache = b;
          return b;
        })
        .catch(() => DEFAULT);
    }
    let active = true;
    inflight.then((b) => {
      if (active) setBranding(b);
    });
    return () => {
      active = false;
    };
  }, []);

  return branding;
}
