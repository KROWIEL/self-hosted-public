'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CreatePreviewInput,
  PreviewEnv,
  Project,
  createPreview,
  deletePreview,
  getService,
  listPreviews,
  listProjects,
  redeployPreview,
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
import { useErrorText, useI18n, useStatusLabel } from '@/i18n';

export default function PreviewsPage() {
  return (
    <AppShell>
      <PreviewsContent />
    </AppShell>
  );
}

function branchSlug(branch: string): string {
  return (
    branch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'preview'
  );
}

function PreviewsContent() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const statusLabel = useStatusLabel();
  const { has } = useEntitlements();
  const unlocked = has('preview-envs');

  const [previews, setPreviews] = useState<PreviewEnv[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create form state.
  const [serviceId, setServiceId] = useState('');
  const [branch, setBranch] = useState('');
  const [host, setHost] = useState('');
  const [ttlHours, setTtlHours] = useState('72');
  const [parentDomain, setParentDomain] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const rows = await listPreviews();
      setPreviews(rows);
    } catch (e) {
      setError(errorText(e));
      setPreviews([]);
    }
  }

  useEffect(() => {
    if (!unlocked) return;
    reload();
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  // When a parent service is chosen, look up its domain to suggest a host.
  useEffect(() => {
    if (!serviceId) {
      setParentDomain(null);
      return;
    }
    getService(serviceId)
      .then((s) => setParentDomain(s.domain?.host ?? null))
      .catch(() => setParentDomain(null));
  }, [serviceId]);

  const services = useMemo(
    () =>
      projects.flatMap((p) =>
        p.services.map((s) => ({
          id: s.id,
          label: `${p.name} / ${s.name}`,
        })),
      ),
    [projects],
  );

  const suggestedHost =
    parentDomain && branch ? `${branchSlug(branch)}.${parentDomain}` : '';

  async function onCreate() {
    if (!serviceId || !branch.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body: CreatePreviewInput = {
        branch: branch.trim(),
        ttlHours: Number(ttlHours) || 0,
      };
      const finalHost = host.trim() || suggestedHost;
      if (finalHost) body.host = finalHost;
      await createPreview(serviceId, body);
      setBranch('');
      setHost('');
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRedeploy(id: string) {
    setError(null);
    try {
      await redeployPreview(id);
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm(t('previews.confirmDelete'))) return;
    setError(null);
    try {
      await deletePreview(id);
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (!unlocked) {
    return (
      <>
        <PageHeader
          title={t('previews.title')}
          subtitle={t('previews.subtitle')}
        />
        <UpgradeNotice
          tier="pro"
          featureTitle={t('previews.lockedTitle')}
          featureBody={t('previews.lockedBody')}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('previews.title')}
        subtitle={t('previews.subtitle')}
      />

      <GuideCard
        storageKey="previews"
        title={t('previews.aboutTitle')}
        body={t('previews.aboutBody')}
      />

      {error && <ErrorBox message={error} />}

      <Card className="mb-6">
        <h2 className="mb-4 text-sm font-semibold text-white">
          {t('previews.newTitle')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('previews.service')}>
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="field w-full"
            >
              <option value="">{t('previews.servicePlaceholder')}</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('previews.branch')}>
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="feature/login"
              className="field w-full"
            />
          </Field>
          <Field label={t('previews.host')} hint={t('previews.hostHint')}>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder={suggestedHost || 'preview.example.com'}
              className="field w-full"
            />
          </Field>
          <Field label={t('previews.ttl')} hint={t('previews.ttlHint')}>
            <input
              type="number"
              min={0}
              value={ttlHours}
              onChange={(e) => setTtlHours(e.target.value)}
              className="field w-full"
            />
          </Field>
        </div>
        <div className="mt-4">
          <button
            onClick={onCreate}
            disabled={busy || !serviceId || !branch.trim()}
            className="btn-primary"
          >
            {busy ? t('previews.creating') : t('previews.create')}
          </button>
        </div>
      </Card>

      {previews === null ? (
        <Spinner label={t('common.loading')} />
      ) : previews.length === 0 ? (
        <EmptyState>{t('previews.empty')}</EmptyState>
      ) : (
        <div className="space-y-3">
          {previews.map((p) => (
            <PreviewRow
              key={p.id}
              preview={p}
              statusLabel={statusLabel}
              onRedeploy={() => onRedeploy(p.id)}
              onDelete={() => onDelete(p.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function PreviewRow({
  preview: p,
  statusLabel,
  onRedeploy,
  onDelete,
}: {
  preview: PreviewEnv;
  statusLabel: (s: string) => string;
  onRedeploy: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const status = p.serviceStatus ?? 'CREATED';
  const pill =
    status === 'RUNNING'
      ? 'bg-emerald-500/15 text-emerald-300'
      : status === 'ERROR'
        ? 'bg-red-500/15 text-red-300'
        : status === 'BUILDING'
          ? 'bg-amber-500/15 text-amber-300'
          : 'bg-white/10 text-neutral-300';

  const url = p.host ? `${p.https ? 'https' : 'http'}://${p.host}` : null;
  const expires = p.expiresAt ? new Date(p.expiresAt) : null;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs ${pill}`}>
              {statusLabel(status)}
            </span>
            <span className="truncate text-sm font-medium text-white">
              {p.parentName ?? '—'}
            </span>
            <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-neutral-300">
              {p.branch}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-300 hover:text-indigo-200"
              >
                {p.host}
              </a>
            ) : (
              <span>{t('previews.internalOnly')}</span>
            )}
            {p.pr && (
              <span>
                {t('previews.pr')}{' '}
                {p.pr.url ? (
                  <a
                    href={p.pr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-300 hover:text-indigo-200"
                  >
                    {p.pr.repo}#{p.pr.number}
                  </a>
                ) : (
                  <span className="text-neutral-300">
                    {p.pr.repo}#{p.pr.number}
                  </span>
                )}
              </span>
            )}
            <span>
              {t('previews.expires')}:{' '}
              {expires ? expires.toLocaleString() : t('previews.never')}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/services/${p.serviceId}`}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:bg-white/5"
          >
            {t('previews.open')}
          </Link>
          <button
            onClick={onRedeploy}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:bg-white/5"
          >
            {t('previews.redeploy')}
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-500/10"
          >
            {t('previews.delete')}
          </button>
        </div>
      </div>
    </Card>
  );
}
