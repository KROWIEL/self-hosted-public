'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import {
  AuthMe,
  TwoFactorSetup,
  begin2fa,
  changePassword,
  disable2fa,
  enable2fa,
  getMe,
  getMustChangePassword,
  updateProfile,
} from '@/lib/api';
import { AppShell } from '@/components/shell';
import { Card, Field, PageHeader, Spinner } from '@/components/ui';
import { PasswordChecklist } from '@/components/password-checklist';
import { isStrongPassword } from '@/lib/password';
import { useToast } from '@/components/toast';
import { useErrorText, useI18n } from '@/i18n';

export default function SettingsPage() {
  const { t } = useI18n();
  const [me, setMe] = useState<AuthMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [mustChange, setMustChange] = useState(false);

  async function refresh() {
    const data = await getMe();
    setMe(data);
  }

  useEffect(() => {
    setMustChange(getMustChangePassword());
    getMe()
      .then(setMe)
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      {mustChange && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 shrink-0"
          >
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
          <div>
            <p className="font-medium">{t('settings.mustChangeTitle')}</p>
            <p className="mt-0.5 text-amber-200/80">
              {t('settings.mustChangeHint')}
            </p>
          </div>
        </div>
      )}

      {loading || !me ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <ProfileCard me={me} onSaved={refresh} />
          <PasswordCard onChanged={() => setMustChange(false)} />
          <TwoFactorCard me={me} onChanged={refresh} />
        </div>
      )}
    </AppShell>
  );
}

function ProfileCard({ me, onSaved }: { me: AuthMe; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const errText = useErrorText();
  const [firstName, setFirstName] = useState(me.firstName ?? '');
  const [lastName, setLastName] = useState(me.lastName ?? '');
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      toast.success(t('settings.profileSaved'));
      onSaved();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-white">
        {t('settings.profileTitle')}
      </h2>
      <p className="mt-1 text-sm text-neutral-400">{t('settings.profileHint')}</p>

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('settings.firstName')}>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="field w-full"
              maxLength={100}
              required
            />
          </Field>
          <Field label={t('settings.lastName')}>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="field w-full"
              maxLength={100}
              required
            />
          </Field>
        </div>
        <Field label={t('settings.email')} hint={t('settings.emailHint')}>
          <input value={me.email} className="field w-full opacity-60" disabled />
        </Field>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || !firstName.trim() || !lastName.trim()}
            className="btn-primary"
          >
            {saving ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      </form>
    </Card>
  );
}

function PasswordCard({ onChanged }: { onChanged?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const errText = useErrorText();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      toast.error(t('settings.passwordMismatch'));
      return;
    }
    setSaving(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      toast.success(t('settings.passwordChanged'));
      setCurrent('');
      setNext('');
      setConfirm('');
      onChanged?.();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-white">
        {t('settings.passwordTitle')}
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        {t('settings.passwordHint')}
      </p>

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <Field label={t('settings.currentPassword')}>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="field w-full"
            autoComplete="current-password"
            required
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('settings.newPassword')}>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="field w-full"
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label={t('settings.confirmPassword')}>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="field w-full"
              autoComplete="new-password"
              required
            />
          </Field>
        </div>
        <PasswordChecklist value={next} />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={
              saving || !isStrongPassword(next) || current.length === 0
            }
            className="btn-primary"
          >
            {saving
              ? t('settings.changingPassword')
              : t('settings.changePassword')}
          </button>
        </div>
      </form>
    </Card>
  );
}

function TwoFactorCard({
  me,
  onChanged,
}: {
  me: AuthMe;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errText = useErrorText();

  // Enable flow state
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [enabling, setEnabling] = useState(false);
  const [starting, setStarting] = useState(false);

  // Disable flow state
  const [disableOpen, setDisableOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [disabling, setDisabling] = useState(false);

  async function startEnable() {
    setStarting(true);
    try {
      setSetup(await begin2fa());
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setStarting(false);
    }
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    if (!setup) return;
    setEnabling(true);
    try {
      await enable2fa({ totpSecret: setup.secret, totpCode: code });
      toast.success(t('settings.2faEnabledMsg'));
      setSetup(null);
      setCode('');
      onChanged();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setEnabling(false);
    }
  }

  async function confirmDisable(e: React.FormEvent) {
    e.preventDefault();
    setDisabling(true);
    try {
      await disable2fa({ password });
      toast.success(t('settings.2faDisabledMsg'));
      setDisableOpen(false);
      setPassword('');
      onChanged();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setDisabling(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">
            {t('settings.2faTitle')}
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            {me.twoFactor ? t('settings.2faOnHint') : t('settings.2faOffHint')}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            me.twoFactor
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-white/10 text-neutral-400'
          }`}
        >
          {me.twoFactor
            ? t('settings.2faStatusOn')
            : t('settings.2faStatusOff')}
        </span>
      </div>

      {/* Disabled → offer to enable */}
      {!me.twoFactor && !setup && (
        <button
          onClick={startEnable}
          disabled={starting}
          className="btn-primary mt-4"
        >
          {starting ? t('settings.enabling') : t('settings.enable2fa')}
        </button>
      )}

      {/* Enable flow: show QR + confirm code */}
      {!me.twoFactor && setup && (
        <form onSubmit={confirmEnable} className="mt-4 space-y-4">
          <p className="text-xs text-neutral-400">{t('settings.scanHint')}</p>
          <div className="flex flex-col items-center gap-3">
            <Image
              src={setup.qrDataUrl}
              alt="TOTP QR"
              width={176}
              height={176}
              unoptimized
              className="h-44 w-44 rounded-lg bg-white p-2"
            />
            <div className="w-full text-center">
              <p className="text-xs text-neutral-500">
                {t('settings.secretManual')}
              </p>
              <code className="mt-1 block break-all font-mono text-xs text-neutral-300">
                {setup.secret}
              </code>
            </div>
          </div>
          <Field label={t('settings.code')}>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
              className="field w-full tracking-[0.3em]"
              placeholder="123456"
              required
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setSetup(null);
                setCode('');
              }}
              className="btn-ghost"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={enabling || code.length !== 6}
              className="btn-primary"
            >
              {enabling ? t('settings.enabling') : t('settings.confirmEnable')}
            </button>
          </div>
        </form>
      )}

      {/* Enabled → offer to disable */}
      {me.twoFactor && !disableOpen && (
        <button
          onClick={() => setDisableOpen(true)}
          className="btn-danger-ghost mt-4"
        >
          {t('settings.disable2fa')}
        </button>
      )}

      {me.twoFactor && disableOpen && (
        <form onSubmit={confirmDisable} className="mt-4 space-y-4">
          <Field
            label={t('settings.currentPassword')}
            hint={t('settings.passwordToDisable')}
          >
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field w-full"
              autoComplete="current-password"
              required
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDisableOpen(false);
                setPassword('');
              }}
              className="btn-ghost"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={disabling || password.length === 0}
              className="btn-danger"
            >
              {disabling ? t('settings.disabling') : t('settings.disable2fa')}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
