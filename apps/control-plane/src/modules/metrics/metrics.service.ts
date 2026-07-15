import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, lt } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { metricSamples } from '../../db/schema';
import { AgentClient, NodeRow } from '../nodes/agent.client';
import { MetricPoint } from './metrics.constants';

type SampleRow = typeof metricSamples.$inferSelect;

@Injectable()
export class MetricsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly agent: AgentClient,
  ) {}

  /** Polls a node's agent and records one host-metrics sample. */
  async sample(node: NodeRow): Promise<boolean> {
    const host = await this.agent.getHost(node);
    // Prefer a direct CPU utilisation reading (portable, incl. Windows); fall
    // back to deriving it from the Unix load average when that's all we have.
    const cpuPct =
      host.cpuUsedPerc != null
        ? Math.round(Math.min(100, Math.max(0, host.cpuUsedPerc)))
        : host.cpuCores && host.load1 != null
          ? Math.round(Math.min(100, (host.load1 / host.cpuCores) * 100))
          : null;
    const memPct = host.memUsedPerc != null ? Math.round(host.memUsedPerc) : null;
    const diskPct =
      host.diskUsedPerc != null ? Math.round(host.diskUsedPerc) : null;
    if (cpuPct == null && memPct == null && diskPct == null) return false;
    await this.db
      .insert(metricSamples)
      .values({ nodeId: node.id, cpuPct, memPct, diskPct });
    return true;
  }

  /** Returns a downsampled series (≈`buckets` points) for the given window. */
  async series(
    nodeId: string,
    sinceMs: number,
    buckets = 240,
  ): Promise<MetricPoint[]> {
    const from = Date.now() - sinceMs;
    const rows = await this.db
      .select()
      .from(metricSamples)
      .where(
        and(
          eq(metricSamples.nodeId, nodeId),
          gt(metricSamples.createdAt, new Date(from)),
        ),
      )
      .orderBy(asc(metricSamples.createdAt));
    return downsample(rows, from, Date.now(), buckets);
  }

  async prune(keepMs: number) {
    await this.db
      .delete(metricSamples)
      .where(lt(metricSamples.createdAt, new Date(Date.now() - keepMs)));
  }
}

/** Averages samples into fixed time buckets so charts stay light regardless of
 * the window length. */
function downsample(
  rows: SampleRow[],
  from: number,
  to: number,
  buckets: number,
): MetricPoint[] {
  if (rows.length === 0) return [];
  if (rows.length <= buckets) {
    return rows.map((r) => ({
      ts: r.createdAt.toISOString(),
      cpuPct: r.cpuPct,
      memPct: r.memPct,
      diskPct: r.diskPct,
    }));
  }
  const span = Math.max(1, to - from);
  const width = span / buckets;
  type Acc = { cpu: number; cpuN: number; mem: number; memN: number; disk: number; diskN: number; ts: number; n: number };
  const acc = new Map<number, Acc>();
  for (const r of rows) {
    const idx = Math.min(buckets - 1, Math.floor((r.createdAt.getTime() - from) / width));
    let a = acc.get(idx);
    if (!a) {
      a = { cpu: 0, cpuN: 0, mem: 0, memN: 0, disk: 0, diskN: 0, ts: 0, n: 0 };
      acc.set(idx, a);
    }
    if (r.cpuPct != null) { a.cpu += r.cpuPct; a.cpuN++; }
    if (r.memPct != null) { a.mem += r.memPct; a.memN++; }
    if (r.diskPct != null) { a.disk += r.diskPct; a.diskN++; }
    a.ts += r.createdAt.getTime();
    a.n++;
  }
  return [...acc.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([, a]) => ({
      ts: new Date(Math.round(a.ts / a.n)).toISOString(),
      cpuPct: a.cpuN ? Math.round(a.cpu / a.cpuN) : null,
      memPct: a.memN ? Math.round(a.mem / a.memN) : null,
      diskPct: a.diskN ? Math.round(a.disk / a.diskN) : null,
    }));
}
