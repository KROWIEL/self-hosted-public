'use client';

import { useEffect, useState } from 'react';
import {
  AuditLog,
  AuthMe,
  exportAudit,
  getMe,
  listAudit,
} from '@/lib/api';
import { AppShell } from '@/components/shell';
import { useEntitlements } from '@/components/entitlements';
import { UpgradeNotice } from '@/components/upgrade-notice';
import {
  Card,
  EmptyState,
  ErrorBox,
  Field,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { useErrorText, useI18n } from '@/i18n';

export default function AuditPage() {
  return (
    <AppShell>
      <AuditContent />
    </AppShell>
  );
}

function AuditContent() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { has } = useEntitlements();
  const unlocked = has('audit-export');

  const [me, setMe] = useState<AuthMe | null>(null);
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ action: '', from: '', to: '' });
  const [busy, setBusy] = useState<'csv' | 'json' | null>(null);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const isAdmin = me?.role === 'ADMIN';

  useEffect(() => {
    if (!unlocked || !isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    listAudit()
      .then(setRows)
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, isAdmin]);

  async function onExport(format: 'csv' | 'json') {
    setBusy(format);
    setError(null);
    try {
      await exportAudit(format, {
        action: filters.action.trim() || undefined,
        from: filters.from
          ? new Date(`${filters.from}T00:00:00`).toISOString()
          : undefined,
        to: filters.to
          ? new Date(`${filters.to}T23:59:59`).toISOString()
          : undefined,
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (!unlocked) {
    return (
      <>
        <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />
        <UpgradeNotice
          tier="pro"
          featureTitle={t('audit.lockedTitle')}
          featureBody={t('audit.lockedBody')}
        />
      </>
    );
  }

  if (me && !isAdmin) {
    return (
      <>
        <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />
        <EmptyState>{t('audit.adminOnly')}</EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />

      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-white">
          {t('audit.exportTitle')}
        </h3>
        <p className="mt-1 text-sm text-neutral-400">{t('audit.exportHint')}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label={t('audit.filterAction')}>
            <input
              value={filters.action}
              onChange={(e) =>
                setFilters({ ...filters, action: e.target.value })
              }
              placeholder={t('audit.filterActionPlaceholder')}
              className="field w-full"
            />
          </Field>
          <Field label={t('audit.filterFrom')}>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className="field w-full"
            />
          </Field>
          <Field label={t('audit.filterTo')}>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className="field w-full"
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => onExport('csv')}
            disabled={busy !== null}
            className="btn-primary"
          >
            {busy === 'csv' ? t('audit.exporting') : t('audit.exportCsv')}
          </button>
          <button
            onClick={() => onExport('json')}
            disabled={busy !== null}
            className="btn-ghost"
          >
            {busy === 'json' ? t('audit.exporting') : t('audit.exportJson')}
          </button>
        </div>
      </Card>

      {error && <ErrorBox message={error} />}

      <h3 className="mb-3 mt-8 text-lg font-semibold text-white">
        {t('audit.recentTitle')}
      </h3>

      {loading && <Spinner />}
      {!loading && rows.length === 0 && (
        <EmptyState>{t('audit.empty')}</EmptyState>
      )}
      {!loading && rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2 font-medium">{t('audit.colTime')}</th>
                  <th className="px-3 py-2 font-medium">{t('audit.colUser')}</th>
                  <th className="px-3 py-2 font-medium">
                    {t('audit.colAction')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('audit.colTarget')}
                  </th>
                  <th className="px-3 py-2 font-medium">{t('audit.colIp')}</th>
                  <th className="px-3 py-2 font-medium">
                    {t('audit.colStatus')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-white/5 text-neutral-300"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-400">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{r.userEmail ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-indigo-200">
                      {r.action}
                    </td>
                    <td className="px-3 py-2 text-neutral-400">
                      {r.targetType}
                      {r.targetId ? ` · ${r.targetId.slice(0, 8)}` : ''}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-neutral-500">
                      {r.ip ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          r.status && r.status >= 400
                            ? 'text-rose-300'
                            : 'text-emerald-300'
                        }
                      >
                        {r.status ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
