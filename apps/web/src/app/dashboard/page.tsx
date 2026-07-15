'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Node,
  Project,
  createProject,
  deleteProject,
  getPlatformResourceSummary,
  listNodes,
  listProjects,
  PlatformResourceSummary,
} from '@/lib/api';
import { AppShell } from '@/components/shell';
import {
  Card,
  EmptyState,
  ErrorBox,
  Field,
  GuideCard,
  Modal,
  PageHeader,
  ResourceMeter,
  ResourceSlider,
  Spinner,
  StatusText,
  formatCpu,
  useConfirmDialog,
} from '@/components/ui';
import { useErrorText, useI18n, useTypeLabel } from '@/i18n';

export default function DashboardPage() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const typeLabel = useTypeLabel();
  const { confirm, dialog } = useConfirmDialog();
  const [projects, setProjects] = useState<Project[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [platform, setPlatform] = useState<PlatformResourceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      listProjects(),
      listNodes().catch(() => [] as Node[]),
      getPlatformResourceSummary().catch(() => null),
    ])
      .then(([p, n, summary]) => {
        setProjects(p);
        setNodes(n);
        setPlatform(summary);
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  // Live-refresh platform consumption every 4s.
  useEffect(() => {
    const timer = setInterval(() => {
      getPlatformResourceSummary()
        .then(setPlatform)
        .catch(() => {
          /* ignore polling errors */
        });
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  async function onDelete(id: string) {
    if (
      !(await confirm({
        title: t('common.delete'),
        message: t('projects.confirmDelete'),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    ) {
      return;
    }
    try {
      await deleteProject(id);
      load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <AppShell>
      <PageHeader
        title={t('projects.title')}
        subtitle={t('projects.subtitle')}
        action={
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            {t('projects.create')}
          </button>
        }
      />

      <GuideCard
        storageKey="projects"
        title={t('projects.aboutTitle')}
        body={t('projects.aboutBody')}
        steps={[
          { title: t('projects.step1Title'), body: t('projects.step1Body') },
          { title: t('projects.step2Title'), body: t('projects.step2Body') },
          { title: t('projects.step3Title'), body: t('projects.step3Body') },
        ]}
      />

      <DashboardResourceStrip summary={platform} />

      {error && <ErrorBox message={error} />}
      {loading && <Spinner />}

      {!loading && projects.length === 0 && (
        <EmptyState>{t('projects.empty')}</EmptyState>
      )}

      <ul className="grid gap-4 md:grid-cols-2">
        {projects.map((p) => (
          <Card key={p.id} hover>
            <div className="mb-4 flex items-start justify-between gap-3">
              <Link
                href={`/projects/${p.id}`}
                className="text-lg font-semibold text-white transition-colors hover:text-indigo-300"
              >
                {p.name}
              </Link>
              <button onClick={() => onDelete(p.id)} className="btn-danger-ghost">
                {t('common.delete')}
              </button>
            </div>
            {p.services.length === 0 ? (
              <p className="text-sm text-neutral-500">{t('projects.noServices')}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {p.services.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                  >
                    <Link
                      href={`/services/${s.id}`}
                      className="text-neutral-300 transition-colors hover:text-indigo-300"
                    >
                      {s.name}{' '}
                      <span className="text-neutral-600">({typeLabel(s.type)})</span>
                    </Link>
                    <StatusText status={s.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </ul>
      {createOpen && (
        <CreateProjectModal
          summary={platform}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            load();
          }}
        />
      )}
      {dialog}
    </AppShell>
  );
}

function CreateProjectModal({
  summary,
  onClose,
  onCreated,
}: {
  summary: PlatformResourceSummary | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [name, setName] = useState('');
  const maxCpu = Math.max(100, summary?.availableProjectCpu ?? 100);
  const maxMem = Math.max(512, summary?.availableProjectMemMb ?? 512);
  const recommendedCpu = Math.min(maxCpu, 100);
  const recommendedMem = Math.min(maxMem, 512);
  const [cpuLimit, setCpuLimit] = useState(maxCpu);
  const [memLimit, setMemLimit] = useState(maxMem);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setErr(null);
    try {
      await createProject({ name: name.trim(), cpuLimit, memLimit });
      onCreated();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      title={t('projects.create')}
      description={t('resources.projectLimitHint')}
      onClose={onClose}
    >
      {err && <ErrorBox message={err} />}
      <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2">
        <Field label={t('projects.nameLabel')} className="sm:col-span-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('projects.newPlaceholder')}
            required
            className="field w-full"
          />
        </Field>
        <ResourceSlider
          label={t('resources.cpuLimit')}
          value={cpuLimit}
          min={10}
          max={maxCpu}
          step={10}
          onChange={setCpuLimit}
          formatValue={formatCpu}
          recommendedValue={recommendedCpu}
          recommendedLabel={t('resources.recommended')}
        />
        <ResourceSlider
          label={t('resources.memLimit')}
          value={memLimit}
          min={128}
          max={maxMem}
          step={128}
          onChange={setMemLimit}
          formatValue={(v) => `${v} MB`}
          recommendedValue={recommendedMem}
          recommendedLabel={t('resources.recommended')}
        />
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={creating} className="btn-primary">
            {creating ? t('common.creating') : t('common.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DashboardResourceStrip({
  summary,
}: {
  summary: PlatformResourceSummary | null;
}) {
  const { t } = useI18n();
  if (!summary) return null;

  return (
    <Card className="mb-8 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            {t('resources.platformCapacity')}
          </h2>
          <p className="text-xs text-neutral-500">
            {summary.projects} {t('projects.title')} · {summary.services}{' '}
            {t('resources.services')} · {summary.nodes} {t('nodes.title')}
            {' · '}
            {t('resources.detectedHardware')}: {summary.hostCpuCores} cores /{' '}
            {summary.hostMemMb} MB
          </p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ResourceMeter
          label={t('resources.cpu')}
          used={summary.projectCpuLimit}
          limit={summary.capacityCpu}
          unit=""
          formatValue={formatCpu}
          inUse={formatCpu(summary.currentCpuPerc)}
          inUseValue={summary.currentCpuPerc}
          hint={`${t('resources.available')}: ${formatCpu(summary.availableProjectCpu)}`}
        />
        <ResourceMeter
          label={t('resources.memory')}
          used={summary.projectMemLimit}
          limit={summary.capacityMemMb}
          unit="MB"
          inUse={`${Math.round(summary.currentMemMb)} MB`}
          inUseValue={summary.currentMemMb}
          hint={`${t('resources.available')}: ${summary.availableProjectMemMb} MB`}
        />
      </div>
    </Card>
  );
}
