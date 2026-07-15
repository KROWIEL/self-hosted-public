'use client';

import { useEffect, useState } from 'react';
import { MetricPoint, Node, getNodeMetrics, listNodes } from '@/lib/api';
import { AppShell } from '@/components/shell';
import { useEntitlements } from '@/components/entitlements';
import { UpgradeNotice } from '@/components/upgrade-notice';
import {
  Card,
  EmptyState,
  ErrorBox,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { useErrorText, useI18n } from '@/i18n';

const RANGES: { key: string; hours: number }[] = [
  { key: '24h', hours: 24 },
  { key: '7d', hours: 168 },
  { key: '30d', hours: 720 },
];

export default function MetricsPage() {
  return (
    <AppShell>
      <MetricsContent />
    </AppShell>
  );
}

function MetricsContent() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { has } = useEntitlements();
  const unlocked = has('metrics-history');

  const [nodes, setNodes] = useState<Node[]>([]);
  const [nodeId, setNodeId] = useState<string>('');
  const [hours, setHours] = useState(24);
  const [points, setPoints] = useState<MetricPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!unlocked) {
      setLoading(false);
      return;
    }
    listNodes()
      .then((n) => {
        setNodes(n);
        if (n.length) setNodeId((cur) => cur || n[0].id);
      })
      .catch((e) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked || !nodeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getNodeMetrics(nodeId, hours)
      .then(setPoints)
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, nodeId, hours]);

  if (!unlocked) {
    return (
      <>
        <PageHeader
          title={t('metricsHistory.title')}
          subtitle={t('metricsHistory.subtitle')}
        />
        <UpgradeNotice
          tier="pro"
          featureTitle={t('metricsHistory.lockedTitle')}
          featureBody={t('metricsHistory.lockedBody')}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('metricsHistory.title')} subtitle={t('metricsHistory.subtitle')} />

      {error && <ErrorBox message={error} />}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={nodeId}
          onChange={(e) => setNodeId(e.target.value)}
          className="field"
        >
          {nodes.length === 0 && <option value="">—</option>}
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1 rounded-lg border border-white/10 p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setHours(r.hours)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                hours === r.hours
                  ? 'bg-white/10 text-white'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>

      {loading && <Spinner />}
      {!loading && points.length === 0 && (
        <EmptyState>{t('metricsHistory.empty')}</EmptyState>
      )}
      {!loading && points.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-1">
          <MetricChart
            title={t('metricsHistory.cpu')}
            color="#6366f1"
            points={points.map((p) => ({ ts: p.ts, value: p.cpuPct }))}
          />
          <MetricChart
            title={t('metricsHistory.mem')}
            color="#10b981"
            points={points.map((p) => ({ ts: p.ts, value: p.memPct }))}
          />
          <MetricChart
            title={t('metricsHistory.disk')}
            color="#f59e0b"
            points={points.map((p) => ({ ts: p.ts, value: p.diskPct }))}
          />
        </div>
      )}
    </>
  );
}

function MetricChart({
  title,
  color,
  points,
}: {
  title: string;
  color: string;
  points: { ts: string; value: number | null }[];
}) {
  const n = points.length;
  const last = [...points].reverse().find((p) => p.value != null)?.value ?? null;

  const coords = points.map((p, i) => ({
    x: n <= 1 ? 0 : (i / (n - 1)) * 100,
    y: p.value == null ? null : 100 - Math.max(0, Math.min(100, p.value)),
  }));

  // Build a line path, breaking across gaps (null values).
  let line = '';
  let pen = false;
  for (const c of coords) {
    if (c.y == null) {
      pen = false;
      continue;
    }
    line += `${pen ? 'L' : 'M'}${c.x.toFixed(2)} ${c.y.toFixed(2)} `;
    pen = true;
  }

  // Area under the line (only when a single continuous segment exists).
  const firstX = coords.find((c) => c.y != null)?.x ?? 0;
  const lastX = [...coords].reverse().find((c) => c.y != null)?.x ?? 100;
  const area = line
    ? `${line}L${lastX.toFixed(2)} 100 L${firstX.toFixed(2)} 100 Z`
    : '';

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span className="font-mono text-sm text-neutral-300">
          {last == null ? '—' : `${last}%`}
        </span>
      </div>
      <div className="relative h-40 w-full">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full"
        >
          {[25, 50, 75].map((g) => (
            <line
              key={g}
              x1="0"
              y1={g}
              x2="100"
              y2={g}
              stroke="currentColor"
              strokeWidth="0.3"
              className="text-white/10"
            />
          ))}
          {area && <path d={area} fill={color} fillOpacity={0.12} />}
          {line && (
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          )}
        </svg>
      </div>
    </Card>
  );
}
