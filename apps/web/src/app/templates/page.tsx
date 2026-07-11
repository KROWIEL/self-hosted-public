'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AuthMe,
  Template,
  TemplateInput,
  TemplateVariable,
  createTemplate,
  deleteTemplate,
  getMe,
  listTemplates,
  updateTemplate,
} from '@/lib/api';
import { AppShell } from '@/components/shell';
import {
  Card,
  EmptyState,
  Field,
  GuideCard,
  Modal,
  PageHeader,
  Spinner,
  useConfirmDialog,
} from '@/components/ui';
import { useToast } from '@/components/toast';
import { TKey, useErrorText, useI18n, useTypeLabel } from '@/i18n';

// Maps a built-in template name to a localized description key.
const DESC_KEYS: Record<string, TKey> = {
  'Java 21 (Maven)': 'templates.desc.javaMaven',
  'Java 25 (Gradle)': 'templates.desc.javaGradle',
  'Next.js 20': 'templates.desc.nextjs',
  'React (Vite)': 'templates.desc.reactVite',
};

export default function TemplatesPage() {
  const { t } = useI18n();
  const typeLabel = useTypeLabel();
  const errText = useErrorText();
  const toast = useToast();
  const { confirm, dialog } = useConfirmDialog();

  const [me, setMe] = useState<AuthMe | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Template | 'new' | null>(null);

  const isAdmin = me?.role === 'ADMIN';

  function load() {
    setLoading(true);
    listTemplates()
      .then(setTemplates)
      .catch((e) => toast.error(errText(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => undefined);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Group by category; uncategorized templates go under a localized bucket.
  const groups = useMemo(() => {
    const map = new Map<string, Template[]>();
    for (const tpl of templates) {
      const key = tpl.category?.trim() || '';
      const list = map.get(key) ?? [];
      list.push(tpl);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === '') return 1; // uncategorized last
      if (b === '') return -1;
      return a.localeCompare(b);
    });
  }, [templates]);

  const categories = useMemo(
    () =>
      [...new Set(templates.map((x) => x.category?.trim()).filter(Boolean))]
        .sort() as string[],
    [templates],
  );

  async function onDelete(tpl: Template) {
    if (
      !(await confirm({
        title: t('templates.deleteTitle'),
        message: t('templates.deleteConfirm'),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    ) {
      return;
    }
    try {
      await deleteTemplate(tpl.id);
      toast.success(t('templates.deleted'));
      load();
    } catch (e) {
      toast.error(errText(e));
    }
  }

  return (
    <AppShell>
      <PageHeader
        title={t('templates.title')}
        subtitle={t('templates.subtitle')}
        action={
          isAdmin ? (
            <button onClick={() => setEditing('new')} className="btn-primary">
              {t('templates.new')}
            </button>
          ) : undefined
        }
      />

      <GuideCard
        storageKey="templates"
        title={t('templates.aboutTitle')}
        body={t('templates.aboutBody')}
        note={{ title: t('templates.noteTitle'), body: t('templates.noteBody') }}
      />

      {loading && <Spinner />}
      {!loading && templates.length === 0 && (
        <EmptyState>{t('templates.empty')}</EmptyState>
      )}

      <div className="space-y-8">
        {groups.map(([category, list]) => (
          <section key={category || '_uncat'}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              {category || t('templates.uncategorized')}
            </h2>
            <ul className="grid gap-4 md:grid-cols-2">
              {list.map((tpl) => {
                const descKey = DESC_KEYS[tpl.name];
                const description = descKey ? t(descKey) : tpl.description;
                return (
                  <Card key={tpl.id} hover>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-white">{tpl.name}</h3>
                      <span className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-neutral-400">
                        {typeLabel(tpl.type)} · :{tpl.defaultPort}
                      </span>
                    </div>
                    <p className="text-sm text-neutral-400">{description}</p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      {tpl.isBuiltIn ? (
                        <span className="inline-block rounded-md bg-white/5 px-2 py-0.5 text-xs text-neutral-500">
                          {t('templates.builtIn')}
                        </span>
                      ) : (
                        <span />
                      )}
                      {isAdmin && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditing(tpl)}
                            className="btn-ghost btn-sm"
                          >
                            {t('common.edit')}
                          </button>
                          <button
                            onClick={() => onDelete(tpl)}
                            className="btn-danger-ghost"
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {editing && (
        <TemplateModal
          template={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {dialog}
    </AppShell>
  );
}

const EMPTY_FORM: TemplateInput = {
  name: '',
  description: '',
  category: '',
  type: 'BACKEND',
  baseImage: '',
  dockerfilePath: '',
  installImage: '',
  installScript: '#!/bin/bash\nset -e\n',
  defaultBuildCommand: '',
  defaultRunCommand: '',
  defaultPort: 8080,
  healthcheckPath: '',
  variables: [],
};

function TemplateModal({
  template,
  categories,
  onClose,
  onSaved,
}: {
  template: Template | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TemplateInput>(() =>
    template
      ? {
          name: template.name,
          description: template.description ?? '',
          category: template.category ?? '',
          type: template.type,
          baseImage: template.baseImage,
          dockerfilePath: template.dockerfilePath ?? '',
          installImage: template.installImage,
          installScript: template.installScript,
          defaultBuildCommand: template.defaultBuildCommand,
          defaultRunCommand: template.defaultRunCommand,
          defaultPort: template.defaultPort,
          healthcheckPath: template.healthcheckPath ?? '',
          variables: template.variables ?? [],
        }
      : EMPTY_FORM,
  );

  function set<K extends keyof TemplateInput>(key: K, value: TemplateInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setVar(i: number, patch: Partial<TemplateVariable>) {
    setForm((f) => ({
      ...f,
      variables: f.variables.map((v, idx) =>
        idx === i ? { ...v, ...patch } : v,
      ),
    }));
  }

  function addVar() {
    setForm((f) => ({
      ...f,
      variables: [
        ...f.variables,
        { name: '', envVariable: '', defaultValue: '', description: '', rules: '' },
      ],
    }));
  }

  function removeVar(i: number) {
    setForm((f) => ({
      ...f,
      variables: f.variables.filter((_, idx) => idx !== i),
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload: TemplateInput = {
      ...form,
      name: form.name.trim(),
      variables: form.variables.filter(
        (v) => v.name.trim() && v.envVariable.trim(),
      ),
    };
    try {
      if (template) {
        await updateTemplate(template.id, payload);
        toast.success(t('templates.updated'));
      } else {
        await createTemplate(payload);
        toast.success(t('templates.created'));
      }
      onSaved();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={template ? t('templates.editTitle') : t('templates.new')}
      description={
        template?.isBuiltIn ? t('templates.editBuiltInHint') : undefined
      }
      onClose={onClose}
      className="max-w-3xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost">
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="template-form"
            disabled={saving}
            className="btn-primary"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      <form id="template-form" onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('templates.f.name')}>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="field w-full"
              required
              maxLength={100}
            />
          </Field>
          <Field label={t('templates.f.category')} hint={t('templates.f.categoryHint')}>
            <input
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              className="field w-full"
              list="template-categories"
              maxLength={60}
              placeholder={t('templates.uncategorized')}
            />
            <datalist id="template-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>

        <Field label={t('templates.f.description')}>
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className="field w-full"
            rows={2}
            maxLength={500}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('templates.f.type')}>
            <select
              value={form.type}
              onChange={(e) =>
                set('type', e.target.value as TemplateInput['type'])
              }
              className="field w-full"
            >
              <option value="BACKEND">BACKEND</option>
              <option value="FRONTEND">FRONTEND</option>
            </select>
          </Field>
          <Field label={t('templates.f.port')}>
            <input
              type="number"
              value={form.defaultPort}
              onChange={(e) => set('defaultPort', Number(e.target.value))}
              className="field w-full"
              min={1}
              max={65535}
              required
            />
          </Field>
          <Field label={t('templates.f.healthcheck')}>
            <input
              value={form.healthcheckPath}
              onChange={(e) => set('healthcheckPath', e.target.value)}
              className="field w-full"
              placeholder="/health"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('templates.f.baseImage')}>
            <input
              value={form.baseImage}
              onChange={(e) => set('baseImage', e.target.value)}
              className="field w-full font-mono"
              placeholder="eclipse-temurin:21-jre"
              required
            />
          </Field>
          <Field label={t('templates.f.installImage')}>
            <input
              value={form.installImage}
              onChange={(e) => set('installImage', e.target.value)}
              className="field w-full font-mono"
              placeholder="maven:3.9-eclipse-temurin-21"
              required
            />
          </Field>
        </div>

        <Field
          label={t('templates.f.dockerfilePath')}
          hint={t('templates.f.dockerfilePathHint')}
        >
          <input
            value={form.dockerfilePath}
            onChange={(e) => set('dockerfilePath', e.target.value)}
            className="field w-full font-mono"
            placeholder="templates/java/Dockerfile"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('templates.f.buildCommand')}>
            <input
              value={form.defaultBuildCommand}
              onChange={(e) => set('defaultBuildCommand', e.target.value)}
              className="field w-full font-mono"
              required
            />
          </Field>
          <Field label={t('templates.f.runCommand')}>
            <input
              value={form.defaultRunCommand}
              onChange={(e) => set('defaultRunCommand', e.target.value)}
              className="field w-full font-mono"
              required
            />
          </Field>
        </div>

        <Field
          label={t('templates.f.installScript')}
          hint={t('templates.f.installScriptHint')}
        >
          <textarea
            value={form.installScript}
            onChange={(e) => set('installScript', e.target.value)}
            className="field w-full font-mono text-xs"
            rows={5}
            required
          />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-400">
              {t('templates.f.variables')}
            </span>
            <button
              type="button"
              onClick={addVar}
              className="btn-ghost btn-sm"
            >
              {t('templates.f.addVariable')}
            </button>
          </div>
          {form.variables.length === 0 ? (
            <p className="text-xs text-neutral-600">
              {t('templates.f.noVariables')}
            </p>
          ) : (
            <div className="space-y-3">
              {form.variables.map((v, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-white/10 bg-white/[0.02] p-3"
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={v.name}
                      onChange={(e) => setVar(i, { name: e.target.value })}
                      className="field w-full"
                      placeholder={t('templates.f.varName')}
                    />
                    <input
                      value={v.envVariable}
                      onChange={(e) =>
                        setVar(i, { envVariable: e.target.value })
                      }
                      className="field w-full font-mono"
                      placeholder="ENV_VAR"
                    />
                    <input
                      value={v.defaultValue}
                      onChange={(e) =>
                        setVar(i, { defaultValue: e.target.value })
                      }
                      className="field w-full font-mono"
                      placeholder={t('templates.f.varDefault')}
                    />
                    <input
                      value={v.rules ?? ''}
                      onChange={(e) => setVar(i, { rules: e.target.value })}
                      className="field w-full font-mono"
                      placeholder="required|string"
                    />
                  </div>
                  <input
                    value={v.description ?? ''}
                    onChange={(e) =>
                      setVar(i, { description: e.target.value })
                    }
                    className="field mt-2 w-full"
                    placeholder={t('templates.f.varDescription')}
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeVar(i)}
                      className="text-xs text-red-400 transition-colors hover:text-red-300"
                    >
                      {t('common.remove')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
