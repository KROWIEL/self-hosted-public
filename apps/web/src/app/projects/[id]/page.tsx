'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AuditLog,
  CreateDatabaseBody,
  CreateServiceBody,
  DbCredentials,
  GitCredential,
  ManagedDatabase,
  Member,
  MemberRole,
  Node,
  Project,
  ProjectResourceSummary,
  Service,
  Template,
  addMember,
  attachDatabase,
  createDatabase,
  createService,
  databaseCredentials,
  deleteDatabase,
  getProject,
  getProjectResourceSummary,
  listDatabases,
  listGitCredentials,
  listMembers,
  listNodes,
  listProjectAudit,
  listTemplates,
  powerDatabase,
  removeMember,
  updateMember,
  updateProjectLimits,
} from '@/lib/api';
import { AppShell } from '@/components/shell';
import { BackupsPanel } from '@/components/backups-panel';
import {
  Card,
  EmptyState,
  ErrorBox,
  Field,
  GuideCard,
  Modal,
  PanelCard,
  ResourceMeter,
  ResourceSlider,
  Spinner,
  StatusText,
  statusTone,
  formatCpu,
  useConfirmDialog,
} from '@/components/ui';
import { useToast } from '@/components/toast';
import { useErrorText, useI18n, useTypeLabel } from '@/i18n';

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { t } = useI18n();
  const errorText = useErrorText();
  const typeLabel = useTypeLabel();

  const [project, setProject] = useState<Project | null>(null);
  const [resources, setResources] = useState<ProjectResourceSummary | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [creds, setCreds] = useState<GitCredential[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createServiceOpen, setCreateServiceOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      getProject(id),
      listNodes(),
      listTemplates(),
      listGitCredentials(),
      getProjectResourceSummary(id).catch(() => null),
    ])
      .then(([p, n, t, c, r]) => {
        setProject(p);
        setNodes(n);
        setTemplates(t);
        setCreds(c);
        setResources(r);
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  // Live-refresh the resource summary (real consumption) every 4s.
  useEffect(() => {
    const timer = setInterval(() => {
      getProjectResourceSummary(id)
        .then(setResources)
        .catch(() => {
          /* ignore polling errors */
        });
    }, 4000);
    return () => clearInterval(timer);
  }, [id]);

  return (
    <AppShell>
      <Link
        href="/dashboard"
        className="text-sm text-neutral-400 transition-colors hover:text-white"
      >
        {t('project.back')}
      </Link>

      {loading && <div className="mt-4"><Spinner /></div>}
      {error && <div className="mt-4"><ErrorBox message={error} /></div>}

      {project && (
        <>
          <h1 className="mb-6 mt-3 text-2xl font-bold tracking-tight text-white">
            {project.name}
          </h1>

          <GuideCard
            storageKey="project"
            title={t('project.aboutTitle')}
            body={t('project.aboutBody')}
            steps={[
              { title: t('project.step1Title'), body: t('project.step1Body') },
              { title: t('project.step2Title'), body: t('project.step2Body') },
              { title: t('project.step3Title'), body: t('project.step3Body') },
            ]}
          />

          <ProjectResourceStrip
            resources={resources}
            onConfigure={() => setLimitsOpen(true)}
          />

          <PanelCard
            title={t('project.services')}
            action={
              <button
                onClick={() => setCreateServiceOpen(true)}
                disabled={nodes.length === 0}
                className="btn-primary btn-sm"
              >
                {t('project.createService')}
              </button>
            }
            className="mb-8"
          >
            {nodes.length === 0 && (
              <p className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3 text-sm text-amber-300">
                {t('project.registerNodeFirst')}
              </p>
            )}
            {project.services.length === 0 ? (
              <EmptyState>
                {t('project.noServices')}{' '}
                <button
                  onClick={() => setCreateServiceOpen(true)}
                  disabled={nodes.length === 0}
                  className="text-indigo-300 hover:text-indigo-200"
                >
                  {t('project.createService')}
                </button>
              </EmptyState>
            ) : (
              <ul className="space-y-2">
                {project.services.map((s) => (
                  <Card
                    key={s.id}
                    hover
                    className="p-4"
                    accentTone={statusTone(s.status)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/services/${s.id}`}
                        className="min-w-0 transition-colors hover:text-indigo-300"
                      >
                        <span className="font-medium text-white">{s.name}</span>{' '}
                        <span className="text-sm text-neutral-500">
                          {typeLabel(s.type)} · {s.deployKind ?? 'git'}
                          {s.repoUrl ? ` · ${s.repoUrl}` : s.image ? ` · ${s.image}` : ''}
                        </span>
                        <span className="mt-1 block font-mono text-xs text-neutral-600">
                          {formatCpu(s.cpuLimit)} CPU · {s.memLimit} MB RAM
                        </span>
                      </Link>
                      <StatusText status={s.status} />
                    </div>
                  </Card>
                ))}
              </ul>
            )}
          </PanelCard>

          <DatabasesSection
            projectId={id}
            nodes={nodes}
            services={project.services}
          />

          <MembersPanel projectId={id} myRole={project.myRole ?? null} />

          <AuditPanel projectId={id} canView={canManage(project.myRole)} />

          {createServiceOpen && (
            <CreateServiceModal
              projectId={id}
              nodes={nodes}
              templates={templates}
              creds={creds}
              resources={resources}
              onClose={() => setCreateServiceOpen(false)}
              onCreated={() => {
                setCreateServiceOpen(false);
                load();
              }}
            />
          )}

          {limitsOpen && (
            <ProjectLimitsModal
              project={project}
              resources={resources}
              onClose={() => setLimitsOpen(false)}
              onSaved={() => {
                setLimitsOpen(false);
                load();
              }}
            />
          )}
        </>
      )}
    </AppShell>
  );
}

function CreateServiceModal({
  projectId,
  nodes,
  templates,
  creds,
  resources,
  onClose,
  onCreated,
}: {
  projectId: string;
  nodes: Node[];
  templates: Template[];
  creds: GitCredential[];
  resources: ProjectResourceSummary | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const firstTemplate = templates[0];
  const maxCpu = Math.max(10, resources?.availableCpu ?? 100);
  const maxMem = Math.max(128, resources?.availableMemMb ?? 512);
  const recommendedCpu = Math.min(maxCpu, 100);
  const recommendedMem = Math.min(maxMem, 512);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<CreateServiceBody>({
    name: '',
    type: firstTemplate?.type ?? 'BACKEND',
    nodeId: nodes[0]?.id ?? '',
    deployKind: 'git',
    templateId: firstTemplate?.id ?? '',
    repoUrl: '',
    image: '',
    composeFile: 'docker-compose.yml',
    branch: 'main',
    port: firstTemplate?.defaultPort,
    cpuLimit: Math.min(100, maxCpu),
    memLimit: Math.min(512, maxMem),
    useRepoDockerfile: false,
  });

  function onTemplate(templateId: string) {
    const tpl = templates.find((t) => t.id === templateId);
    setForm((f) => ({
      ...f,
      templateId,
      type: tpl?.type ?? f.type,
      port: tpl?.defaultPort,
    }));
  }

  function onKind(deployKind: CreateServiceBody['deployKind']) {
    setForm((f) => ({
      ...f,
      deployKind,
      templateId: deployKind === 'git' ? f.templateId || firstTemplate?.id : undefined,
    }));
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      const kind = form.deployKind ?? 'git';
      await createService(projectId, {
        ...form,
        name: form.name.trim(),
        deployKind: kind,
        templateId: kind === 'git' ? form.templateId : undefined,
        repoUrl:
          kind === 'image' ? undefined : form.repoUrl?.trim() || undefined,
        image: kind === 'image' ? form.image?.trim() : undefined,
        composeFile: kind === 'compose' ? form.composeFile?.trim() : undefined,
      });
      onCreated();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setCreating(false);
    }
  }

  const kind = form.deployKind ?? 'git';

  return (
    <Modal
      title={t('project.newService')}
      description={t('project.createServiceHint')}
      onClose={onClose}
    >
      {err && <ErrorBox message={err} />}
      <form onSubmit={onCreate} className="grid items-end gap-3 sm:grid-cols-2">
        <Field label={t('project.serviceName')}>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('project.serviceName')}
            required
            className="field w-full"
          />
        </Field>
        <Field label={t('deploy.kind')}>
          <select
            value={kind}
            onChange={(e) =>
              onKind(e.target.value as CreateServiceBody['deployKind'])
            }
            className="field w-full"
          >
            <option value="git" className="bg-ink-850">
              {t('deploy.kind.git')}
            </option>
            <option value="image" className="bg-ink-850">
              {t('deploy.kind.image')}
            </option>
            <option value="compose" className="bg-ink-850">
              {t('deploy.kind.compose')}
            </option>
          </select>
        </Field>
        {kind !== 'image' && (
          <Field label={t('service.repo')}>
            <input
              value={form.repoUrl ?? ''}
              onChange={(e) => setForm({ ...form, repoUrl: e.target.value })}
              placeholder={t('project.repoPlaceholder')}
              required
              className="field w-full"
            />
          </Field>
        )}
        {kind === 'image' && (
          <Field label={t('deploy.image')}>
            <input
              value={form.image ?? ''}
              onChange={(e) => setForm({ ...form, image: e.target.value })}
              placeholder={t('deploy.imagePlaceholder')}
              required
              className="field w-full"
            />
          </Field>
        )}
        {kind === 'compose' && (
          <Field label={t('deploy.composeFile')} hint={t('deploy.composeFileHint')}>
            <input
              value={form.composeFile ?? 'docker-compose.yml'}
              onChange={(e) => setForm({ ...form, composeFile: e.target.value })}
              className="field w-full"
            />
          </Field>
        )}
        {kind === 'git' && (
          <Field label={t('field.template')}>
            <select
              value={form.templateId}
              onChange={(e) => onTemplate(e.target.value)}
              className="field w-full"
              required
            >
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id} className="bg-ink-850">
                  {tpl.name} ({tpl.type})
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('field.node')}>
          <select
            value={form.nodeId}
            onChange={(e) => setForm({ ...form, nodeId: e.target.value })}
            className="field w-full"
          >
            {nodes.map((n) => (
              <option key={n.id} value={n.id} className="bg-ink-850">
                {n.name} ({n.fqdn})
              </option>
            ))}
          </select>
        </Field>
        {kind !== 'image' && (
          <Field label={t('project.branch')}>
            <input
              value={form.branch}
              onChange={(e) => setForm({ ...form, branch: e.target.value })}
              placeholder={t('project.branch')}
              className="field w-full"
            />
          </Field>
        )}
        <Field label={t('project.port')}>
          <input
            type="number"
            value={form.port ?? ''}
            onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
            placeholder={t('project.port')}
            className="field w-full"
          />
        </Field>
        <ResourceSlider
          label={t('resources.cpuLimit')}
          value={form.cpuLimit ?? Math.min(100, maxCpu)}
          min={10}
          max={maxCpu}
          step={10}
          onChange={(value) => setForm({ ...form, cpuLimit: value })}
          formatValue={formatCpu}
          recommendedValue={recommendedCpu}
          recommendedLabel={t('resources.recommended')}
        />
        <ResourceSlider
          label={t('resources.memLimit')}
          value={form.memLimit ?? Math.min(512, maxMem)}
          min={128}
          max={maxMem}
          step={128}
          onChange={(value) => setForm({ ...form, memLimit: value })}
          formatValue={(value) => `${value} MB`}
          recommendedValue={recommendedMem}
          recommendedLabel={t('resources.recommended')}
        />
        {kind !== 'image' && (
          <Field
            label={t('project.gitCred')}
            hint={t('project.gitCredHint')}
            className="sm:col-span-2"
          >
            <select
              value={form.gitCredId ?? ''}
              onChange={(e) =>
                setForm({ ...form, gitCredId: e.target.value || undefined })
              }
              className="field w-full"
            >
              <option value="" className="bg-ink-850">
                {t('project.gitCredNone')}
              </option>
              {creds.map((c) => (
                <option key={c.id} value={c.id} className="bg-ink-850">
                  {c.name} ({c.provider})
                </option>
              ))}
            </select>
          </Field>
        )}
        {kind === 'git' && (
          <label className="flex items-start gap-2 text-sm text-neutral-300 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.useRepoDockerfile ?? false}
              onChange={(e) =>
                setForm({ ...form, useRepoDockerfile: e.target.checked })
              }
              className="mt-0.5 accent-indigo-500"
            />
            <span>
              {t('project.useRepoDockerfile')}
              <span className="mt-0.5 block text-xs text-neutral-500">
                {t('project.useRepoDockerfileHint')}
              </span>
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={
              creating ||
              nodes.length === 0 ||
              (kind === 'git' && templates.length === 0)
            }
            className="btn-primary"
          >
            {creating ? t('common.creating') : t('project.createService')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectLimitsModal({
  project,
  resources,
  onClose,
  onSaved,
}: {
  project: Project;
  resources: ProjectResourceSummary | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const maxCpu = Math.max(
    project.cpuLimit,
    project.cpuLimit + (resources?.availableCpu ?? 0),
  );
  const maxMem = Math.max(
    project.memLimit,
    project.memLimit + (resources?.availableMemMb ?? 0),
  );
  const recommendedCpu = Math.min(
    maxCpu,
    Math.max(
      resources?.allocatedCpu ?? 10,
      Math.ceil(((resources?.allocatedCpu ?? 10) * 1.15) / 10) * 10,
    ),
  );
  const recommendedMem = Math.min(
    maxMem,
    Math.max(
      resources?.allocatedMemMb ?? 128,
      Math.ceil(((resources?.allocatedMemMb ?? 128) * 1.15) / 128) * 128,
    ),
  );
  const [cpuLimit, setCpuLimit] = useState(project.cpuLimit);
  const [memLimit, setMemLimit] = useState(project.memLimit);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await updateProjectLimits(project.id, { cpuLimit, memLimit });
      onSaved();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t('resources.configureProject')}
      description={t('resources.projectLimitHint')}
      onClose={onClose}
    >
      {err && <ErrorBox message={err} />}
      {resources && (
        <p className="mb-4 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs text-neutral-400">
          {t('resources.alreadyAllocated', {
            cpu: formatCpu(resources.allocatedCpu),
            mem: resources.allocatedMemMb,
          })}
        </p>
      )}
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <ResourceSlider
          label={t('resources.cpuLimit')}
          value={cpuLimit}
          min={Math.max(10, resources?.allocatedCpu ?? 10)}
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
          min={Math.max(128, resources?.allocatedMemMb ?? 128)}
          max={maxMem}
          step={128}
          onChange={setMemLimit}
          formatValue={(value) => `${value} MB`}
          recommendedValue={recommendedMem}
          recommendedLabel={t('resources.recommended')}
        />
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectResourceStrip({
  resources,
  onConfigure,
}: {
  resources: ProjectResourceSummary | null;
  onConfigure: () => void;
}) {
  const { t } = useI18n();
  if (!resources) return null;
  return (
    <Card className="mb-8 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            {t('resources.projectResources')}
          </h2>
          <p className="text-xs text-neutral-500">
            {resources.servicesRunning}/{resources.servicesTotal}{' '}
            {t('resources.runningTotal')} · {t('resources.liveFromAgent')}
          </p>
        </div>
        <button onClick={onConfigure} className="btn-ghost btn-sm">
          {t('resources.configureProject')}
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ResourceMeter
          label={t('resources.cpu')}
          used={resources.allocatedCpu}
          limit={resources.cpuLimit}
          unit=""
          formatValue={formatCpu}
          inUse={formatCpu(resources.currentCpuPerc)}
          inUseValue={resources.currentCpuPerc}
          hint={`${t('resources.available')}: ${formatCpu(resources.availableCpu)}`}
        />
        <ResourceMeter
          label={t('resources.memory')}
          used={resources.allocatedMemMb}
          limit={resources.memLimit}
          unit="MB"
          inUse={`${Math.round(resources.currentMemMb)} MB`}
          inUseValue={resources.currentMemMb}
          hint={`${t('resources.available')}: ${resources.availableMemMb} MB`}
        />
      </div>
    </Card>
  );
}

function DatabasesSection({
  projectId,
  nodes,
  services,
}: {
  projectId: string;
  nodes: Node[];
  services: Service[];
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [dbs, setDbs] = useState<ManagedDatabase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = () =>
    listDatabases(projectId)
      .then(setDbs)
      .catch((e) => setError(errorText(e)));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <PanelCard
      title={t('db.title')}
      action={
        <button
          onClick={() => setCreateOpen(true)}
          disabled={nodes.length === 0}
          className="btn-primary btn-sm"
        >
          {t('db.create')}
        </button>
      }
      className="mb-10"
    >
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}

      {dbs.length === 0 ? (
        <EmptyState>
          {t('db.none')}{' '}
          <button
            onClick={() => setCreateOpen(true)}
            disabled={nodes.length === 0}
            className="text-indigo-300 hover:text-indigo-200"
          >
            {t('db.create')}
          </button>
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {dbs.map((db) => (
            <DatabaseCard
              key={db.id}
              db={db}
              services={services}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}

      {createOpen && (
        <CreateDatabaseModal
          projectId={projectId}
          nodes={nodes}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void refresh();
          }}
        />
      )}
    </PanelCard>
  );
}

function CreateDatabaseModal({
  projectId,
  nodes,
  onClose,
  onCreated,
}: {
  projectId: string;
  nodes: Node[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<CreateDatabaseBody>({
    name: '',
    engine: 'POSTGRES',
    nodeId: nodes[0]?.id || '',
    dbName: 'app',
    username: 'app',
  });

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      await createDatabase(projectId, { ...form, name: form.name.trim() });
      onCreated();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      title={t('db.create')}
      description={t('db.createHint')}
      onClose={onClose}
    >
      {err && <ErrorBox message={err} />}
      <form onSubmit={onCreate} className="grid items-end gap-3 sm:grid-cols-2">
        <Field label={t('db.name')}>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('db.name')}
            required
            className="field w-full"
          />
        </Field>
        <Field label={t('db.engine')}>
          <select
            value={form.engine}
            onChange={(e) =>
              setForm({
                ...form,
                engine: e.target.value as CreateDatabaseBody['engine'],
              })
            }
            className="field w-full"
          >
            <option value="POSTGRES" className="bg-ink-850">PostgreSQL</option>
            <option value="MYSQL" className="bg-ink-850">MySQL</option>
          </select>
        </Field>
        <Field label={t('db.dbName')}>
          <input
            value={form.dbName ?? ''}
            onChange={(e) => setForm({ ...form, dbName: e.target.value })}
            placeholder={t('db.dbName')}
            className="field w-full"
          />
        </Field>
        <Field label={t('db.username')}>
          <input
            value={form.username ?? ''}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder={t('db.username')}
            className="field w-full"
          />
        </Field>
        <Field label={t('db.version')}>
          <input
            value={form.version ?? ''}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
            placeholder={t('db.version')}
            className="field w-full"
          />
        </Field>
        <Field label={t('field.node')}>
          <select
            value={form.nodeId}
            onChange={(e) => setForm({ ...form, nodeId: e.target.value })}
            className="field w-full"
          >
            {nodes.map((n) => (
              <option key={n.id} value={n.id} className="bg-ink-850">
                {n.name} ({n.fqdn})
              </option>
            ))}
          </select>
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={creating || nodes.length === 0}
            className="btn-primary"
          >
            {creating ? t('db.creating') : t('db.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DatabaseCard({
  db,
  services,
  onChanged,
}: {
  db: ManagedDatabase;
  services: Service[];
  onChanged: () => Promise<unknown> | void;
}) {
  const { t } = useI18n();
  const { confirm, dialog } = useConfirmDialog();
  const [creds, setCreds] = useState<DbCredentials | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachTo, setAttachTo] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [attached, setAttached] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  const [copied, setCopied] = useState(false);

  async function toggleReveal() {
    if (revealed) {
      setRevealed(false);
      return;
    }
    if (!creds) {
      try {
        setCreds(await databaseCredentials(db.id));
      } catch {
        return;
      }
    }
    setRevealed(true);
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function onAttach() {
    if (!attachTo) return;
    if (
      !(await confirm({
        title: t('db.attach'),
        message: t('db.attachConfirm'),
        confirmLabel: t('db.attach'),
        tone: 'warning',
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await attachDatabase(db.id, attachTo);
      setAttachOpen(false);
      setAttached(true);
      setTimeout(() => setAttached(false), 1500);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  return (
    <Card className="p-4" accentTone={statusTone(db.status)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-medium text-white">{db.name}</span>{' '}
          <span className="text-sm text-neutral-500">
            {db.engine === 'POSTGRES' ? 'PostgreSQL' : 'MySQL'} {db.version}
          </span>
          <p className="mt-1 font-mono text-xs text-neutral-500">
            {db.host}:{db.port} · {db.dbName} · {db.username}
          </p>
        </div>
        <StatusText status={db.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={toggleReveal} disabled={busy} className="btn-ghost btn-sm">
          {revealed ? t('db.hide') : t('db.reveal')}
        </button>
        <button
          onClick={() => {
            void (async () => {
              if (
                !(await confirm({
                  title: t('service.start'),
                  message: t('db.startConfirm'),
                  confirmLabel: t('service.start'),
                  tone: 'warning',
                }))
              ) {
                return;
              }
              act(() => powerDatabase(db.id, 'start'));
            })();
          }}
          disabled={busy}
          className="btn-ghost btn-sm"
        >
          {t('service.start')}
        </button>
        <button
          onClick={() => {
            void (async () => {
              if (
                !(await confirm({
                  title: t('service.stop'),
                  message: t('db.stopConfirm'),
                  confirmLabel: t('service.stop'),
                  tone: 'warning',
                }))
              ) {
                return;
              }
              act(() => powerDatabase(db.id, 'stop'));
            })();
          }}
          disabled={busy}
          className="btn-ghost btn-sm"
        >
          {t('service.stop')}
        </button>
        <button
          onClick={() => setShowBackups((v) => !v)}
          className="btn-ghost btn-sm"
        >
          {t('backup.title')}
        </button>
        <button
          onClick={() => setAttachOpen(true)}
          disabled={busy || services.length === 0}
          className="btn-ghost btn-sm"
        >
          {attached ? t('db.attached') : t('db.attach')}
        </button>
        <button
          onClick={() => {
            void (async () => {
              if (
                !(await confirm({
                  title: t('service.delete'),
                  message: t('db.deleteConfirm'),
                  confirmLabel: t('service.delete'),
                  tone: 'danger',
                }))
              ) {
                return;
              }
              const keep = await confirm({
                title: t('db.keepVolumeTitle'),
                message: t('db.keepVolume'),
                confirmLabel: t('db.keepVolumeConfirm'),
                tone: 'warning',
              });
              act(() => deleteDatabase(db.id, keep));
            })();
          }}
          disabled={busy}
          className="btn-danger-ghost ml-auto"
        >
          {t('service.delete')}
        </button>
      </div>

      {showBackups && <BackupsPanel kind="DATABASE" refId={db.id} />}

      {revealed && creds && (
        <div className="mt-3 space-y-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs">
          <CredRow label={t('db.password')} value={creds.password} onCopy={copy} copied={copied} />
          <CredRow label={t('db.url')} value={creds.url} onCopy={copy} copied={copied} />
          <p className="text-neutral-500">{t('db.internalNote')}</p>
        </div>
      )}

      {attachOpen && (
        <Modal
          title={t('db.attach')}
          description={t('db.attachHint')}
          onClose={() => setAttachOpen(false)}
        >
          <div className="space-y-4">
            <Field label={t('db.selectService')}>
              <select
                value={attachTo}
                onChange={(e) => setAttachTo(e.target.value)}
                className="field w-full"
              >
                <option value="" className="bg-ink-850">
                  {t('db.selectService')}
                </option>
                {services.map((s) => (
                  <option key={s.id} value={s.id} className="bg-ink-850">
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAttachOpen(false)}
                className="btn-ghost"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={onAttach}
                disabled={busy || !attachTo}
                className="btn-primary"
              >
                {t('db.attach')}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog}
    </Card>
  );
}

const ROLE_RANK: Record<MemberRole, number> = {
  VIEWER: 1,
  MEMBER: 2,
  ADMIN: 3,
  OWNER: 4,
};

/** ADMIN and OWNER may manage members/settings. */
function canManage(role: MemberRole | null | undefined): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK.ADMIN;
}

const ASSIGNABLE_ROLES: MemberRole[] = ['VIEWER', 'MEMBER', 'ADMIN'];

function MembersPanel({
  projectId,
  myRole,
}: {
  projectId: string;
  myRole: MemberRole | null;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errText = useErrorText();
  const manage = canManage(myRole);
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('MEMBER');
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    listMembers(projectId)
      .then(setMembers)
      .catch((e) => toast.error(errText(e)));

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      await addMember(projectId, email.trim().toLowerCase(), role);
      setEmail('');
      toast.success(t('members.added'));
      await refresh();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRole(userId: string, next: MemberRole) {
    try {
      await updateMember(projectId, userId, next);
      await refresh();
    } catch (e) {
      toast.error(errText(e));
    }
  }

  async function onRemove(userId: string) {
    try {
      await removeMember(projectId, userId);
      await refresh();
    } catch (e) {
      toast.error(errText(e));
    }
  }

  return (
    <PanelCard title={t('members.title')} className="mb-10">
      <p className="mb-4 text-xs text-neutral-500">{t('members.hint')}</p>

      <ul className="space-y-2">
        {members.map((m) => (
          <Card key={m.userId} className="flex flex-wrap items-center gap-3 p-3">
            <span className="min-w-0 flex-1 truncate text-sm text-white">
              {m.email}
            </span>
            {m.role === 'OWNER' || !manage ? (
              <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-neutral-300">
                {t(`members.role.${m.role}`)}
              </span>
            ) : (
              <>
                <select
                  value={m.role}
                  onChange={(e) => onRole(m.userId, e.target.value as MemberRole)}
                  className="field text-xs"
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r} className="bg-ink-850">
                      {t(`members.role.${r}`)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => onRemove(m.userId)}
                  className="btn-danger-ghost btn-sm"
                >
                  {t('common.remove')}
                </button>
              </>
            )}
          </Card>
        ))}
      </ul>

      {manage && (
        <form onSubmit={onAdd} className="mt-4 flex flex-wrap items-end gap-2">
          <Field label={t('members.email')} className="min-w-[220px] flex-1">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="field w-full"
            />
          </Field>
          <Field label={t('members.roleLabel')}>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
              className="field"
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r} className="bg-ink-850">
                  {t(`members.role.${r}`)}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" disabled={busy} className="btn-primary">
            {t('members.add')}
          </button>
        </form>
      )}
    </PanelCard>
  );
}

function AuditPanel({
  projectId,
  canView,
}: {
  projectId: string;
  canView: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<AuditLog[] | null>(null);

  useEffect(() => {
    if (!open || logs) return;
    listProjectAudit(projectId)
      .then(setLogs)
      .catch(() => setLogs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  if (!canView) return null;

  return (
    <PanelCard
      title={t('audit.title')}
      action={
        <button onClick={() => setOpen((v) => !v)} className="btn-ghost btn-sm">
          {open ? t('audit.hide') : t('audit.show')}
        </button>
      }
      className="mb-10"
    >
      {open &&
        (logs && logs.length > 0 ? (
          <AuditTable logs={logs} />
        ) : (
          <EmptyState>{t('audit.empty')}</EmptyState>
        ))}
    </PanelCard>
  );
}

function AuditTable({ logs }: { logs: AuditLog[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <tbody className="divide-y divide-white/5">
          {logs.map((l) => (
            <tr key={l.id} className="text-neutral-400">
              <td className="whitespace-nowrap py-2 pr-3 text-neutral-500">
                {new Date(l.createdAt).toLocaleString()}
              </td>
              <td className="py-2 pr-3 text-neutral-300">{l.userEmail ?? '—'}</td>
              <td className="py-2 pr-3 font-mono text-indigo-300">{l.action}</td>
              <td className="py-2 pr-3">{l.targetType}</td>
              <td className="py-2 text-right font-mono">
                <span
                  className={
                    l.status && l.status >= 400
                      ? 'text-red-400'
                      : 'text-emerald-400'
                  }
                >
                  {l.status ?? ''}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CredRow({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  onCopy: (v: string) => void;
  copied: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-neutral-500">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-neutral-300">
        {value}
      </code>
      <button
        onClick={() => onCopy(value)}
        className="shrink-0 text-neutral-400 transition-colors hover:text-white"
      >
        {copied ? t('db.copied') : t('db.copy')}
      </button>
    </div>
  );
}
