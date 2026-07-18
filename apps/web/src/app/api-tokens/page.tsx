'use client';

import { useEffect, useState } from 'react';
import {
  API_URL,
  ApiToken,
  ApiTokenScope,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from '@/lib/api';
import { AppShell } from '@/components/shell';
import { useEntitlements } from '@/components/entitlements';
import { UpgradeNotice } from '@/components/upgrade-notice';
import {
  Card,
  EmptyState,
  ErrorBox,
  Field,
  GuideCard,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { useErrorText, useI18n, type TKey } from '@/i18n';

const SCOPE_OPTIONS: {
  id: ApiTokenScope;
  label: TKey;
  hint: TKey;
}[] = [
  {
    id: 'read',
    label: 'apiTokens.scopeRead',
    hint: 'apiTokens.scopeReadHint',
  },
  {
    id: 'full',
    label: 'apiTokens.scopeFull',
    hint: 'apiTokens.scopeFullHint',
  },
  {
    id: 'admin',
    label: 'apiTokens.scopeAdmin',
    hint: 'apiTokens.scopeAdminHint',
  },
];

export default function ApiTokensPage() {
  return (
    <AppShell>
      <ApiTokensContent />
    </AppShell>
  );
}

function ApiTokensContent() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { has } = useEntitlements();
  const unlocked = has('api-cli');

  const [rows, setRows] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  // Least privilege by default: read-only until the user opts into more.
  const [scopes, setScopes] = useState<ApiTokenScope[]>(['read']);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      setRows(await listApiTokens());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!unlocked) {
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  function toggleScope(scope: ApiTokenScope) {
    setScopes((prev): ApiTokenScope[] => {
      if (scope === 'read') {
        // Selecting read clears write/admin — least privilege.
        return ['read'];
      }
      if (scope === 'full') {
        const next: ApiTokenScope[] = prev.includes('full')
          ? prev.filter((s) => s !== 'full')
          : [...prev.filter((s) => s !== 'read'), 'full'];
        return next.length === 0 ? ['read'] : next;
      }
      // admin
      if (prev.includes('admin')) {
        const next = prev.filter((s) => s !== 'admin');
        return next.length === 0 ? ['read'] : next;
      }
      // Promote from read to full when enabling admin so the token isn't
      // admin-only without write capability.
      const base: ApiTokenScope[] = prev.includes('full') ? prev : ['full'];
      return [...base.filter((s) => s !== 'read'), 'admin'];
    });
  }

  async function onCreate() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    setFresh(null);
    try {
      const days = expiry.trim() ? Number(expiry.trim()) : undefined;
      const res = await createApiToken({
        name: name.trim(),
        expiresInDays: days && days > 0 ? days : undefined,
        scopes,
      });
      setFresh(res.token);
      setCopied(false);
      setName('');
      setExpiry('');
      setScopes(['read']);
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: string) {
    if (!confirm(t('apiTokens.confirmRevoke'))) return;
    try {
      await revokeApiToken(id);
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function copyFresh() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
    } catch {
      /* clipboard may be unavailable */
    }
  }

  if (!unlocked) {
    return (
      <>
        <PageHeader
          title={t('apiTokens.title')}
          subtitle={t('apiTokens.subtitle')}
        />
        <UpgradeNotice
          tier="pro"
          featureTitle={t('apiTokens.lockedTitle')}
          featureBody={t('apiTokens.lockedBody')}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('apiTokens.title')}
        subtitle={t('apiTokens.subtitle')}
      />

      <GuideCard
        storageKey="api-tokens"
        title={t('apiTokens.aboutTitle')}
        body={t('apiTokens.aboutBody')}
      />

      {error && <ErrorBox message={error} />}

      {fresh && (
        <Card className="mb-6 border-amber-500/30 bg-amber-500/5">
          <h3 className="text-sm font-semibold text-amber-200">
            {t('apiTokens.freshTitle')}
          </h3>
          <p className="mt-1 text-sm text-neutral-300">
            {t('apiTokens.freshHint')}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-ink-950/60 px-3 py-2 font-mono text-sm text-emerald-200">
              {fresh}
            </code>
            <button onClick={copyFresh} className="btn-ghost text-xs">
              {copied ? t('apiTokens.copied') : t('apiTokens.copy')}
            </button>
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-white">
          {t('apiTokens.createTitle')}
        </h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <Field label={t('apiTokens.name')}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('apiTokens.namePlaceholder')}
              className="field w-full"
            />
          </Field>
          <Field label={t('apiTokens.expiry')}>
            <input
              type="number"
              min={1}
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              placeholder={t('apiTokens.expiryPlaceholder')}
              className="field w-full"
            />
          </Field>
          <button
            onClick={onCreate}
            disabled={busy || !name.trim()}
            className="btn-primary"
          >
            {t('apiTokens.create')}
          </button>
        </div>
        <div className="mt-4">
          <p className="text-xs font-medium text-neutral-400">
            {t('apiTokens.scopes')}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {t('apiTokens.scopesHint')}
          </p>
          <ul className="mt-3 space-y-2">
            {SCOPE_OPTIONS.map((opt) => {
              const checked = scopes.includes(opt.id);
              return (
                <li key={opt.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/5 bg-ink-950/40 px-3 py-2.5 hover:border-white/10">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() => toggleScope(opt.id)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-white">
                        {t(opt.label)}
                      </span>
                      <span className="block text-xs text-neutral-500">
                        {t(opt.hint)}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>

      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-white">
          {t('apiTokens.usageTitle')}
        </h3>
        <p className="mt-1 text-sm text-neutral-400">
          {t('apiTokens.usageHint')}
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-ink-950/60 px-3 py-2 font-mono text-xs text-neutral-300">
          {`curl -H "Authorization: Bearer <token>" \\\n  ${API_URL}/projects`}
        </pre>
      </Card>

      <h3 className="mb-3 mt-8 text-lg font-semibold text-white">
        {t('apiTokens.listTitle')}
      </h3>
      {loading && <Spinner />}
      {!loading && rows.length === 0 && (
        <EmptyState>{t('apiTokens.empty')}</EmptyState>
      )}
      {!loading && rows.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-white/5">
            {rows.map((tk) => (
              <li
                key={tk.id}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-white">{tk.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {(tk.scopes?.length
                      ? tk.scopes
                      : (['full'] as ApiTokenScope[])
                    ).map((s) => (
                      <span
                        key={s}
                        className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-neutral-300"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 font-mono text-xs text-neutral-500">
                    {tk.preview} · {t('apiTokens.created')}{' '}
                    {new Date(tk.createdAt).toLocaleDateString()}
                    {tk.lastUsedAt
                      ? ` · ${t('apiTokens.lastUsed')} ${new Date(
                          tk.lastUsedAt,
                        ).toLocaleDateString()}`
                      : ` · ${t('apiTokens.neverUsed')}`}
                    {tk.expiresAt
                      ? ` · ${t('apiTokens.expires')} ${new Date(
                          tk.expiresAt,
                        ).toLocaleDateString()}`
                      : ''}
                  </div>
                </div>
                <button
                  onClick={() => onRevoke(tk.id)}
                  className="btn-ghost text-xs text-rose-300"
                >
                  {t('apiTokens.revoke')}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
