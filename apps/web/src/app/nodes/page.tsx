'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AgentStatus,
  Node,
  NodeInstall,
  NodePruneResult,
  NodeHost,
  NodeStats,
  NodeSystem,
  NodeWithToken,
  NodeWorkloads,
  PlatformResourceSummary,
  createNode,
  createRemoteNode,
  deleteNode,
  getNodeInstall,
  getPlatformResourceSummary,
  getNodeHost,
  getNodeSystem,
  getNodeStats,
  getNodeWorkloads,
  listNodes,
  nodeAgentStatus,
  pruneNode,
  startNodeAgent,
  stopNodeAgent,
  updateNodeCapacity,
} from '@/lib/api';
import { AppShell } from '@/components/shell';
import { useEntitlements } from '@/components/entitlements';
import {
  Card,
  EmptyState,
  ErrorBox,
  Field,
  GuideCard,
  KpiCard,
  Modal,
  PageHeader,
  ResourceSlider,
  Spinner,
  StatusDot,
  StatusText,
  statusTone,
  formatCpu,
  useConfirmDialog,
} from '@/components/ui';
import { useErrorText, useI18n, useTypeLabel } from '@/i18n';

export default function NodesPage() {
  return (
    <AppShell>
      <NodesContent />
    </AppShell>
  );
}

