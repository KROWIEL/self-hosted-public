'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  getMustChangePassword,
  isAuthed,
  logout,
  type LicenseModule,
} from '@/lib/api';
import { TKey, useI18n } from '@/i18n';
import { LangSwitcher } from '@/components/lang-switcher';
import {
  EntitlementsProvider,
  useEntitlements,
} from '@/components/entitlements';
import { useBranding, safeLogoUrl } from '@/components/branding';

type IconProps = { className?: string };

const Icon = {
  projects: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  ),
  nodes: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </Svg>
  ),
  tunnels: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </Svg>
  ),
  templates: (p: IconProps) => (
    <Svg {...p}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </Svg>
  ),
  git: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="7" cy="17" r="2.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M7 9.5v5M17 11.5c0 3-4 2.5-7 3" />
    </Svg>
  ),
  settings: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </Svg>
  ),
  logout: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </Svg>
  ),
  menu: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Svg>
  ),
  close: (p: IconProps) => (
    <Svg {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  ),
  chevronLeft: (p: IconProps) => (
    <Svg {...p}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  ),
  billing: (p: IconProps) => (
    <Svg {...p}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 9.5h19M6 15h4" />
    </Svg>
  ),
  audit: (p: IconProps) => (
    <Svg {...p}>
      <path d="M8 3h8a2 2 0 0 1 2 2v15l-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2Z" />
      <path d="M9 8h6M9 12h5" />
    </Svg>
  ),
  alerts: (p: IconProps) => (
    <Svg {...p}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </Svg>
  ),
  offsite: (p: IconProps) => (
    <Svg {...p}>
      <path d="M7 18a4 4 0 0 1-.8-7.9 5.5 5.5 0 0 1 10.6-1.6A4.5 4.5 0 0 1 17 18" />
      <path d="M12 13v6M9.5 15.5 12 13l2.5 2.5" />
    </Svg>
  ),
  key: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.5 12.5 8-8M17 4l3 3M15 6l2 2" />
    </Svg>
  ),
  brush: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 21c2 0 3-1 3-3a2 2 0 0 0-2-2c-1.5 0-3 1-3 3 0 1 .5 2 2 2Z" />
      <path d="M6.5 16.5 16 7a2.1 2.1 0 0 1 3 3l-9.5 9.5" />
    </Svg>
  ),
  metrics: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 3v18h18" />
      <path d="m7 14 3-4 3 3 4-6" />
    </Svg>
  ),
  sso: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M12 7v5l3 2" />
      <path d="M16 3h5v5" />
      <path d="m21 3-5 5" />
    </Svg>
  ),
  preview: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7M8.5 6H14a3 3 0 0 1 3 3v0" />
    </Svg>
  ),
  mail: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </Svg>
  ),
  lock: (p: IconProps) => (
    <Svg {...p}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  ),
};

function Svg({ className = '', children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

type NavItem = {
  href: string;
  label: TKey;
  icon: (p: IconProps) => ReactNode;
  /** When set, the item is a licensed module and shows a lock if not unlocked. */
  module?: LicenseModule;
};

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'nav.projects', icon: Icon.projects },
  { href: '/nodes', label: 'nav.nodes', icon: Icon.nodes },
  {
    href: '/tunnels',
    label: 'nav.tunnels',
    icon: Icon.tunnels,
    module: 'reverse-tunnels',
  },
  { href: '/templates', label: 'nav.templates', icon: Icon.templates },
  { href: '/git-credentials', label: 'nav.git', icon: Icon.git },
  {
    href: '/audit',
    label: 'nav.audit',
    icon: Icon.audit,
    module: 'audit-export',
  },
  {
    href: '/alerts',
    label: 'nav.alerts',
    icon: Icon.alerts,
    module: 'alerts',
  },
  {
    href: '/offsite',
    label: 'nav.offsite',
    icon: Icon.offsite,
    module: 'offsite-backups',
  },
  {
    href: '/api-tokens',
    label: 'nav.apiTokens',
    icon: Icon.key,
    module: 'api-cli',
  },
  {
    href: '/metrics',
    label: 'nav.metrics',
    icon: Icon.metrics,
    module: 'metrics-history',
  },
  {
    href: '/white-label',
    label: 'nav.whiteLabel',
    icon: Icon.brush,
    module: 'white-label',
  },
  {
    href: '/sso',
    label: 'nav.sso',
    icon: Icon.sso,
    module: 'sso',
  },
  {
    href: '/previews',
    label: 'nav.previews',
    icon: Icon.preview,
    module: 'preview-envs',
  },
  {
    href: '/email',
    label: 'nav.email',
    icon: Icon.mail,
    module: 'email',
  },
];

const COLLAPSE_KEY = 'sidebarCollapsed';

