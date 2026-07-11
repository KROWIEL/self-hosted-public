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
import {
  Entitlements,
  FREE_ENTITLEMENTS,
  LicenseModule,
  getLicense,
} from '@/lib/api';

interface EntitlementsContextValue {
  entitlements: Entitlements;
  loading: boolean;
  /** Re-fetch entitlements from the server (call after activating a license). */
  refresh: () => Promise<void>;
  /** Is a given add-on module unlocked by the current license? */
  has: (module: LicenseModule) => boolean;
}

const EntitlementsContext = createContext<EntitlementsContextValue | null>(null);

/**
 * Loads the installation's effective entitlements once and shares them with the
 * app chrome and pages so UI can unlock, hide or gate features by license tier.
 */
export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const [entitlements, setEntitlements] =
    useState<Entitlements>(FREE_ENTITLEMENTS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setEntitlements(await getLicense());
    } catch {
      setEntitlements(FREE_ENTITLEMENTS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const has = useCallback(
    (module: LicenseModule) => entitlements.modules.includes(module),
    [entitlements],
  );

  const value = useMemo(
    () => ({ entitlements, loading, refresh, has }),
    [entitlements, loading, refresh, has],
  );

  return (
    <EntitlementsContext.Provider value={value}>
      {children}
    </EntitlementsContext.Provider>
  );
}

export function useEntitlements(): EntitlementsContextValue {
  const ctx = useContext(EntitlementsContext);
  if (!ctx) {
    throw new Error(
      'useEntitlements must be used within an EntitlementsProvider',
    );
  }
  return ctx;
}
