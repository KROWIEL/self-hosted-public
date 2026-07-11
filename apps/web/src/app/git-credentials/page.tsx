'use client';

import { useEffect, useState } from 'react';
import {
  GitCredential,
  GitProvider,
  createGitCredential,
  deleteGitCredential,
  listGitCredentials,
  verifyGitCredential,
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
  Spinner,
  useConfirmDialog,
} from '@/components/ui';
import { useI18n } from '@/i18n';

export default function GitCredentialsPage() {
  const { t } = useI18n();
  const { confirm, dialog } = useConfirmDialog();
  const [creds, setCreds] = useState<GitCredential[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  function load() {
    setLoading(true);
    listGitCredentials()
      .then(setCreds)
      .catch((e) => setError(e instanceof Error ? e.message : t('common.failed')))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function onDelete(id: string) {
    if (
      !(await confirm({
        title: t('common.delete'),
        message: t('git.confirmDelete'),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    ) {
      return;
    }
    try {
      await deleteGitCredential(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.failed'));
    }
  }

  return (
    <AppShell>
      <PageHeader
        title={t('git.title')}
        subtitle={t('git.subtitle')}
        action={
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            {t('git.add')}
          </button>
        }
      />

      <GuideCard
        storageKey="git"
        title={t('git.aboutTitle')}
        body={t('git.aboutBody')}
        steps={[
          { title: t('git.step1Title'), body: t('git.step1Body') },
          { title: t('git.step2Title'), body: t('git.step2Body') },
          { title: t('git.step3Title'), body: t('git.step3Body') },
        ]}
      />

      {error && <ErrorBox message={error} />}

      {loading && <Spinner />}
      {!loading && creds.length === 0 && <EmptyState>{t('git.empty')}</EmptyState>}

      <ul className="space-y-3">
        {creds.map((c) => (
          <CredItem key={c.id} cred={c} onDelete={() => onDelete(c.id)} />
        ))}
      </ul>
      {createOpen && (
        <CreateGitCredentialModal
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

function CreateGitCredentialModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<{
    name: string;
    provider: GitProvider;
    username: string;
    pat: string;
  }>({ name: '', provider: 'GITHUB', username: '', pat: '' });

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      await createGitCredential({
        name: form.name.trim(),
        provider: form.provider,
        username: form.username.trim() || undefined,
        pat: form.pat.trim(),
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common.failed'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal title={t('git.add')} description={t('git.securityNote')} onClose={onClose}>
      {err && <ErrorBox message={err} />}
      <form onSubmit={onCreate} className="grid items-end gap-3 sm:grid-cols-2">
        <Field label={t('git.name')}>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('git.namePlaceholder')}
            required
            className="field w-full"
          />
        </Field>
        <Field label={t('git.provider')}>
          <select
            value={form.provider}
            onChange={(e) =>
              setForm({ ...form, provider: e.target.value as GitProvider })
            }
            className="field w-full"
          >
            <option value="GITHUB">GitHub</option>
            <option value="GITLAB">GitLab</option>
          </select>
        </Field>
        <Field label={t('git.username')}>
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder={t('git.usernamePlaceholder')}
            className="field w-full"
          />
        </Field>
        <Field label={t('git.pat')}>
          <input
            type="password"
            value={form.pat}
            onChange={(e) => setForm({ ...form, pat: e.target.value })}
            placeholder={t('git.patPlaceholder')}
            required
            autoComplete="off"
            className="field w-full"
          />
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={creating} className="btn-primary">
            {creating ? t('git.adding') : t('git.add')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CredItem({
  cred,
  onDelete,
}: {
  cred: GitCredential;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [repoUrl, setRepoUrl] = useState('');
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setResult(null);
    try {
      setResult(await verifyGitCredential(cred.id, repoUrl.trim()));
    } catch (e) {
      setResult({
        ok: false,
        message: e instanceof Error ? e.message : t('common.failed'),
      });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Card hover>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-neutral-400">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.5 1.3a12 12 0 0 0-6.3 0C6.5 2 5.5 2.3 5.5 2.3a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 8.7c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V20" />
            </svg>
          </span>
          <div>
            <p className="font-medium text-white">{cred.name}</p>
            <p className="font-mono text-xs text-neutral-500">
              {cred.provider}
              {cred.username ? ` · ${cred.username}` : ''}
            </p>
          </div>
        </div>
        <button onClick={onDelete} className="btn-danger-ghost">
          {t('common.delete')}
        </button>
      </div>

      <button onClick={() => setVerifyOpen(true)} className="btn-ghost btn-sm mt-4">
        {t('git.verify')}
      </button>
      {result ? (
        <p
          className={`mt-2 text-xs ${
            result.ok ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {result.message}
        </p>
      ) : (
        <p className="mt-2 text-xs text-neutral-500">{t('git.verifyHint')}</p>
      )}
      {verifyOpen && (
        <Modal
          title={t('git.verify')}
          description={t('git.verifyHint')}
          onClose={() => setVerifyOpen(false)}
        >
          <form onSubmit={onVerify} className="space-y-4">
            <Field label={t('git.repoLabel')}>
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder={t('git.verifyRepoPlaceholder')}
                className="field w-full"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVerifyOpen(false)}
                className="btn-ghost"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={verifying || repoUrl.trim().length === 0}
                className="btn-primary"
              >
                {verifying ? t('git.verifying') : t('git.verify')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
}
