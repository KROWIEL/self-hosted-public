'use client';

import { useCallback, useEffect, useState } from 'react';
import { useErrorText, useI18n } from '@/i18n';
import { useConfirmDialog } from '@/components/ui';
import {
  Backup,
  BackupKind,
  BackupSchedule,
  createBackup,
  createBackupSchedule,
  deleteBackup,
  deleteBackupSchedule,
  downloadBackup,
  listBackups,
  listBackupSchedules,
  restoreBackup,
} from '@/lib/api';

function fmtSize(bytes: number | null): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function BackupsPanel({
  kind,
  refId,
}: {
  kind: BackupKind;
  refId: string;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { confirm, dialog } = useConfirmDialog();
  const [items, setItems] = useState<Backup[]>([]);
  const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cron, setCron] = useState('0 3 * * *');
  const [keepLast, setKeepLast] = useState(7);

  const refresh = useCallback(async () => {
    const [b, s] = await Promise.all([
      listBackups(kind, refId),
      listBackupSchedules(kind, refId),
    ]);
    setItems(b);
    setSchedules(s);
  }, [kind, refId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onBackup() {
    setBusy(true);
    try {
      await createBackup(kind, refId);
      await refresh();
    } catch (e) {
      alert(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRestore(b: Backup) {
    if (
      !(await confirm({
        title: t('backup.restore'),
        message: t('backup.restoreConfirm'),
        confirmLabel: t('backup.restore'),
        tone: 'danger',
      }))
    ) {
      return;
    }
    setBusyId(b.id);
    try {
      await restoreBackup(b.id);
      alert(t('backup.restoreDone'));
    } catch (e) {
      alert(errorText(e));
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(b: Backup) {
    if (
      !(await confirm({
        title: t('backup.delete'),
        message: t('backup.deleteConfirm'),
        confirmLabel: t('backup.delete'),
        tone: 'danger',
      }))
    ) {
      return;
    }
    setBusyId(b.id);
    try {
      await deleteBackup(b.id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function onAddSchedule() {
    if (!cron.trim()) return;
    setBusy(true);
    try {
      await createBackupSchedule({ kind, refId, cron: cron.trim(), keepLast });
      await refresh();
    } catch (e) {
      alert(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          {t('backup.title')}
        </span>
        <button onClick={onBackup} disabled={busy} className="btn-ghost btn-sm">
          {busy ? t('backup.running') : t('backup.now')}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-neutral-500">{t('backup.none')}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.02] px-2 py-1.5 text-xs"
            >
              <span
                className={
                  b.status === 'FAILED'
                    ? 'text-rose-400'
                    : b.status === 'RUNNING'
                      ? 'text-amber-300'
                      : 'text-emerald-400'
                }
              >
                ●
              </span>
              <span className="text-neutral-400">
                {new Date(b.createdAt).toLocaleString()}
              </span>
              <span className="text-neutral-500">{fmtSize(b.sizeBytes)}</span>
              {b.status === 'FAILED' && (
                <span className="text-rose-400" title={b.errorMsg ?? ''}>
                  {t('backup.failed')}
                </span>
              )}
              <span className="ml-auto flex items-center gap-2">
                {b.status === 'SUCCESS' && (
                  <>
                    <button
                      onClick={() => downloadBackup(b.id, b.fileName)}
                      className="btn-ghost px-2 py-0.5 text-xs"
                    >
                      {t('backup.download')}
                    </button>
                    <button
                      onClick={() => onRestore(b)}
                      disabled={busyId === b.id}
                      className="btn-ghost px-2 py-0.5 text-xs"
                    >
                      {busyId === b.id ? t('backup.restoring') : t('backup.restore')}
                    </button>
                  </>
                )}
                <button
                  onClick={() => onDelete(b)}
                  disabled={busyId === b.id}
                  className="btn-danger-ghost"
                >
                  {t('backup.delete')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-white/5 pt-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          {t('backup.schedules')}
        </span>
        {schedules.length === 0 ? (
          <p className="mt-1 text-xs text-neutral-500">{t('backup.noSchedules')}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {schedules.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-2 py-1.5 text-xs"
              >
                <span className="font-mono text-neutral-300">{s.cron}</span>
                <span className="text-neutral-500">
                  {t('backup.keepLast')}: {s.keepLast}
                </span>
                <button
                  onClick={() => deleteBackupSchedule(s.id).then(refresh)}
                  className="btn-danger-ghost ml-auto"
                >
                  {t('backup.delete')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder={t('backup.cron')}
            className="field w-40 font-mono text-xs"
          />
          <input
            type="number"
            min={1}
            value={keepLast}
            onChange={(e) => setKeepLast(Number(e.target.value) || 1)}
            className="field w-20 text-xs"
            title={t('backup.keepLast')}
          />
          <button onClick={onAddSchedule} disabled={busy} className="btn-ghost btn-sm">
            {t('backup.addSchedule')}
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-500">{t('backup.scheduleHint')}</p>
      </div>
      {dialog}
    </div>
  );
}
