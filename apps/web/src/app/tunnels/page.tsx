'use client';

import { useEffect, useState } from 'react';
import {
  Tunnel,
  TunnelInstall,
  TunnelStatus,
  createTunnel,
  deleteTunnel,
  listTunnels,
  startTunnel,
  stopTunnel,
  tunnelInstall,
  tunnelStatus,
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
  Modal,
  PageHeader,
  Spinner,
  StatusDot,
  StatusText,
  statusTone,
  useConfirmDialog,
} from '@/components/ui';
import { useErrorText, useI18n } from '@/i18n';
import Link from 'next/link';

export default function TunnelsPage() {
  return (
    <AppShell>
      <TunnelsContent />
    </AppShell>
  );
}

function TunnelsContent() {
  const { t } = useI18n();
  const { has, entitlements } = useEntitlements();
  const { confirm, dialog } = useConfirmDialog();
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const unlocked = has('reverse-tunnels');

  function load() {
    setLoading(true);
    listTunnels()
      .then(setTunnels)
      .catch((e) => setError(e instanceof Error ? e.message : t('common.failed')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (unlocked) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function onDelete(id: string) {
    if (
      !(await confirm({
        title: t('common.delete'),
        message: t('tunnel.confirmDelete'),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    ) {
      return;
    }
    try {
      await deleteTunnel(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.failed'));
    }
  }

  if (!unlocked) {
    return (
      <>
        <PageHeader title={t('tunnel.title')} subtitle={t('tunnel.subtitle')} />
        <UpgradeNotice
          tier="homelab"
          featureTitle={t('tunnel.lockedTitle')}
          featureBody={t('tunnel.lockedBody')}
        />
      </>
    );
  }

  const maxTunnels = entitlements.limits.maxTunnels;
  const atLimit = maxTunnels != null && tunnels.length >= maxTunnels;

  return (
    <>
      <PageHeader
        title={t('tunnel.title')}
        subtitle={t('tunnel.subtitle')}
        action={
          <button
            onClick={() => setCreateOpen(true)}
            disabled={atLimit}
            title={atLimit ? t('tunnel.limitReached', { max: maxTunnels ?? 0 }) : undefined}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('tunnel.add')}
          </button>
        }
      />

      {maxTunnels != null && (
        <p className="mb-4 text-xs text-neutral-500">
          {t('tunnel.limitHint', { count: tunnels.length, max: maxTunnels })}
          {atLimit && (
            <>
              {' '}
              <Link href="/billing" className="text-indigo-300 hover:text-indigo-200">
                {t('tunnel.limitUpgrade')}
              </Link>
            </>
          )}
        </p>
      )}

      <GuideCard
        storageKey="tunnels"
        title={t('tunnel.aboutTitle')}
        body={t('tunnel.aboutBody')}
        steps={[
          { title: t('tunnel.step1Title'), body: t('tunnel.step1Body') },
          { title: t('tunnel.step2Title'), body: t('tunnel.step2Body') },
          { title: t('tunnel.step3Title'), body: t('tunnel.step3Body') },
        ]}
      />

      {error && <ErrorBox message={error} />}

      {loading && <Spinner />}
      {!loading && tunnels.length === 0 && (
        <EmptyState>{t('tunnel.empty')}</EmptyState>
      )}

      <ul className="space-y-3">
        {tunnels.map((tn) => (
          <TunnelItem key={tn.id} tunnel={tn} onDelete={() => onDelete(tn.id)} />
        ))}
      </ul>
      {createOpen && (
        <CreateTunnelModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            load();
          }}
        />
      )}
      {dialog}
    </>
  );
}

function CreateTunnelModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { confirm, dialog } = useConfirmDialog();
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    serverHost: '',
    controlPort: 7000,
    relayPorts: '443',
    targetHost: '127.0.0.1',
    proxyProtocol: false,
  });

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      await createTunnel({
        name: form.name.trim(),
        serverHost: form.serverHost.trim(),
        controlPort: Number(form.controlPort),
        relayPorts: form.relayPorts.trim() || '443',
        targetHost: form.targetHost.trim() || '127.0.0.1',
        proxyProtocol: form.proxyProtocol,
      });
      onCreated();
    } catch (e) {
      setErr(errorText(e, 'common.failed'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal title={t('tunnel.add')} description={t('tunnel.subtitle')} onClose={onClose}>
      {err && <ErrorBox message={err} />}
      <form onSubmit={onCreate} className="grid items-end gap-3 sm:grid-cols-2">
        <Field label={t('tunnel.nameLabel')}>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('tunnel.namePlaceholder')}
            required
            className="field w-full"
          />
        </Field>
        <Field label={t('tunnel.serverHostLabel')}>
          <input
            value={form.serverHost}
            onChange={(e) => setForm({ ...form, serverHost: e.target.value })}
            placeholder={t('tunnel.serverHostPlaceholder')}
            required
            className="field w-full"
          />
        </Field>
        <Field label={t('tunnel.controlPortLabel')}>
          <input
            type="number"
            value={form.controlPort}
            onChange={(e) =>
              setForm({ ...form, controlPort: Number(e.target.value) })
            }
            placeholder={t('tunnel.controlPortPlaceholder')}
            className="field w-full"
          />
        </Field>
        <Field label={t('tunnel.relayPortsLabel')}>
          <input
            value={form.relayPorts}
            onChange={(e) => setForm({ ...form, relayPorts: e.target.value })}
            placeholder={t('tunnel.relayPortsPlaceholder')}
            className="field w-full"
          />
        </Field>
        <Field label={t('tunnel.targetHostLabel')}>
          <input
            value={form.targetHost}
            onChange={(e) => setForm({ ...form, targetHost: e.target.value })}
            placeholder={t('tunnel.targetHostPlaceholder')}
            className="field w-full"
          />
        </Field>
        <label className="flex items-center gap-2 self-center text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={form.proxyProtocol}
            onChange={(e) =>
              setForm({ ...form, proxyProtocol: e.target.checked })
            }
            className="accent-indigo-500"
          />
          {t('tunnel.proxyProtocol')}
        </label>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={creating} className="btn-primary">
            {creating ? t('tunnel.adding') : t('tunnel.add')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TunnelItem({
  tunnel,
  onDelete,
}: {
  tunnel: Tunnel;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const { confirm, dialog } = useConfirmDialog();
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [install, setInstall] = useState<TunnelInstall | null>(null);

  async function refresh() {
    try {
      setStatus(await tunnelStatus(tunnel.id));
    } catch {
      /* ignore polling errors */
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tunnel.id]);

  async function toggle() {
    if (
      !(await confirm({
        title: running ? t('service.stop') : t('service.start'),
        message: running ? t('tunnel.stopConfirm') : t('tunnel.startConfirm'),
        confirmLabel: running ? t('service.stop') : t('service.start'),
        tone: 'warning',
      }))
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (status?.running) await stopTunnel(tunnel.id);
      else await startTunnel(tunnel.id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function openInstall() {
    setErr(null);
    try {
      setInstall(await tunnelInstall(tunnel.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common.failed'));
    }
  }

  const connected = status?.connected ?? tunnel.connected;
  const running = status?.running ?? tunnel.running;
  const disabled = busy || status?.enabled === false;
  const connStatus = connected ? 'ONLINE' : 'OFFLINE';

  return (
    <Card hover accentTone={statusTone(connStatus)}>
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
              <path d="M4 12h16" />
              <path d="M4 12a4 4 0 0 1 4-4h2" />
              <path d="M20 12a4 4 0 0 0-4-4h-2" />
              <circle cx="4" cy="12" r="1.6" />
              <circle cx="20" cy="12" r="1.6" />
            </svg>
            <StatusDot
              status={connStatus}
              className="absolute -bottom-0.5 -right-0.5 ring-2 ring-ink-950"
            />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-white">{tunnel.name}</p>
              <StatusText status={connStatus} />
            </div>
            <p className="font-mono text-xs text-neutral-500">
              {tunnel.serverHost}:{tunnel.controlPort} · {t('tunnel.relayingTo')}{' '}
              {tunnel.targetHost}:{tunnel.relayPorts}
            </p>
          </div>
        </div>
        <div className="card-actions">
          <button
            onClick={toggle}
            disabled={disabled}
            title={
              status?.enabled === false ? t('tunnel.disabledHint') : undefined
            }
            className={running ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'}
          >
            {busy ? '…' : running ? t('tunnel.stop') : t('tunnel.start')}
          </button>
          <button onClick={openInstall} className="btn-ghost btn-sm">
            {t('tunnel.install')}
          </button>
          {status && status.logs.length > 0 && (
            <button
              onClick={() => setShowLogs((s) => !s)}
              className="btn-ghost btn-sm"
            >
              {showLogs ? t('tunnel.hideLog') : t('tunnel.log')}
            </button>
          )}
          <button onClick={onDelete} className="btn-danger-ghost">
            {t('common.delete')}
          </button>
        </div>
      </div>

      {status?.enabled === false && (
        <p className="mt-3 text-xs text-amber-300">{t('tunnel.disabledHint')}</p>
      )}
      {err && <ErrorBox message={err} />}
      {showLogs && status && (
        <pre className="mt-4 max-h-56 overflow-auto rounded-xl bg-ink-950/80 p-3 font-mono text-xs text-neutral-300">
          {status.logs.join('\n')}
        </pre>
      )}

      {install && (
        <InstallModal data={install} onClose={() => setInstall(null)} />
      )}
      {dialog}
    </Card>
  );
}

function InstallModal({
  data,
  onClose,
}: {
  data: TunnelInstall;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-ink-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white">
          {t('tunnel.installTitle')}
        </h3>
        <p className="mt-1 text-sm text-neutral-400">{t('tunnel.installHint')}</p>

        <CmdBlock label={t('tunnel.linux')} cmd={data.commands.linux} />
        <CmdBlock label={t('tunnel.windows')} cmd={data.commands.windows} />

        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-sm font-semibold text-white">
            {t('tunnel.offlineTitle')}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {t('tunnel.offlineHint')}
          </p>
          <CmdBlock label={t('tunnel.offlineStep1')} cmd={data.offline.download} />
          <CmdBlock label={t('tunnel.offlineStep2')} cmd={data.offline.copy} />
          <CmdBlock label={t('tunnel.offlineStep3')} cmd={data.offline.run} />
        </div>

        <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <p className="text-xs text-neutral-500">{t('tunnel.token')}</p>
          <p className="mt-0.5 break-all font-mono text-xs text-neutral-300">
            {data.token}
          </p>
        </div>

        <p className="mt-4 text-xs text-amber-300">{t('tunnel.dnsHint')}</p>

        <button onClick={onClose} className="btn-ghost mt-5">
          {t('common.dismiss')}
        </button>
      </div>
    </div>
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
    <div className="mt-4">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-medium text-neutral-400">{label}</p>
        <button
          onClick={copy}
          className="text-xs text-indigo-300 transition-colors hover:text-indigo-200"
        >
          {copied ? t('tunnel.copied') : t('tunnel.copy')}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-xl bg-ink-950/80 p-3 font-mono text-xs text-neutral-300 ring-1 ring-white/5">
        {cmd}
      </pre>
    </div>
  );
}
