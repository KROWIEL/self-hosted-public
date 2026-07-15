'use client';

import { useEffect, useState } from 'react';
import {
  AuthMe,
  EmailConfig,
  EmailMessage,
  getEmailConfig,
  getMe,
  listEmailMessages,
  sendEmailMessage,
  sendTestEmail,
  setEmailConfig,
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
import { useErrorText, useI18n } from '@/i18n';

export default function EmailPage() {
  return (
    <AppShell>
      <EmailContent />
    </AppShell>
  );
}

function EmailContent() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { has } = useEntitlements();
  const unlocked = has('email');

  const [me, setMe] = useState<AuthMe | null>(null);
  const [cfg, setCfg] = useState<EmailConfig | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState({
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    username: '',
    password: '',
    fromName: 'Self-Hosted',
    fromEmail: '',
  });
  const [passwordSet, setPasswordSet] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'send' | null>(null);

  // Compose / broadcast.
  const [compose, setCompose] = useState<{
    subject: string;
    body: string;
    recipientKind: 'all' | 'custom';
    recipients: string;
  }>({ subject: '', body: '', recipientKind: 'all', recipients: '' });

  const isAdmin = me?.role === 'ADMIN';

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  async function reload() {
    setLoading(true);
    try {
      const [c, m] = await Promise.all([getEmailConfig(), listEmailMessages()]);
      setCfg(c);
      setMessages(m);
      setForm({
        enabled: c.enabled,
        host: c.host,
        port: c.port,
        secure: c.secure,
        username: c.username,
        password: '',
        fromName: c.fromName,
        fromEmail: c.fromEmail,
      });
      setPasswordSet(c.passwordSet);
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

  async function onSave() {
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const c = await setEmailConfig({
        enabled: form.enabled,
        host: form.host.trim(),
        port: Number(form.port) || 587,
        secure: form.secure,
        username: form.username.trim(),
        password: form.password ? form.password : undefined,
        fromName: form.fromName.trim() || 'Self-Hosted',
        fromEmail: form.fromEmail.trim(),
      });
      setCfg(c);
      setPasswordSet(c.passwordSet);
      setForm((f) => ({ ...f, password: '' }));
      setNotice(t('email.saved'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setBusy('test');
    setError(null);
    setNotice(null);
    try {
      const res = await sendTestEmail(testTo.trim() || undefined);
      setNotice(t('email.testOk').replace('{to}', res.to));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function onSend() {
    setBusy('send');
    setError(null);
    setNotice(null);
    try {
      const res = await sendEmailMessage({
        subject: compose.subject.trim(),
        body: compose.body,
        recipientKind: compose.recipientKind,
        recipients:
          compose.recipientKind === 'custom' ? compose.recipients : undefined,
      });
      setNotice(
        t('email.sendOk').replace('{count}', String(res.recipientCount)),
      );
      setCompose((c) => ({ ...c, subject: '', body: '' }));
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (!unlocked) {
    return (
      <>
        <PageHeader title={t('email.title')} subtitle={t('email.subtitle')} />
        <UpgradeNotice
          tier="pro"
          featureTitle={t('email.lockedTitle')}
          featureBody={t('email.lockedBody')}
        />
      </>
    );
  }

  if (me && !isAdmin) {
    return (
      <>
        <PageHeader title={t('email.title')} subtitle={t('email.subtitle')} />
        <EmptyState>{t('email.adminOnly')}</EmptyState>
      </>
    );
  }

  const composeReady =
    compose.subject.trim().length > 0 &&
    compose.body.trim().length > 0 &&
    (compose.recipientKind === 'all' || compose.recipients.trim().length > 0);

  return (
    <>
      <PageHeader title={t('email.title')} subtitle={t('email.subtitle')} />

      <GuideCard
        storageKey="email"
        title={t('email.aboutTitle')}
        body={t('email.aboutBody')}
      />

      {error && <ErrorBox message={error} />}
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      {/* SMTP configuration */}
      <Card className="mb-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            {t('email.smtpTitle')}
          </h3>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            {t('email.enabled')}
          </label>
        </div>
        <p className="mt-1 text-sm text-neutral-400">{t('email.smtpHint')}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t('email.host')}>
            <input
              value={form.host}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
              placeholder="smtp.example.com"
              className="field w-full"
            />
          </Field>
          <Field label={t('email.port')}>
            <input
              type="number"
              value={form.port}
              onChange={(e) =>
                setForm({ ...form, port: Number(e.target.value) })
              }
              placeholder="587"
              className="field w-full"
            />
          </Field>
          <Field label={t('email.username')}>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="field w-full"
              autoComplete="off"
            />
          </Field>
          <Field label={t('email.password')}>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={passwordSet ? '••••••••' : ''}
              className="field w-full"
              autoComplete="new-password"
            />
          </Field>
          <Field label={t('email.fromName')}>
            <input
              value={form.fromName}
              onChange={(e) => setForm({ ...form, fromName: e.target.value })}
              placeholder="Self-Hosted"
              className="field w-full"
            />
          </Field>
          <Field label={t('email.fromEmail')}>
            <input
              value={form.fromEmail}
              onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
              placeholder="noreply@example.com"
              className="field w-full"
            />
          </Field>
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={form.secure}
            onChange={(e) => setForm({ ...form, secure: e.target.checked })}
          />
          {t('email.secure')}
        </label>

        <div className="mt-5">
          <button
            onClick={onSave}
            disabled={busy !== null}
            className="btn-primary"
          >
            {busy === 'save' ? t('email.saving') : t('email.save')}
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-white/5 pt-4">
          <Field label={t('email.testTo')} className="w-full sm:w-72">
            <input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder={form.fromEmail || 'you@example.com'}
              className="field w-full"
              autoComplete="off"
            />
          </Field>
          <button
            onClick={onTest}
            disabled={busy !== null}
            className="btn-ghost"
          >
            {busy === 'test' ? t('email.testing') : t('email.test')}
          </button>
        </div>
      </Card>

      {/* Compose / broadcast */}
      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-white">
          {t('email.composeTitle')}
        </h3>
        <p className="mt-1 text-sm text-neutral-400">{t('email.composeHint')}</p>

        <div className="mt-4 grid gap-3">
          <Field label={t('email.subject')}>
            <input
              value={compose.subject}
              onChange={(e) =>
                setCompose({ ...compose, subject: e.target.value })
              }
              className="field w-full"
            />
          </Field>

          <Field label={t('email.recipients')}>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="radio"
                  name="recipientKind"
                  checked={compose.recipientKind === 'all'}
                  onChange={() =>
                    setCompose({ ...compose, recipientKind: 'all' })
                  }
                />
                {t('email.recipientsAll')}
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="radio"
                  name="recipientKind"
                  checked={compose.recipientKind === 'custom'}
                  onChange={() =>
                    setCompose({ ...compose, recipientKind: 'custom' })
                  }
                />
                {t('email.recipientsCustom')}
              </label>
            </div>
          </Field>

          {compose.recipientKind === 'custom' && (
            <Field label={t('email.recipientsList')}>
              <textarea
                value={compose.recipients}
                onChange={(e) =>
                  setCompose({ ...compose, recipients: e.target.value })
                }
                placeholder="a@example.com, b@example.com"
                rows={3}
                className="field w-full font-mono text-xs"
              />
            </Field>
          )}

          <Field label={t('email.body')}>
            <textarea
              value={compose.body}
              onChange={(e) => setCompose({ ...compose, body: e.target.value })}
              rows={8}
              className="field w-full"
            />
          </Field>
        </div>

        <div className="mt-4">
          <button
            onClick={onSend}
            disabled={busy !== null || !composeReady}
            className="btn-primary"
          >
            {busy === 'send' ? t('email.sending') : t('email.send')}
          </button>
        </div>
      </Card>

      <h3 className="mb-3 mt-8 text-lg font-semibold text-white">
        {t('email.historyTitle')}
      </h3>
      {loading && <Spinner />}
      {!loading && messages.length === 0 && (
        <EmptyState>{t('email.noHistory')}</EmptyState>
      )}
      {!loading && messages.length > 0 && (
        <Card className="overflow-hidden">
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2 font-medium">{t('email.colTime')}</th>
                  <th className="px-3 py-2 font-medium">
                    {t('email.colSubject')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('email.colRecipients')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('email.colStatus')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-white/5 text-neutral-300"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-400">
                      {new Date(m.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-neutral-200">
                      {m.subject}
                      {m.error && (
                        <div className="text-rose-300">{m.error}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-400">
                      {m.recipientCount}
                      {' · '}
                      {m.recipientKind === 'all'
                        ? t('email.recipientsAll')
                        : t('email.recipientsCustom')}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          m.status === 'failed'
                            ? 'text-rose-300'
                            : 'text-emerald-300'
                        }
                      >
                        {m.status === 'failed'
                          ? t('email.statusFailed')
                          : t('email.statusSent')}
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
