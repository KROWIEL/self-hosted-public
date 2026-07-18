'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CatalogApp,
  Node,
  Project,
  installCatalogApp,
  listCatalog,
  listNodes,
  listProjects,
} from '@/lib/api';
import { AppShell } from '@/components/shell';
import {
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { useToast } from '@/components/toast';
import { TKey, useErrorText, useI18n } from '@/i18n';
import Link from 'next/link';

export default function CatalogPage() {
  const { t } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const router = useRouter();

  const [apps, setApps] = useState<(CatalogApp & { locked: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<CatalogApp | null>(null);

  useEffect(() => {
    listCatalog()
      .then(setApps)
      .catch((e) => toast.error(errText(e)))
      .finally(() => setLoading(false));
  }, [errText, toast]);

  const grouped = useMemo(() => {
    const map = new Map<string, (CatalogApp & { locked: boolean })[]>();
    for (const app of apps) {
      const cat = app.category || 'Apps';
      const list = map.get(cat) ?? [];
      list.push(app);
      map.set(cat, list);
    }
    return [...map.entries()];
  }, [apps]);

  return (
    <AppShell>
      <PageHeader title={t('catalog.title')} subtitle={t('catalog.subtitle')} />
      {loading ? (
        <Spinner />
      ) : apps.length === 0 ? (
        <EmptyState>{t('catalog.empty')}</EmptyState>
      ) : (
        <div className="space-y-8">
          {grouped.map(([category, list]) => (
            <section key={category}>
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
                {category}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((app) => (
                  <article
                    key={app.slug}
                    className="flex flex-col rounded-xl border border-white/10 bg-white/[0.02] p-4"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <h3 className="text-base font-semibold text-white">
                        {app.name}
                      </h3>
                      <span className="shrink-0 rounded-md bg-white/5 px-2 py-0.5 text-xs text-neutral-400">
                        {t(
                          `catalog.tier.${app.minTier}` as TKey,
                        )}
                      </span>
                    </div>
                    <p className="mb-3 flex-1 text-sm text-neutral-400">
                      {app.description}
                    </p>
                    <div className="mb-3 flex flex-wrap gap-2 text-xs text-neutral-500">
                      <span>
                        {t(`catalog.kind.${app.deployKind}` as TKey)}
                      </span>
                      {app.defaultPort != null && (
                        <span>:{app.defaultPort}</span>
                      )}
                    </div>
                    {app.locked ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-amber-400/90">
                          {t('catalog.upgradeHint')}
                        </span>
                        <Link href="/billing" className="btn-ghost btn-sm">
                          {t('nav.billing')}
                        </Link>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary btn-sm self-start"
                        onClick={() => setInstalling(app)}
                      >
                        {t('catalog.install')}
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {installing && (
        <InstallModal
          app={installing}
          onClose={() => setInstalling(null)}
          onInstalled={(serviceId) => {
            setInstalling(null);
            toast.success(t('catalog.installed'));
            router.push(`/services/${serviceId}`);
          }}
        />
      )}
    </AppShell>
  );
}

function InstallModal({
  app,
  onClose,
  onInstalled,
}: {
  app: CatalogApp;
  onClose: () => void;
  onInstalled: (serviceId: string) => void;
}) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [projects, setProjects] = useState<Project[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [projectId, setProjectId] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [name, setName] = useState(app.name);
  const [env, setEnv] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (app.envDefaults ?? [])
        .filter((e) => e.value !== undefined)
        .map((e) => [e.key, e.value!]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listProjects(), listNodes()])
      .then(([ps, ns]) => {
        setProjects(ps);
        setNodes(ns);
        setProjectId(ps[0]?.id ?? '');
        setNodeId(ns[0]?.id ?? '');
      })
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await installCatalogApp(app.slug, {
        projectId,
        nodeId,
        name: name.trim() || app.name,
        env,
      });
      onInstalled(res.service.id);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`${t('catalog.install')}: ${app.name}`}
      onClose={onClose}
    >
      {err && (
        <p className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {err}
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label={t('catalog.serviceName')}>
          <input
            className="field w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label={t('catalog.pickProject')}>
          <select
            className="field w-full"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id} className="bg-ink-850">
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('catalog.pickNode')}>
          <select
            className="field w-full"
            value={nodeId}
            onChange={(e) => setNodeId(e.target.value)}
            required
          >
            {nodes.map((n) => (
              <option key={n.id} value={n.id} className="bg-ink-850">
                {n.name} ({n.fqdn})
              </option>
            ))}
          </select>
        </Field>
        {app.envDefaults.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-neutral-300">
              {t('catalog.envTitle')}
            </p>
            {app.envDefaults.map((def) => (
              <Field
                key={def.key}
                label={
                  def.required
                    ? `${def.key} (${t('catalog.envRequired')})`
                    : def.key
                }
              >
                <input
                  className="field w-full"
                  type={def.secret ? 'password' : 'text'}
                  value={env[def.key] ?? ''}
                  onChange={(e) =>
                    setEnv({ ...env, [def.key]: e.target.value })
                  }
                  required={!!def.required}
                />
              </Field>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !projectId || !nodeId}
          >
            {busy ? t('catalog.installing') : t('catalog.install')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