function NodesContent() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { entitlements } = useEntitlements();
  const { confirm, dialog } = useConfirmDialog();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [platform, setPlatform] = useState<PlatformResourceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [newToken, setNewToken] = useState<NodeWithToken | null>(null);

  function load() {
    setLoading(true);
    Promise.all([listNodes(), getPlatformResourceSummary().catch(() => null)])
      .then(([rows, summary]) => {
        setNodes(rows);
        setPlatform(summary);
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
  }

  // Silent refresh (no spinner) so remote heartbeat status stays current.
  function refreshQuiet() {
    listNodes()
      .then(setNodes)
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
    const timer = setInterval(refreshQuiet, 8000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onDelete(id: string) {
    if (
      !(await confirm({
        title: t('common.delete'),
        message: t('nodes.confirmDelete'),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    ) {
      return;
    }
    try {
      await deleteNode(id);
      load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const maxNodes = entitlements.limits.maxNodes;
  const atLimit = maxNodes != null && nodes.length >= maxNodes;
  const limitTitle = atLimit ? t('nodes.limitReached', { max: maxNodes ?? 0 }) : undefined;

  return (
    <>
      <PageHeader
        title={t('nodes.title')}
        subtitle={t('nodes.subtitle')}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCreateOpen(true)}
              disabled={atLimit}
              title={limitTitle}
              className="btn-ghost whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('nodes.addLocal')}
            </button>
            <button
              onClick={() => setRemoteOpen(true)}
              disabled={atLimit}
              title={limitTitle}
              className="btn-primary whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('nodes.addRemote')}
            </button>
          </div>
        }
      />

      {maxNodes != null && (
        <p className="mb-4 text-xs text-neutral-500">
          {t('nodes.limitHint', { count: nodes.length, max: maxNodes })}
          {atLimit && (
            <>
              {' '}
              <Link href="/billing" className="text-indigo-300 hover:text-indigo-200">
                {t('nodes.limitUpgrade')}
              </Link>
            </>
          )}
        </p>
      )}

      <GuideCard
        storageKey="nodes"
        title={t('nodes.aboutTitle')}
        body={t('nodes.aboutBody')}
        steps={[
          { title: t('nodes.step1Title'), body: t('nodes.step1Body') },
          { title: t('nodes.step2Title'), body: t('nodes.step2Body') },
          { title: t('nodes.step3Title'), body: t('nodes.step3Body') },
        ]}
        note={{ title: t('nodes.manageTitle'), body: t('nodes.manageBody') }}
      />

      {error && <ErrorBox message={error} />}

      {newToken && (
        <Card className="mb-6 border-amber-400/30 bg-amber-400/[0.06]">
          <p className="mb-2 text-sm text-amber-200">
            {t('nodes.tokenOnce', { name: newToken.name })}
          </p>
          <pre className="overflow-x-auto rounded-xl bg-ink-950/80 p-3 font-mono text-xs text-neutral-300">
            {`AGENT_DAEMON_TOKEN=${newToken.daemonTokenPlaintext} \\
AGENT_PORT=${newToken.agentPort} go run ./cmd/agent`}
          </pre>
          <button
            onClick={() => setNewToken(null)}
            className="mt-3 text-xs text-neutral-400 transition-colors hover:text-white"
          >
            {t('common.dismiss')}
          </button>
        </Card>
      )}

      {loading && <Spinner />}
      {!loading && nodes.length === 0 && (
        <EmptyState>{t('nodes.empty')}</EmptyState>
      )}

      <ul className="space-y-3">
        {nodes.map((n) => (
          <NodeItem
            key={n.id}
            node={n}
            platform={platform}
            onDelete={() => onDelete(n.id)}
            onChanged={load}
          />
        ))}
      </ul>
      {createOpen && (
        <CreateNodeModal
          platform={platform}
          onClose={() => setCreateOpen(false)}
          onCreated={(node) => {
            setCreateOpen(false);
            setNewToken(node);
            load();
          }}
        />
      )}
      {remoteOpen && (
        <RemoteNodeModal
          onClose={() => setRemoteOpen(false)}
          onCreated={() => {
            setRemoteOpen(false);
            load();
          }}
        />
      )}
      {dialog}
    </>
  );
}

const NODE_OVERHEAD_CPU = 25;
const NODE_OVERHEAD_MEM_MB = 512;

function CreateNodeModal({
  platform,
  onClose,
  onCreated,
}: {
  platform: PlatformResourceSummary | null;
  onClose: () => void;
  onCreated: (node: NodeWithToken) => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const maxCpu = Math.max(
    100,
    platform?.hostCpuCores ? platform.hostCpuCores * 100 : 100,
  );
  const maxMem = Math.max(512, platform?.hostMemMb ?? 512);
  const recommendedCpu = Math.min(maxCpu, NODE_OVERHEAD_CPU);
  const recommendedMem = Math.min(maxMem, NODE_OVERHEAD_MEM_MB);
  const [form, setForm] = useState({
    name: '',
    fqdn: '',
    agentPort: 8443,
    cpuTotal: maxCpu,
    memTotal: maxMem,
  });
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      const node = await createNode({
        name: form.name.trim(),
        fqdn: form.fqdn.trim(),
        agentPort: Number(form.agentPort),
        cpuTotal: Number(form.cpuTotal),
        memTotal: Number(form.memTotal),
      });
      onCreated(node);
    } catch (e) {
      setErr(errorText(e, 'common.failed'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      title={t('nodes.addTitle')}
      description={t('nodes.capacityHint')}
      onClose={onClose}
      className="max-w-3xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost">
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="create-node-form"
            disabled={creating}
            className="btn-primary"
          >
            {creating ? t('nodes.adding') : t('nodes.add')}
          </button>
        </>
      }
    >
      {err && <ErrorBox message={err} />}
      <form id="create-node-form" onSubmit={onCreate} className="space-y-5">
        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {t('nodes.connectionSection')}
          </h4>
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <Field label={t('nodes.nameLabel')} hint={t('nodes.nameHint')}>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t('nodes.namePlaceholder')}
                required
                className="field w-full"
              />
            </Field>
            <Field label={t('nodes.fqdnLabel')} hint={t('nodes.fqdnHint')}>
              <input
                value={form.fqdn}
                onChange={(e) => setForm({ ...form, fqdn: e.target.value })}
                placeholder={t('nodes.fqdnPlaceholder')}
                required
                className="field w-full"
              />
            </Field>
            <Field label={t('nodes.portLabel')} hint={t('nodes.portHint')}>
              <input
                type="number"
                value={form.agentPort}
                onChange={(e) =>
                  setForm({ ...form, agentPort: Number(e.target.value) })
                }
                placeholder={t('nodes.portPlaceholder')}
                className="field w-full"
              />
            </Field>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {t('nodes.capacitySection')}
          </h4>
          <div className="grid items-start gap-3 lg:grid-cols-2">
            <ResourceSlider
              label={t('resources.cpuCapacity')}
              value={form.cpuTotal}
              min={10}
              max={maxCpu}
              step={10}
              onChange={(value) => setForm({ ...form, cpuTotal: value })}
              formatValue={formatCpu}
              recommendedValue={recommendedCpu}
              recommendedLabel={t('resources.nodeOverheadRecommended')}
            />
            <ResourceSlider
              label={t('resources.memCapacity')}
              value={form.memTotal}
              min={128}
              max={maxMem}
              step={128}
              onChange={(value) => setForm({ ...form, memTotal: value })}
              formatValue={(value) => `${value} MB`}
              recommendedValue={recommendedMem}
              recommendedLabel={t('resources.nodeOverheadRecommended')}
            />
          </div>
        </section>

      </form>
    </Modal>
  );
}

function CmdBlock({ label, cmd }: { label: string; cmd: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-medium text-neutral-400">{label}</p>
        <button
          onClick={copy}
          className="text-xs text-indigo-300 transition-colors hover:text-indigo-200"
        >
          {copied ? t('service.copied') : t('service.copy')}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-xl bg-ink-950/80 p-3 font-mono text-xs text-neutral-300 ring-1 ring-white/5">
        {cmd}
      </pre>
    </div>
  );
}

function RemoteNodeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [form, setForm] = useState({ name: '', fqdn: '', agentPort: 8443 });
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [install, setInstall] = useState<NodeInstall | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      const node = await createRemoteNode({
        name: form.name.trim(),
        fqdn: form.fqdn.trim(),
        agentPort: Number(form.agentPort),
      });
      const info = await getNodeInstall(node.id);
      setInstall(info);
    } catch (e) {
      setErr(errorText(e, 'common.failed'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      title={t('nodes.addRemoteTitle')}
      description={t('nodes.addRemoteHint')}
      onClose={install ? onCreated : onClose}
      className="max-w-2xl"
      footer={
        install ? (
          <button type="button" onClick={onCreated} className="btn-primary">
            {t('common.done')}
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} className="btn-ghost">
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="remote-node-form"
              disabled={creating}
              className="btn-primary"
            >
              {creating ? t('nodes.adding') : t('nodes.add')}
            </button>
          </>
        )
      }
    >
      {err && <ErrorBox message={err} />}
      {!install ? (
        <form id="remote-node-form" onSubmit={onCreate} className="space-y-3">
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <Field label={t('nodes.nameLabel')} hint={t('nodes.nameHint')}>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t('nodes.namePlaceholder')}
                required
                className="field w-full"
              />
            </Field>
            <Field label={t('nodes.fqdnLabel')} hint={t('nodes.fqdnHint')}>
              <input
                value={form.fqdn}
                onChange={(e) => setForm({ ...form, fqdn: e.target.value })}
                placeholder={t('nodes.fqdnPlaceholder')}
                required
                className="field w-full"
              />
            </Field>
            <Field label={t('nodes.portLabel')} hint={t('nodes.portHint')}>
              <input
                type="number"
                value={form.agentPort}
                onChange={(e) =>
                  setForm({ ...form, agentPort: Number(e.target.value) })
                }
                placeholder={t('nodes.portPlaceholder')}
                className="field w-full"
              />
            </Field>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3 text-sm text-amber-200">
            {t('nodes.installBody')}
          </p>
          <CmdBlock label={t('nodes.installCommand')} cmd={install.commands.linux} />
          <p className="text-xs text-neutral-500">{t('nodes.joinTokenNote')}</p>
        </div>
      )}
    </Modal>
  );
}

function NodeInstallModal({
  node,
  onClose,
}: {
  node: Node;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [install, setInstall] = useState<NodeInstall | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getNodeInstall(node.id)
      .then(setInstall)
      .catch((e) => setErr(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  return (
    <Modal
      title={t('nodes.installTitle')}
      description={t('nodes.installBody')}
      onClose={onClose}
      className="max-w-2xl"
      footer={
        <button type="button" onClick={onClose} className="btn-primary">
          {t('common.close')}
        </button>
      }
    >
      {err && <ErrorBox message={err} />}
      {!install ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <CmdBlock label={t('nodes.installCommand')} cmd={install.commands.linux} />
          <p className="text-xs text-neutral-500">{t('nodes.joinTokenNote')}</p>
        </div>
      )}
    </Modal>
  );
}

function NodeItem({
  node,
  platform,
  onDelete,
  onChanged,
}: {
  node: Node;
  platform: PlatformResourceSummary | null;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const typeLabel = useTypeLabel();
  const { confirm, dialog } = useConfirmDialog();
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [system, setSystem] = useState<NodeSystem | null>(null);
  const [stats, setStats] = useState<NodeStats | null>(null);
  const [host, setHost] = useState<NodeHost | null>(null);
  const [workloads, setWorkloads] = useState<NodeWorkloads | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);

  const isRemote = node.remote;

  useEffect(() => {
    getNodeWorkloads(node.id)
      .then(setWorkloads)
      .catch(() => setWorkloads(null));
  }, [node.id]);

  async function refresh() {
    // Remote agents run elsewhere: poll their Docker metrics directly (over the
    // pinned TLS channel). Local dev agents are gated on the panel-side runner.
    if (isRemote) {
      getNodeSystem(node.id)
        .then(setSystem)
        .catch(() => setSystem(null));
      getNodeStats(node.id)
        .then(setStats)
        .catch(() => setStats(null));
      getNodeHost(node.id)
        .then(setHost)
        .catch(() => setHost(null));
      return;
    }
    try {
      const status = await nodeAgentStatus(node.id);
      setAgent(status);
      if (status.running) {
        getNodeSystem(node.id)
          .then(setSystem)
          .catch(() => setSystem(null));
        getNodeStats(node.id)
          .then(setStats)
          .catch(() => setStats(null));
        getNodeHost(node.id)
          .then(setHost)
          .catch(() => setHost(null));
      } else {
        setSystem(null);
        setStats(null);
        setHost(null);
      }
    } catch {
      /* ignore polling errors */
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  async function toggle() {
    if (
      !(await confirm({
        title: agent?.running ? t('service.stop') : t('service.start'),
        message: agent?.running ? t('nodes.stopConfirm') : t('nodes.startConfirm'),
        confirmLabel: agent?.running ? t('service.stop') : t('service.start'),
        tone: 'warning',
      }))
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (agent?.running) await stopNodeAgent(node.id);
      else await startNodeAgent(node.id);
      await refresh();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || agent?.enabled === false;
  const nodeStatus = isRemote
    ? node.status
    : agent?.running
      ? 'RUNNING'
      : 'STOPPED';

  return (
    <Card hover accentTone={statusTone(nodeStatus)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-neutral-400">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <rect x="3" y="4" width="18" height="6" rx="1.5" />
              <rect x="3" y="14" width="18" height="6" rx="1.5" />
              <path d="M7 7h.01M7 17h.01" />
            </svg>
            <StatusDot
              status={nodeStatus}
              className="absolute -bottom-0.5 -right-0.5 ring-2 ring-ink-950"
            />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-white">{node.name}</p>
              <StatusText status={nodeStatus} />
            </div>
            <p className="font-mono text-xs text-neutral-500">
              {node.fqdn}:{node.agentPort}
            </p>
            {isRemote && (
              <p className="mt-0.5 text-xs text-neutral-600">
                {node.agentVersion
                  ? t('nodes.agentVersion', { version: node.agentVersion })
                  : t('nodes.notEnrolled')}
                {node.lastSeen && (
                  <>
                    {' · '}
                    {t('nodes.lastSeen', {
                      time: new Date(node.lastSeen).toLocaleString(),
                    })}
                  </>
                )}
              </p>
            )}
            <p className="mt-1 font-mono text-xs text-neutral-600">
              {formatCpu(node.cpuTotal ?? 0)} CPU
              {stats?.reachable && (node.cpuTotal ?? 0) > 0 && (
                <span className="text-neutral-500">
                  {' '}| {Math.round((stats.cpuPerc / (node.cpuTotal ?? 1)) * 100)}
                  % {t('resources.inUse')}
                </span>
              )}{' '}
              · {node.memTotal ?? 0} MB RAM
              {stats?.reachable && (
                <span className="text-neutral-500">
                  {' '}| {Math.round(stats.memUsageMb)} MB {t('resources.inUse')}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="card-actions">
          {isRemote ? (
            <button
              onClick={() => setInstallOpen(true)}
              className="btn-ghost btn-sm"
            >
              {t('nodes.installCommand')}
            </button>
          ) : (
            <>
              <button
                onClick={toggle}
                disabled={disabled}
                title={
                  agent?.enabled === false ? t('nodes.disabledTitle') : undefined
                }
                className={
                  agent?.running ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'
                }
              >
                {busy ? '…' : agent?.running ? t('nodes.stop') : t('nodes.start')}
              </button>
              {agent && agent.logs.length > 0 && (
                <button
                  onClick={() => setShowLogs((s) => !s)}
                  className="btn-ghost btn-sm"
                >
                  {showLogs ? t('nodes.hideLog') : t('nodes.log')}
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setCapacityOpen(true)}
            className="btn-ghost btn-sm"
          >
            {t('resources.configureCapacity')}
          </button>
          {(agent?.running || (isRemote && system?.reachable !== false)) && (
            <button
              onClick={() => setCleanupOpen(true)}
              className="btn-ghost btn-sm"
            >
              {t('cleanup.button')}
            </button>
          )}
          <button onClick={onDelete} className="btn-danger-ghost">
            {t('common.delete')}
          </button>
        </div>
      </div>

      {system?.reachable === false && (
        <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-300">
          {t('nodes.agentUnreachable')}: {system.error ?? t('common.failed')}
        </p>
      )}

      {system && system.reachable !== false && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label={t('nodes.containers')}
            value={`${system.containersRunning ?? 0}/${system.containersTotal ?? 0}`}
          />
          <KpiCard
            label={t('nodes.images')}
            value={`${system.imagesCount ?? '0'} · ${system.imagesSize ?? '—'}`}
          />
          <KpiCard
            label={t('nodes.reclaimable')}
            value={system.imagesReclaimable ?? '—'}
            tone="sky"
          />
          <KpiCard
            label={t('nodes.volumes')}
            value={system.volumesSize ?? '—'}
          />
        </div>
      )}

      {host && host.reachable !== false && host.memTotalMb != null && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label={t('nodes.hostLoad')}
            value={
              host.load1 != null
                ? `${host.load1.toFixed(2)} / ${host.cpuCores ?? '?'}`
                : '—'
            }
            tone={
              host.load1 != null &&
              host.cpuCores != null &&
              host.load1 > host.cpuCores
                ? 'amber'
                : undefined
            }
          />
          <KpiCard
            label={t('nodes.hostRam')}
            value={`${Math.round((host.memUsedMb ?? 0) / 1024 * 10) / 10}/${
              Math.round((host.memTotalMb ?? 0) / 1024 * 10) / 10
            } GB`}
            tone={(host.memUsedPerc ?? 0) > 90 ? 'amber' : undefined}
          />
          <KpiCard
            label={t('nodes.hostDisk')}
            value={
              host.diskTotalGb != null
                ? `${Math.round(host.diskUsedGb ?? 0)}/${Math.round(
                    host.diskTotalGb,
                  )} GB`
                : '—'
            }
            tone={(host.diskUsedPerc ?? 0) > 90 ? 'amber' : undefined}
          />
          <KpiCard
            label={t('nodes.hostMemPerc')}
            value={
              host.memUsedPerc != null ? `${Math.round(host.memUsedPerc)}%` : '—'
            }
          />
        </div>
      )}

      {workloads &&
        (workloads.services.length > 0 || workloads.databases.length > 0) && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                {t('nodes.servicesOnNode')} ({workloads.services.length})
              </p>
              {workloads.services.length === 0 ? (
                <p className="text-xs text-neutral-600">{t('nodes.noServices')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {workloads.services.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/services/${s.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-sm transition-colors hover:border-white/10"
                      >
                        <span className="truncate text-neutral-300">
                          {s.name}
                          <span className="ml-1 text-neutral-600">
                            · {s.projectName ?? '—'} · {typeLabel(s.type)}
                          </span>
                        </span>
                        <StatusText status={s.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                {t('nodes.databasesOnNode')} ({workloads.databases.length})
              </p>
              {workloads.databases.length === 0 ? (
                <p className="text-xs text-neutral-600">
                  {t('nodes.noDatabases')}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {workloads.databases.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-sm"
                    >
                      <span className="truncate text-neutral-300">
                        {d.name}
                        <span className="ml-1 text-neutral-600">
                          · {d.projectName ?? '—'} · {d.engine}
                        </span>
                      </span>
                      <StatusText status={d.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

      {agent?.enabled === false && (
        <p className="mt-3 text-xs text-amber-300">{t('nodes.disabledHint')}</p>
      )}
      {err && <ErrorBox message={err} />}
      {showLogs && agent && (
        <pre className="mt-4 max-h-56 overflow-auto rounded-xl bg-ink-950/80 p-3 font-mono text-xs text-neutral-300">
          {agent.logs.join('\n')}
        </pre>
      )}
      {capacityOpen && (
        <NodeCapacityModal
          node={node}
          platform={platform}
          onClose={() => setCapacityOpen(false)}
          onSaved={() => {
            setCapacityOpen(false);
            onChanged();
          }}
        />
      )}
      {cleanupOpen && (
        <NodeCleanupModal
          node={node}
          system={system}
          onClose={() => setCleanupOpen(false)}
          onDone={refresh}
        />
      )}
      {installOpen && (
        <NodeInstallModal node={node} onClose={() => setInstallOpen(false)} />
      )}
      {dialog}
    </Card>
  );
}

function NodeCleanupModal({
  node,
  system,
  onClose,
  onDone,
}: {
  node: Node;
  system: NodeSystem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { confirm, dialog } = useConfirmDialog();
  const [all, setAll] = useState(false);
  const [volumes, setVolumes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<NodePruneResult | null>(null);

  async function run() {
    if (
      !(await confirm({
        title: t('cleanup.confirmTitle'),
        message: volumes ? t('cleanup.confirmVolumes') : t('cleanup.confirm'),
        confirmLabel: t('cleanup.button'),
        tone: volumes ? 'danger' : 'warning',
      }))
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await pruneNode(node.id, { all, volumes });
      setResult(res);
      onDone();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('cleanup.title')}
      description={t('cleanup.subtitle')}
      onClose={onClose}
      className="max-w-lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost">
            {result ? t('common.close') : t('common.cancel')}
          </button>
          {!result && (
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="btn-primary"
            >
              {busy ? t('cleanup.running') : t('cleanup.button')}
            </button>
          )}
        </>
      }
    >
      {err && <ErrorBox message={err} />}

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-neutral-400">{t('nodes.reclaimable')}</span>
          <span className="font-mono text-sky-300">
            {result?.imagesReclaimable ?? system?.imagesReclaimable ?? '—'}
          </span>
        </div>
      </div>

      {!result ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-neutral-400">{t('cleanup.always')}</p>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm text-neutral-200">
                {t('cleanup.allImages')}
              </span>
              <span className="block text-xs text-neutral-500">
                {t('cleanup.allImagesHint')}
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.03] p-3">
            <input
              type="checkbox"
              checked={volumes}
              onChange={(e) => setVolumes(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm text-neutral-200">
                {t('cleanup.volumes')}
              </span>
              <span className="block text-xs text-amber-300/80">
                {t('cleanup.volumesHint')}
              </span>
            </span>
          </label>
        </div>
      ) : (
        <div className="mt-4 space-y-2 text-sm">
          <p className="font-medium text-emerald-300">{t('cleanup.done')}</p>
          <div className="grid gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-neutral-500">{t('cleanup.freedSystem')}</span>
              <span className="text-neutral-200">{result.system ?? '0B'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">{t('cleanup.freedBuilder')}</span>
              <span className="text-neutral-200">{result.builder ?? '0B'}</span>
            </div>
            {result.volumes !== undefined && (
              <div className="flex justify-between">
                <span className="text-neutral-500">
                  {t('cleanup.freedVolumes')}
                </span>
                <span className="text-neutral-200">{result.volumes}</span>
              </div>
            )}
          </div>
        </div>
      )}
      {dialog}
    </Modal>
  );
}

function NodeCapacityModal({
  node,
  platform,
  onClose,
  onSaved,
}: {
  node: Node;
  platform: PlatformResourceSummary | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const maxCpu = Math.max(
    node.cpuTotal ?? 100,
    platform?.hostCpuCores ? platform.hostCpuCores * 100 : 100,
  );
  const maxMem = Math.max(node.memTotal ?? 512, platform?.hostMemMb ?? 512);
  const recommendedCpu = Math.min(maxCpu, NODE_OVERHEAD_CPU);
  const recommendedMem = Math.min(maxMem, NODE_OVERHEAD_MEM_MB);
  const [cpuTotal, setCpuTotal] = useState(node.cpuTotal ?? 400);
  const [memTotal, setMemTotal] = useState(node.memTotal ?? 4096);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await updateNodeCapacity(node.id, { cpuTotal, memTotal });
      onSaved();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t('resources.configureCapacity')}
      description={t('nodes.capacityHint')}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost">
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form={`node-capacity-form-${node.id}`}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      {err && <ErrorBox message={err} />}
      <form
        id={`node-capacity-form-${node.id}`}
        onSubmit={save}
        className="grid gap-3 sm:grid-cols-2"
      >
        <ResourceSlider
          label={t('resources.cpuCapacity')}
          value={cpuTotal}
          min={10}
          max={maxCpu}
          step={10}
          onChange={setCpuTotal}
          formatValue={formatCpu}
          recommendedValue={recommendedCpu}
          recommendedLabel={t('resources.nodeOverheadRecommended')}
        />
        <ResourceSlider
          label={t('resources.memCapacity')}
          value={memTotal}
          min={128}
          max={maxMem}
          step={128}
          onChange={setMemTotal}
          formatValue={(value) => `${value} MB`}
          recommendedValue={recommendedMem}
          recommendedLabel={t('resources.nodeOverheadRecommended')}
        />
      </form>
    </Modal>
  );
}
