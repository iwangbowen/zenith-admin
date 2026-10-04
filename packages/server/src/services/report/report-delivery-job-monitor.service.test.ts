import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createPgClient } from '../../db/client';
import { jobStuckItemSchema } from '@zenith/shared/platform';

const state = vi.hoisted(() => ({
  queries: [] as { sql: string; params: unknown[] }[],
  healthRows: [[2, 3, 9, 4, 1]] as unknown[][],
  listRows: [] as unknown[][],
}));

vi.mock('../../db', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy');
  const db = drizzle(async (query, params) => {
    state.queries.push({ sql: query, params });
    return { rows: query.startsWith('select count(*)') ? state.healthRows : state.listRows };
  }, { casing: 'snake_case' });
  return { db };
});
vi.mock('../messaging/email-send-logs.service', () => ({ sendEmail: vi.fn() }));
vi.mock('../messaging/in-app-messages.service', () => ({ sendInApp: vi.fn() }));
vi.mock('../../lib/webhook-notify', () => ({ sendWebhookNotification: vi.fn() }));

import {
  getReportDeliveryHealth,
  listStuckReportDeliveryRuns,
  stuckReportDeliveryRunCondition,
  taskManagedReportDeliveryCondition,
} from './report-delivery.service';

const asOf = new Date('2026-10-03T08:00:00.000Z');
const timestampAtAge = (ageMs: number) => new Date(asOf.getTime() - ageMs).toISOString();
// timestamptz 列在 UTC 会话下返回带偏移的时刻文本（驱动按偏移解析）
const timestampWithoutZoneAtAge = (ageMs: number) => timestampAtAge(ageMs).replace('T', ' ').replace('Z', '+00');

beforeEach(() => {
  state.queries = [];
  state.healthRows = [[2, 3, 9, 4, 1]];
  state.listRows = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('report delivery job monitor queries', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(asOf);
  });

  it('counts completed failed, successful and partial deliveries in the correct time windows', async () => {
    const health = await getReportDeliveryHealth();

    expect(health.counts).toEqual({ pending: 0, running: 0, stuck: 2, dead: null, failed24h: 3, succeeded24h: 9 });
    expect(health.failed1h).toBe(1);
    expect(health.oldestPendingAgeSec).toBeNull();
    expect(health.issues).toEqual([{ level: 'warn', message: '近 24 小时 4 次报表投递仅部分通道成功' }]);
    expect(state.queries).toHaveLength(1);

    const query = state.queries[0];
    const terminalFilters = [...query.sql.matchAll(/count\(\*\) filter \(where (?:"report_delivery_runs"\.)?"status" = '(failed|success|partial)' and (?:"report_delivery_runs"\.)?"completed_at" >= \$(\d+)\)::int/g)];
    expect(terminalFilters.map(match => [match[1], query.params[Number(match[2]) - 1]]), query.sql).toEqual([
      ['failed', timestampAtAge(86_400_000)],
      ['success', timestampAtAge(86_400_000)],
      ['partial', timestampAtAge(86_400_000)],
      ['failed', timestampAtAge(3_600_000)],
    ]);
    expect(query.sql).not.toContain('"created_at" >=');
    expect(query.sql).not.toContain('"tenant_id"');
    expect(query.params.some(value => value instanceof Date)).toBe(false);
  });

  it('reports no partial warning for zero counts or an empty aggregate response', async () => {
    state.healthRows = [[0, 0, 0, 0, 0]];
    expect((await getReportDeliveryHealth()).issues).toEqual([]);

    state.healthRows = [];
    const health = await getReportDeliveryHealth();
    expect(health.counts).toEqual({ pending: 0, running: 0, stuck: 0, dead: null, failed24h: 0, succeeded24h: 0 });
    expect(health.failed1h).toBe(0);
    expect(health.issues).toEqual([]);
  });

  it('projects lightweight stuck items, applies the limit and retains the business drilldown', async () => {
    state.listRows = [
      [17, '每日经营报表', 'subscription', 'running', timestampAtAge(3_600_000), timestampWithoutZoneAtAge(7_200_000), timestampWithoutZoneAtAge(300_000), '邮件通道执行超时'],
      [18, null, 'alert', 'pending', null, timestampWithoutZoneAtAge(600_000), timestampWithoutZoneAtAge(180_000), null],
    ];
    const items = await listStuckReportDeliveryRuns(11);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: 'report-delivery', refId: '17', title: '每日经营报表', status: 'running', ageSec: 3600,
      nodeId: null, detail: '邮件通道执行超时',
      drillDown: { path: '/report/subscriptions?tab=runs&status=running', label: '查看投递记录' },
    });
    expect(items[1]).toMatchObject({
      source: 'report-delivery', refId: '18', title: 'alert #18', status: 'pending', startedAt: null, ageSec: 600,
      detail: '关联任务已失联或运行超过 30 分钟',
      drillDown: { path: '/report/subscriptions?tab=runs&status=pending', label: '查看投递记录' },
    });
    for (const item of items) {
      expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
      expect(item).not.toHaveProperty('payloadSummary');
    }

    expect(state.queries).toHaveLength(1);
    const query = state.queries[0];
    const projection = query.sql.split(' from "report_delivery_runs"')[0];
    expect(projection).not.toContain('payload_summary');
    expect(projection).not.toContain('idempotency_key');
    expect(projection).not.toContain('recipients');
    expect(projection).not.toContain('*');
    expect(query.sql).toContain('order by "report_delivery_runs"."created_at", "report_delivery_runs"."id"');
    expect(query.sql).toMatch(/limit \$\d+$/);
    expect(query.params.at(-1)).toBe(11);
    expect(query.params.some(value => value instanceof Date)).toBe(false);
  });
});

