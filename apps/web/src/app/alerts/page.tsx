'use client';

import { useEffect, useState } from 'react';
import {
  AlertChannel,
  AlertEvent,
  AlertEventGroup,
  AlertRule,
  AuthMe,
  createAlertChannel,
  createAlertRule,
  deleteAlertChannel,
  deleteAlertRule,
  getMe,
  listAlertChannels,
  listAlertEvents,
  listAlertMeta,
  listAlertRules,
  testAlertChannel,
  updateAlertChannel,
  updateAlertRule,
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
import { TKey, useErrorText, useI18n } from '@/i18n';

const EVENT_LABELS: Record<string, TKey> = {
  'node.offline': 'alerts.ev.nodeOffline',
  'node.online': 'alerts.ev.nodeOnline',
  'node.cpu.high': 'alerts.ev.nodeCpuHigh',
  'node.mem.high': 'alerts.ev.nodeMemHigh',
  'node.disk.high': 'alerts.ev.nodeDiskHigh',
  'deploy.failed': 'alerts.ev.deployFailed',
  'deploy.succeeded': 'alerts.ev.deploySucceeded',
  'deploy.stuck': 'alerts.ev.deployStuck',
  'service.error': 'alerts.ev.serviceError',
  'service.stopped': 'alerts.ev.serviceStopped',
  'database.error': 'alerts.ev.databaseError',
  'database.stopped': 'alerts.ev.databaseStopped',
  'backup.failed': 'alerts.ev.backupFailed',
  'backup.succeeded': 'alerts.ev.backupSucceeded',
  'offsite.failed': 'alerts.ev.offsiteFailed',
  'tunnel.offline': 'alerts.ev.tunnelOffline',
  'tunnel.online': 'alerts.ev.tunnelOnline',
  'license.expiring': 'alerts.ev.licenseExpiring',
};

const GROUP_LABELS: Record<string, TKey> = {
  nodes: 'alerts.grp.nodes',
  deployments: 'alerts.grp.deployments',
  services: 'alerts.grp.services',
  databases: 'alerts.grp.databases',
  backups: 'alerts.grp.backups',
  networking: 'alerts.grp.networking',
  licensing: 'alerts.grp.licensing',
};

const DEFAULT_EVENT = 'node.offline';

export default function AlertsPage() {
  return (
    <AppShell>
      <AlertsContent />
    </AppShell>
  );
}

function AlertsContent() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { has } = useEntitlements();
  const unlocked = has('alerts');

  const [me, setMe] = useState<AuthMe | null>(null);
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [eventGroups, setEventGroups] = useState<AlertEventGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testedId, setTestedId] = useState<string | null>(null);

  const [chForm, setChForm] = useState({ name: '', url: '' });
  const [ruleForm, setRuleForm] = useState({
    name: '',
    event: DEFAULT_EVENT,
    channelId: '',
  });
  const [busy, setBusy] = useState(false);

  const isAdmin = me?.role === 'ADMIN';

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  async function reload() {
    setLoading(true);
    try {
      const [c, r, e, meta] = await Promise.all([
        listAlertChannels(),
        listAlertRules(),
        listAlertEvents(),
        listAlertMeta(),
      ]);
      setChannels(c);
      setRules(r);
      setEvents(e);
      setEventGroups(meta.groups ?? []);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!unlocked || !isAdmin) {
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, isAdmin]);

  function eventLabel(ev: string): string {
    return EVENT_LABELS[ev] ? t(EVENT_LABELS[ev]) : ev;
  }

  function groupLabel(g: string): string {
    return GROUP_LABELS[g] ? t(GROUP_LABELS[g]) : g;
  }

  async function onAddChannel() {
    if (!chForm.name.trim() || !chForm.url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createAlertChannel({
        name: chForm.name.trim(),
        url: chForm.url.trim(),
      });
      setChForm({ name: '', url: '' });
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleChannel(c: AlertChannel) {
    try {
      await updateAlertChannel(c.id, { enabled: !c.enabled });
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function onDeleteChannel(c: AlertChannel) {
    if (!confirm(t('alerts.confirmDeleteChannel'))) return;
    try {
      await deleteAlertChannel(c.id);
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function onTestChannel(c: AlertChannel) {
    setTestedId(null);
    setError(null);
    try {
      await testAlertChannel(c.id);
      setTestedId(c.id);
      setTimeout(() => setTestedId((id) => (id === c.id ? null : id)), 4000);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function onAddRule() {
    if (!ruleForm.name.trim() || !ruleForm.channelId) return;
    setBusy(true);
    setError(null);
    try {
      await createAlertRule({
        name: ruleForm.name.trim(),
        event: ruleForm.event,
        channelId: ruleForm.channelId,
      });
      setRuleForm({ name: '', event: DEFAULT_EVENT, channelId: '' });
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleRule(r: AlertRule) {
    try {
      await updateAlertRule(r.id, { enabled: !r.enabled });
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function onDeleteRule(r: AlertRule) {
    if (!confirm(t('alerts.confirmDeleteRule'))) return;
    try {
      await deleteAlertRule(r.id);
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (!unlocked) {
    return (
      <>
        <PageHeader title={t('alerts.title')} subtitle={t('alerts.subtitle')} />
        <UpgradeNotice
          tier="pro"
          featureTitle={t('alerts.lockedTitle')}
          featureBody={t('alerts.lockedBody')}
        />
      </>
    );
  }

  if (me && !isAdmin) {
    return (
      <>
        <PageHeader title={t('alerts.title')} subtitle={t('alerts.subtitle')} />
        <EmptyState>{t('alerts.adminOnly')}</EmptyState>
      </>
    );
  }

  const channelName = (id: string) =>
    channels.find((c) => c.id === id)?.name ?? '—';

  return (
    <>
      <PageHeader title={t('alerts.title')} subtitle={t('alerts.subtitle')} />

      <GuideCard
        storageKey="alerts"
        title={t('alerts.aboutTitle')}
        body={t('alerts.aboutBody')}
      />

      {error && <ErrorBox message={error} />}

      {/* Channels */}
      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-white">
          {t('alerts.channelsTitle')}
        </h3>
        <p className="mt-1 text-sm text-neutral-400">
          {t('alerts.channelsHint')}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <Field label={t('alerts.channelName')}>
            <input
              value={chForm.name}
              onChange={(e) => setChForm({ ...chForm, name: e.target.value })}
              placeholder={t('alerts.channelNamePlaceholder')}
              className="field w-full"
            />
          </Field>
          <Field label={t('alerts.channelUrl')}>
            <input
              value={chForm.url}
              onChange={(e) => setChForm({ ...chForm, url: e.target.value })}
              placeholder={t('alerts.channelUrlPlaceholder')}
              className="field w-full"
            />
          </Field>
          <button
            onClick={onAddChannel}
            disabled={busy || !chForm.name.trim() || !chForm.url.trim()}
            className="btn-primary"
          >
            {t('alerts.addChannel')}
          </button>
        </div>

        <div className="mt-4">
          {channels.length === 0 ? (
            <EmptyState>{t('alerts.noChannels')}</EmptyState>
          ) : (
            <ul className="divide-y divide-white/5">
              {channels.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{c.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          c.enabled
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-white/10 text-neutral-400'
                        }`}
                      >
                        {c.enabled ? t('alerts.enabled') : t('alerts.disabled')}
                      </span>
                    </div>
                    <div className="truncate font-mono text-xs text-neutral-500">
                      {c.type} · {c.target || '—'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onTestChannel(c)}
                      className="btn-ghost text-xs"
                    >
                      {testedId === c.id ? t('alerts.testOk') : t('alerts.test')}
                    </button>
                    <button
                      onClick={() => onToggleChannel(c)}
                      className="btn-ghost text-xs"
                    >
                      {c.enabled ? t('alerts.disable') : t('alerts.enable')}
                    </button>
                    <button
                      onClick={() => onDeleteChannel(c)}
                      className="btn-ghost text-xs text-rose-300"
                    >
                      {t('alerts.delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Rules */}
      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-white">
          {t('alerts.rulesTitle')}
        </h3>
        <p className="mt-1 text-sm text-neutral-400">{t('alerts.rulesHint')}</p>
        {channels.length === 0 ? (
          <p className="mt-3 text-sm text-amber-300/80">
            {t('alerts.needChannelFirst')}
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <Field label={t('alerts.ruleName')}>
              <input
                value={ruleForm.name}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, name: e.target.value })
                }
                placeholder={t('alerts.ruleNamePlaceholder')}
                className="field w-full"
              />
            </Field>
            <Field label={t('alerts.event')}>
              <select
                value={ruleForm.event}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, event: e.target.value })
                }
                className="field w-full"
              >
                {eventGroups.map((g) => (
                  <optgroup key={g.group} label={groupLabel(g.group)}>
                    {g.events.map((ev) => (
                      <option key={ev} value={ev}>
                        {eventLabel(ev)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label={t('alerts.channel')}>
              <select
                value={ruleForm.channelId}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, channelId: e.target.value })
                }
                className="field w-full"
              >
                <option value="">{t('alerts.selectChannel')}</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <button
              onClick={onAddRule}
              disabled={busy || !ruleForm.name.trim() || !ruleForm.channelId}
              className="btn-primary"
            >
              {t('alerts.addRule')}
            </button>
          </div>
        )}

        <div className="mt-4">
          {rules.length === 0 ? (
            <EmptyState>{t('alerts.noRules')}</EmptyState>
          ) : (
            <ul className="divide-y divide-white/5">
              {rules.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{r.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          r.enabled
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-white/10 text-neutral-400'
                        }`}
                      >
                        {r.enabled ? t('alerts.enabled') : t('alerts.disabled')}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-500">
                      {eventLabel(r.event)} → {channelName(r.channelId)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onToggleRule(r)}
                      className="btn-ghost text-xs"
                    >
                      {r.enabled ? t('alerts.disable') : t('alerts.enable')}
                    </button>
                    <button
                      onClick={() => onDeleteRule(r)}
                      className="btn-ghost text-xs text-rose-300"
                    >
                      {t('alerts.delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Recent events */}
      <h3 className="mb-3 mt-8 text-lg font-semibold text-white">
        {t('alerts.eventsTitle')}
      </h3>
      {loading && <Spinner />}
      {!loading && events.length === 0 && (
        <EmptyState>{t('alerts.noEvents')}</EmptyState>
      )}
      {!loading && events.length > 0 && (
        <Card className="overflow-hidden">
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2 font-medium">{t('alerts.colTime')}</th>
                  <th className="px-3 py-2 font-medium">
                    {t('alerts.colEvent')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('alerts.colTitle')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('alerts.colStatus')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr
                    key={ev.id}
                    className="border-b border-white/5 text-neutral-300"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-400">
                      {new Date(ev.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-indigo-200">
                      {eventLabel(ev.event)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-neutral-200">{ev.title}</div>
                      {ev.error && (
                        <div className="text-xs text-rose-300">{ev.error}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          ev.status === 'failed'
                            ? 'text-rose-300'
                            : 'text-emerald-300'
                        }
                      >
                        {ev.status === 'failed'
                          ? t('alerts.statusFailed')
                          : t('alerts.statusSent')}
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
