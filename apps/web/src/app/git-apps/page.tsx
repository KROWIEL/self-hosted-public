'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AuthMe,
  GitAppConfig,
  GitAppProvider,
  Project,
  getMe,
  listGitApps,
  listProjects,
  setGitApp,
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

export default function GitAppsPage() {
  return (
    <AppShell>
      <GitAppsContent />
    </AppShell>
  );
}

function GitAppsContent() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { has } = useEntitlements();
  const unlocked = has('preview-envs');

  const [me, setMe] = useState<AuthMe | null>(null);
  const [apps, setApps] = useState<GitAppConfig[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<GitAppProvider | null>(null);
  const [secrets, setSecrets] = useState<
    Record<
      GitAppProvider,
      { webhookSecret: string; accessToken: string; githubPrivateKey: string }
    >
  >({
    github: { webhookSecret: '', accessToken: '', githubPrivateKey: '' },
    gitlab: { webhookSecret: '', accessToken: '', githubPrivateKey: '' },
  });

  const isAdmin = me?.role === 'ADMIN';

  const services = useMemo(
    () =>
      projects.flatMap((p) =>
        p.services.map((s) => ({
          id: s.id,
          label: `${p.name} / ${s.name}`,
        })),
      ),
    [projects],
  );

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!unlocked || !isAdmin) return;
    listGitApps()
      .then(setApps)
      .catch((e) => setError(errorText(e)));
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, isAdmin]);

  function updateApp(provider: GitAppProvider, patch: Partial<GitAppConfig>) {
    setApps((prev) =>
      (prev ?? []).map((a) => (a.provider === provider ? { ...a, ...patch } : a)),
    );
  }

  async function onSave(provider: GitAppProvider) {
    const cfg = apps?.find((a) => a.provider === provider);
    if (!cfg) return;
    setBusy(provider);
    setError(null);
    setNotice(null);
    try {
      const allowlistEntries = cfg.repoAllowlist
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (cfg.enabled && allowlistEntries.length === 0) {
        setError(t('gitApps.repoAllowlistRequired'));
        return;
      }
      const sec = secrets[provider];
      const saved = await setGitApp(provider, {
        enabled: cfg.enabled,
        githubAppId: cfg.githubAppId.trim(),
        parentServiceId: cfg.parentServiceId,
        repoAllowlist: cfg.repoAllowlist.trim(),
        defaultTtlHours: cfg.defaultTtlHours,
        commentOnPr: cfg.commentOnPr,
        ...(sec.webhookSecret ? { webhookSecret: sec.webhookSecret } : {}),
        ...(sec.accessToken ? { accessToken: sec.accessToken } : {}),
        ...(sec.githubPrivateKey
          ? { githubPrivateKey: sec.githubPrivateKey }
          : {}),
      });
      setApps((prev) =>
        (prev ?? []).map((a) => (a.provider === provider ? saved : a)),
      );
      setSecrets((s) => ({
        ...s,
        [provider]: {
          webhookSecret: '',
          accessToken: '',
          githubPrivateKey: '',
        },
      }));
      setNotice(t('gitApps.saved'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice(t('gitApps.copied'));
    } catch {
      setNotice(url);
    }
  }

  if (!unlocked) {
    return (
      <>
        <PageHeader title={t('gitApps.title')} subtitle={t('gitApps.subtitle')} />
        <UpgradeNotice
          tier="pro"
          featureTitle={t('gitApps.lockedTitle')}
          featureBody={t('gitApps.lockedBody')}
        />
      </>
    );
  }

  if (me && !isAdmin) {
    return (
      <>
        <PageHeader title={t('gitApps.title')} subtitle={t('gitApps.subtitle')} />
        <EmptyState>{t('gitApps.adminOnly')}</EmptyState>
      </>
    );
  }

  if (!apps) {
    return (
      <>
        <PageHeader title={t('gitApps.title')} subtitle={t('gitApps.subtitle')} />
        {error ? <ErrorBox message={error} /> : <Spinner label={t('common.loading')} />}
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('gitApps.title')} subtitle={t('gitApps.subtitle')} />

      <GuideCard
        storageKey="git-apps"
        title={t('gitApps.aboutTitle')}
        body={t('gitApps.aboutBody')}
        steps={[
          { title: t('gitApps.step1Title'), body: t('gitApps.step1Body') },
          { title: t('gitApps.step2Title'), body: t('gitApps.step2Body') },
          { title: t('gitApps.step3Title'), body: t('gitApps.step3Body') },
          { title: t('gitApps.step4Title'), body: t('gitApps.step4Body') },
        ]}
        note={{ title: t('gitApps.noteTitle'), body: t('gitApps.noteBody') }}
      />

      {error && <ErrorBox message={error} />}
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <div className="space-y-6">
        {apps.map((cfg) => (
          <ProviderCard
            key={cfg.provider}
            cfg={cfg}
            services={services}
            secrets={secrets[cfg.provider]}
            busy={busy === cfg.provider}
            onChange={(patch) => updateApp(cfg.provider, patch)}
            onSecrets={(patch) =>
              setSecrets((s) => ({
                ...s,
                [cfg.provider]: { ...s[cfg.provider], ...patch },
              }))
            }
            onSave={() => onSave(cfg.provider)}
            onCopy={() => copyUrl(cfg.webhookUrl)}
          />
        ))}
      </div>
    </>
  );
}

function ProviderCard({
  cfg,
  services,
  secrets,
  busy,
  onChange,
  onSecrets,
  onSave,
  onCopy,
}: {
  cfg: GitAppConfig;
  services: { id: string; label: string }[];
  secrets: {
    webhookSecret: string;
    accessToken: string;
    githubPrivateKey: string;
  };
  busy: boolean;
  onChange: (patch: Partial<GitAppConfig>) => void;
  onSecrets: (
    patch: Partial<{
      webhookSecret: string;
      accessToken: string;
      githubPrivateKey: string;
    }>,
  ) => void;
  onSave: () => void;
  onCopy: () => void;
}) {
  const { t } = useI18n();
  const label =
    cfg.provider === 'github' ? t('gitApps.github') : t('gitApps.gitlab');

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">{label}</h2>
        <label className="flex items-center gap-2 text-sm text-neutral-200">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          {t('gitApps.enabled')}
        </label>
      </div>

      <div className="mb-4">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
          {t('gitApps.webhookUrl')}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2 text-sm text-neutral-200">
            {cfg.webhookUrl}
          </code>
          <button
            type="button"
            onClick={onCopy}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-200 hover:bg-white/5"
          >
            {t('gitApps.copy')}
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          {t('gitApps.webhookUrlHint')}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={
            cfg.hasWebhookSecret
              ? t('gitApps.webhookSecretSet')
              : t('gitApps.webhookSecret')
          }
        >
          <input
            type="password"
            value={secrets.webhookSecret}
            onChange={(e) => onSecrets({ webhookSecret: e.target.value })}
            placeholder={cfg.hasWebhookSecret ? '••••••••' : ''}
            autoComplete="new-password"
            className="field w-full"
          />
        </Field>
        <Field
          label={
            cfg.hasAccessToken
              ? t('gitApps.accessTokenSet')
              : t('gitApps.accessToken')
          }
          hint={t('gitApps.accessTokenHint')}
        >
          <input
            type="password"
            value={secrets.accessToken}
            onChange={(e) => onSecrets({ accessToken: e.target.value })}
            placeholder={cfg.hasAccessToken ? '••••••••' : ''}
            autoComplete="new-password"
            className="field w-full"
          />
        </Field>

        {cfg.provider === 'github' && (
          <>
            <Field label={t('gitApps.githubAppId')} hint={t('gitApps.githubAppIdHint')}>
              <input
                value={cfg.githubAppId}
                onChange={(e) => onChange({ githubAppId: e.target.value })}
                placeholder="123456"
                className="field w-full"
              />
            </Field>
            <Field
              label={
                cfg.hasGithubPrivateKey
                  ? t('gitApps.githubPrivateKeySet')
                  : t('gitApps.githubPrivateKey')
              }
            >
              <textarea
                value={secrets.githubPrivateKey}
                onChange={(e) => onSecrets({ githubPrivateKey: e.target.value })}
                placeholder={
                  cfg.hasGithubPrivateKey
                    ? '••••••••'
                    : '-----BEGIN RSA PRIVATE KEY-----'
                }
                rows={3}
                className="field w-full font-mono text-xs"
              />
            </Field>
          </>
        )}

        <Field label={t('gitApps.parentService')} hint={t('gitApps.parentServiceHint')}>
          <select
            value={cfg.parentServiceId ?? ''}
            onChange={(e) =>
              onChange({ parentServiceId: e.target.value || null })
            }
            className="field w-full"
          >
            <option value="">{t('gitApps.parentServiceAuto')}</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('gitApps.repoAllowlist')} hint={t('gitApps.repoAllowlistHint')}>
          <input
            value={cfg.repoAllowlist}
            onChange={(e) => onChange({ repoAllowlist: e.target.value })}
            placeholder="owner/repo, group/project"
            className="field w-full"
          />
        </Field>
        <Field label={t('gitApps.ttl')} hint={t('gitApps.ttlHint')}>
          <input
            type="number"
            min={0}
            max={720}
            value={cfg.defaultTtlHours}
            onChange={(e) =>
              onChange({ defaultTtlHours: Number(e.target.value) || 0 })
            }
            className="field w-full"
          />
        </Field>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={cfg.commentOnPr}
              onChange={(e) => onChange({ commentOnPr: e.target.checked })}
            />
            {t('gitApps.commentOnPr')}
          </label>
        </div>
      </div>

      <div className="mt-6">
        <button onClick={onSave} disabled={busy} className="btn-primary">
          {busy ? t('gitApps.saving') : t('gitApps.save')}
        </button>
      </div>
    </Card>
  );
}