type ReportRunFixture = {
  id: number;
  status: string;
  task_id: number | null;
  trigger_type: string;
  payload_summary: Record<string, unknown>;
  started_at: string | null;
  created_at: string;
};
type TaskFixture = { id: number; status: string; heartbeat_at: string | null; updated_at: string };

function runFixture(id: number, overrides: Partial<ReportRunFixture> = {}): ReportRunFixture {
  return {
    id, status: 'pending', task_id: 999, trigger_type: 'manual', payload_summary: {},
    started_at: null, created_at: timestampAtAge(600_000), ...overrides,
  };
}

async function evaluateRuns(runs: ReportRunFixture[], tasks: TaskFixture[] = []) {
  const client = createPgClient(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zenith_admin', {
    max: 1, onnotice: () => undefined,
  });
  try {
    const executor = drizzle(client, { casing: 'snake_case' });
    return await executor.execute<{ id: number; managed: boolean; stuck: boolean }>(sql`
      with async_tasks as (
        select * from jsonb_to_recordset(${JSON.stringify(tasks)}::jsonb)
          as x(id int, status text, heartbeat_at timestamptz, updated_at timestamptz)
      ), report_delivery_runs as (
        select * from jsonb_to_recordset(${JSON.stringify(runs)}::jsonb)
          as x(id int, status text, task_id int, trigger_type text, payload_summary jsonb, started_at timestamptz, created_at timestamptz)
      )
      select id, ${taskManagedReportDeliveryCondition()} as managed, ${stuckReportDeliveryRunCondition(asOf)} as stuck
      from report_delivery_runs order by id
    `);
  } finally {
    await client.end();
  }
}