function Brand() {
  const brand = useBranding();
  const logo = safeLogoUrl(brand.logoUrl);
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt=""
          className="h-8 w-8 rounded-xl object-cover"
        />
      ) : (
        <span
          className="flex h-8 w-8 items-center justify-center rounded-xl shadow-glow"
          style={{
            backgroundImage:
              'linear-gradient(to bottom right, var(--accent), var(--accent-2))',
          }}
        >
          <span className="h-3 w-3 rounded-[5px] bg-white/90" />
        </span>
      )}
      <span className="text-[15px] font-semibold tracking-tight text-white">
        {brand.appName}
      </span>
    </Link>
  );
}

/**
 * Client-side auth guard + app chrome. A collapsible left sidebar that becomes
 * an off-canvas drawer on small screens and can be hidden on desktop. Redirects
 * to /login when unauthenticated, and to /settings when the account must change
 * a weak password.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isAuthed()) {
      router.replace('/login');
      return;
    }
    // Soft-force weak-password accounts to the settings page to fix it.
    if (getMustChangePassword() && pathname !== '/settings') {
      router.replace('/settings');
      return;
    }
    setReady(true);
  }, [router, pathname]);

  if (!ready) return null;

  return (
    <EntitlementsProvider>
      <AppChrome>{children}</AppChrome>
    </EntitlementsProvider>
  );
}

function AppChrome({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const { has } = useEntitlements();
  const brand = useBranding();
  const [open, setOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(false); // desktop hide

  // Hydrate the desktop collapse preference after mount.
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
  }, []);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function setCollapsedPersist(value: boolean) {
    setCollapsed(value);
    try {
      if (value) localStorage.setItem(COLLAPSE_KEY, '1');
      else localStorage.removeItem(COLLAPSE_KEY);
    } catch {
      /* ignore storage failures */
    }
  }

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
      active
        ? 'bg-white/10 text-white'
        : 'text-neutral-400 hover:bg-white/5 hover:text-white'
    }`;

  return (
    <div className="min-h-screen">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/10 bg-ink-950/60 px-4 py-3 backdrop-blur-xl md:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label={t('nav.openMenu')}
          className="rounded-lg p-1.5 text-neutral-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          <Icon.menu />
        </button>
        <Brand />
      </header>

      {/* Desktop reopen button (only while collapsed) */}
      {collapsed && (
        <button
          onClick={() => setCollapsedPersist(false)}
          aria-label={t('nav.expand')}
          className="fixed left-3 top-3 z-30 hidden rounded-lg border border-white/10 bg-ink-950/70 p-2 text-neutral-300 backdrop-blur-xl transition-colors hover:text-white md:inline-flex"
        >
          <Icon.menu />
        </button>
      )}

      {/* Drawer overlay (mobile only) */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-white/10 bg-ink-950/85 backdrop-blur-xl transition-transform duration-300 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'md:-translate-x-full' : 'md:translate-x-0'}`}
      >
        <div className="flex items-center justify-between px-5 py-4">
          <Brand />
          <button
            onClick={() => setCollapsedPersist(true)}
            aria-label={t('nav.collapse')}
            className="hidden rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-white/5 hover:text-white md:inline-flex"
          >
            <Icon.chevronLeft />
          </button>
          <button
            onClick={() => setOpen(false)}
            aria-label={t('nav.closeMenu')}
            className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-white/5 hover:text-white md:hidden"
          >
            <Icon.close />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {NAV.map((item) => {
            const active = pathname?.startsWith(item.href) ?? false;
            const ItemIcon = item.icon;
            const locked = item.module ? !has(item.module) : false;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={linkClass(active)}
              >
                <ItemIcon className="shrink-0" />
                <span className="flex-1">{t(item.label)}</span>
                {locked && (
                  <Icon.lock
                    className="shrink-0 text-amber-400/70"
                    aria-label={t('nav.locked')}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Language switch sits just above the divider */}
        <div className="px-3 pb-3 pt-2">
          <LangSwitcher />
        </div>

        <div className="space-y-1 border-t border-white/10 px-3 py-3">
          <Link
            href="/billing"
            className={linkClass(pathname?.startsWith('/billing') ?? false)}
          >
            <Icon.billing className="shrink-0" />
            <span>{t('nav.billing')}</span>
          </Link>
          <Link
            href="/settings"
            className={linkClass(pathname?.startsWith('/settings') ?? false)}
          >
            <Icon.settings className="shrink-0" />
            <span>{t('nav.settings')}</span>
          </Link>
          <button
            onClick={() => {
              logout();
              router.replace('/login');
            }}
            className={`${linkClass(false)} w-full`}
          >
            <Icon.logout className="shrink-0" />
            <span>{t('common.signOut')}</span>
          </button>
          {brand.showPoweredBy && (
            <p className="px-3 pt-1 text-center text-[11px] text-neutral-600">
              {t('brand.poweredBy')}
            </p>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className={collapsed ? 'md:pl-0' : 'md:pl-64'}>
        <main className="mx-auto max-w-6xl animate-fade-up p-6 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
