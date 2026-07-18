'use client';

import { useEffect, useState } from 'react';
import {
  AuthMe,
  Invite,
  createInvite,
  getMe,
  listInvites,
  revokeInvite,
} from '@/lib/api';
import { AppShell } from '@/components/shell';
import {
  Card,
  EmptyState,
  ErrorBox,
  Field,
  GuideCard,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { useErrorText, useI18n } from '@/i18n';

export default function InvitesPage() {
  return (
    <AppShell>
      <InvitesContent />
    </AppShell>
  );
}

function InvitesContent() {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [me, setMe] = useState<AuthMe | null>(null);
  const [rows, setRows] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'USER' | 'ADMIN'>('USER');
  const [expiry, setExpiry] = useState('7');
  const [fresh, setFresh] = useState<{ token: string; url?: string } | null>(
    null,
  );
  const [copied, setCopied] = useState<'token' | 'url' | null>(null);

  const isAdmin = me?.role === 'ADMIN';

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  async function reload() {
    setLoading(true);
    try {
      setRows(await listInvites());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function onCreate() {
    setBusy(true);
    setError(null);
    setFresh(null);
    try {
      const days = Number(expiry.trim());
      const res = await createInvite({
        email: email.trim() || undefined,
        role,
        expiresInDays: days > 0 ? days : undefined,
      });
      setFresh({ token: res.token, url: res.url });
      setCopied(null);
      setEmail('');
      setRole('USER');
      setExpiry('7');
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: string) {
    if (!confirm(t('invites.confirmRevoke'))) return;
    try {
      await revokeInvite(id);
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function copy(kind: 'token' | 'url', value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      /* clipboard may be unavailable */
    }
  }

  if (me && !isAdmin) {
    return (
      <>
        <PageHeader title={t('invites.title')} subtitle={t('invites.subtitle')} />
        <EmptyState>{t('invites.adminOnly')}</EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('invites.title')} subtitle={t('invites.subtitle')} />

      <GuideCard
        storageKey="invites"
        title={t('invites.aboutTitle')}
        body={t('invites.aboutBody')}
      />

      {error && <ErrorBox message={error} />}

      {fresh && (
        <Card className="mb-6 border-amber-500/30 bg-amber-500/5">
          <h3 className="text-sm font-semibold text-amber-200">
            {t('invites.freshTitle')}
          </h3>
          <p className="mt-1 text-sm text-neutral-300">
            {t('invites.freshHint')}
          </p>
          {fresh.url && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-ink-950/60 px-3 py-2 font-mono text-xs text-emerald-200">
                {fresh.url}
              </code>
              <button
                onClick={() => copy('url', fresh.url!)}
                className="btn-ghost text-xs"
              >
                {copied === 'url' ? t('invites.copied') : t('invites.copyUrl')}
              </button>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-ink-950/60 px-3 py-2 font-mono text-xs text-neutral-300">
              {fresh.token}
            </code>
            <button
              onClick={() => copy('token', fresh.token)}
              className="btn-ghost text-xs"
            >
              {copied === 'token' ? t('invites.copied') : t('invites.copyToken')}
            </button>
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-white">
          {t('invites.createTitle')}
        </h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <Field label={t('invites.email')}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('invites.emailPlaceholder')}
              className="field w-full"
            />
          </Field>
          <Field label={t('invites.role')}>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'USER' | 'ADMIN')}
              className="field w-full"
            >
              <option value="USER">{t('invites.roleUser')}</option>
              <option value="ADMIN">{t('invites.roleAdmin')}</option>
            </select>
          </Field>
          <Field label={t('invites.expiry')}>
            <input
              type="number"
              min={1}
              max={30}
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="field w-full"
            />
          </Field>
          <button
            onClick={onCreate}
            disabled={busy}
            className="btn-primary"
          >
            {busy ? t('invites.creating') : t('invites.create')}
          </button>
        </div>
      </Card>

      <h3 className="mb-3 mt-8 text-lg font-semibold text-white">
        {t('invites.listTitle')}
      </h3>
      {loading && <Spinner />}
      {!loading && rows.length === 0 && (
        <EmptyState>{t('invites.empty')}</EmptyState>
      )}
      {!loading && rows.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-white/5">
            {rows.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-white">
                    {inv.email ?? t('invites.anyEmail')}
                    <span className="ml-2 text-xs font-normal text-neutral-500">
                      {inv.role === 'ADMIN'
                        ? t('invites.roleAdmin')
                        : t('invites.roleUser')}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500">
                    {t(`invites.status.${inv.status}`)} ·{' '}
                    {t('invites.expires')}{' '}
                    {new Date(inv.expiresAt).toLocaleDateString()} ·{' '}
                    {t('invites.created')}{' '}
                    {new Date(inv.createdAt).toLocaleDateString()}
                  </div>
                </div>
                {inv.status === 'pending' && (
                  <button
                    onClick={() => onRevoke(inv.id)}
                    className="btn-ghost text-xs text-rose-300"
                  >
                    {t('invites.revoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