describe.skipIf(process.env.RUN_JOB_MONITOR_DB_TESTS !== '1')('report delivery condition on PostgreSQL fixtures', () => {
  it('protects the two minute orphan grace and pending executor tasks', async () => {
    const tasks = [{ id: 1, status: 'pending', heartbeat_at: null, updated_at: timestampAtAge(86_400_000) }];
    const rows = await evaluateRuns([
      runFixture(1, { created_at: timestampAtAge(120_001) }),
      runFixture(2, { created_at: timestampAtAge(120_000) }),
      runFixture(3, { created_at: timestampAtAge(119_999) }),
      runFixture(4, { task_id: 1, created_at: timestampAtAge(86_400_000) }),
      runFixture(5, { status: 'running', started_at: timestampAtAge(119_999) }),
      runFixture(6, { status: 'running', started_at: timestampAtAge(120_001) }),
      runFixture(7, { status: 'success' }),
      runFixture(8, { status: 'partial' }),
      runFixture(9, { status: 'failed' }),
      runFixture(10, { status: 'cancelled' }),
    ], tasks);

    expect(rows.filter(row => row.stuck).map(row => row.id)).toEqual([1, 6]);
  });

  it('uses the ninety second heartbeat cutoff, falling back to updatedAt only for a missing heartbeat', async () => {
    const tasks: TaskFixture[] = [
      { id: 1, status: 'running', heartbeat_at: timestampAtAge(89_999), updated_at: timestampAtAge(600_000) },
      { id: 2, status: 'running', heartbeat_at: timestampAtAge(90_000), updated_at: timestampAtAge(600_000) },
      { id: 3, status: 'running', heartbeat_at: timestampAtAge(90_001), updated_at: timestampAtAge(10_000) },
      { id: 4, status: 'running', heartbeat_at: null, updated_at: timestampAtAge(90_000) },
      { id: 5, status: 'running', heartbeat_at: null, updated_at: timestampAtAge(90_001) },
      { id: 6, status: 'success', heartbeat_at: timestampAtAge(10_000), updated_at: timestampAtAge(10_000) },
    ];
    const rows = await evaluateRuns(tasks.map(task => runFixture(task.id, {
      task_id: task.id, status: 'running', started_at: timestampAtAge(600_000),
    })), tasks);

    expect(rows.filter(row => row.stuck).map(row => row.id)).toEqual([3, 5, 6]);
  });

  it('preserves synchronous schedules and retries, detects FK-null manual runs and applies every running timeout', async () => {
    const tasks = [{ id: 1, status: 'running', heartbeat_at: timestampAtAge(10_000), updated_at: timestampAtAge(10_000) }];
    const rows = await evaluateRuns([
      runFixture(1, { task_id: null, trigger_type: 'scheduled' }),
      runFixture(2, { task_id: null, trigger_type: 'retry' }),
      runFixture(3, { task_id: null, trigger_type: 'scheduled', status: 'running', started_at: timestampAtAge(600_000) }),
      runFixture(4, { task_id: null, trigger_type: 'retry', status: 'running', started_at: timestampAtAge(600_000) }),
      runFixture(5, { task_id: null }),
      runFixture(6, { task_id: null, trigger_type: 'trigger', payload_summary: { source: 'manual' } }),
      runFixture(7, { task_id: null, trigger_type: 'recover', payload_summary: { source: 'manual' } }),
      runFixture(8, { task_id: null, trigger_type: 'retry', payload_summary: { source: 'manual' } }),
      runFixture(9, { task_id: null, trigger_type: 'manual', created_at: timestampAtAge(119_999) }),
      runFixture(10, { task_id: null, trigger_type: 'scheduled', status: 'running', started_at: timestampAtAge(1_800_001) }),
      runFixture(11, { task_id: null, trigger_type: 'retry', status: 'running', started_at: timestampAtAge(1_800_001) }),
      runFixture(12, { task_id: 1, trigger_type: 'manual', status: 'running', started_at: timestampAtAge(1_800_001) }),
      runFixture(13, { task_id: 1, trigger_type: 'scheduled', status: 'running', started_at: timestampAtAge(1_800_000) }),
      runFixture(14, { task_id: null, trigger_type: 'scheduled', status: 'running', started_at: timestampAtAge(1_800_000) }),
      runFixture(15, { task_id: 999, trigger_type: 'scheduled' }),
    ], tasks);

    expect(rows.filter(row => row.managed).map(row => row.id)).toEqual([5, 6, 7, 8, 9, 12, 13, 15]);
    expect(rows.filter(row => row.stuck).map(row => row.id)).toEqual([5, 6, 7, 8, 10, 11, 12, 15]);
  });
});
