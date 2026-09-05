import { describe, expect, it } from 'vitest';
import type { PaginatedResponse } from '@zenith/shared/core';
import type { ReportChatbiMessage, ReportChatbiSession, ReportFillRecord, ReportFillTemplate, ReportMetric, ReportQueryQuotaUsage, ReportResourceAcl } from '@zenith/shared/report';
import type { AsyncTask } from '@zenith/shared/tasks';
import { asyncTasksHandlers } from '@/mocks/handlers/async-tasks';
import { reportChatbiHandlers } from '@/mocks/handlers/report-chatbi';
import { reportFillHandlers } from '@/mocks/handlers/report-fill';
import { reportPlatformHandlers } from '@/mocks/handlers/report-platform';
import { reportQualityCapacityHandlers } from '@/mocks/handlers/report-quality-capacity';

const ORIGIN = window.location.origin;
const p2Handlers = [
  ...reportPlatformHandlers,
  ...reportQualityCapacityHandlers,
  ...reportChatbiHandlers,
  ...reportFillHandlers,
  ...asyncTasksHandlers,
];

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

async function call<T>(method: string, path: string, body?: unknown, rawBody?: string): Promise<ApiEnvelope<T>> {
  for (const handler of p2Handlers) {
    const request = new Request(`${ORIGIN}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: rawBody ?? (body == null ? undefined : JSON.stringify(body)),
    });
    const result = await (handler as unknown as {
      run: (args: unknown) => Promise<{ response?: Response } | null>;
    }).run({ request, requestId: `p2-${Math.random()}` });
    if (result?.response) return result.response.json() as Promise<ApiEnvelope<T>>;
  }
  throw new Error(`no handler matched ${method} ${path}`);
}

describe('report P2 platform handlers', () => {
  it('supports metric revision, publish, evaluate, refs, and filtered pagination', async () => {
    const created = await call<ReportMetric>('POST', '/api/report/metrics', {
      code: 'demo_contract_metric',
      name: 'Demo 合同指标',
      type: 'simple',
      datasetId: 2,
      sourceField: 'value',
      aggregate: 'sum',
      dimensions: ['name'],
      folderId: 4,
    });
    expect(created.data.revision).toBe(1);

    const updated = await call<ReportMetric>('PUT', `/api/report/metrics/${created.data.id}`, {
      name: 'Demo 合同指标 v2',
      expectedRevision: 1,
    });
    expect(updated.data.revision).toBe(2);

    const published = await call<ReportMetric>('POST', `/api/report/metrics/${created.data.id}/publish`, {
      expectedRevision: 2,
    });
    expect(published.data.lifecycleStatus).toBe('published');
    expect(published.data.publishedSnapshot).not.toBeNull();

    const evaluated = await call<{ value: number }>('POST', `/api/report/metrics/${created.data.id}/evaluate`, {});
    expect(evaluated.data.value).toBeGreaterThan(0);
    const refs = await call<{ dashboards: unknown[]; alerts: unknown[]; metrics: unknown[] }>(
      'GET',
      `/api/report/metrics/${created.data.id}/refs`,
    );
    expect(refs.data).toEqual(expect.objectContaining({ dashboards: expect.any(Array), alerts: expect.any(Array) }));

    const page = await call<PaginatedResponse<ReportMetric>>(
      'GET',
      '/api/report/metrics?status=published&page=1&pageSize=1',
    );
    expect(page.data.pageSize).toBe(1);
    expect(page.data.list).toHaveLength(1);
    expect(page.data.total).toBeGreaterThanOrEqual(2);
  });

  it('returns folder tree plus ACL and approval contract shapes', async () => {
    const tree = await call<Array<{ resourceType: string; children: unknown[] }>>(
      'GET',
      '/api/report/folders/tree?resourceType=metric',
    );
    expect(tree.data.every((folder) => folder.resourceType === 'metric')).toBe(true);

    const acl = await call<ReportResourceAcl>('POST', '/api/report/governance/acls', {
      resourceType: 'metric',
      resourceId: 1,
      subjectType: 'user',
      subjectId: 2,
      role: 'viewer',
      inheritFromFolder: false,
    });
    expect(acl.data).toEqual(expect.objectContaining({ grantedBy: 1, role: 'viewer' }));
    const access = await call<{ allowed: boolean; requiredRole: string }>(
      'POST',
      '/api/report/governance/access/check',
      { resourceType: 'metric', resourceId: 1, requiredRole: 'owner' },
    );
    expect(access.data).toEqual({ allowed: true, requiredRole: 'owner' });

    const approval = await call<{ id: number; status: string }>('POST', '/api/report/governance/approvals', {
      resourceType: 'metric',
      resourceId: 1,
      action: 'publish',
      requestedRevision: 1,
      snapshot: { revision: 1 },
    });
    const decided = await call<{ status: string }>(
      'POST',
      `/api/report/governance/approvals/${approval.data.id}/decision`,
      { decision: 'approved', note: 'Demo 验收通过' },
    );
    expect(decided.data.status).toBe('approved');
  });
});

describe('report P2 quality and capacity handlers', () => {
  it('submits DQ/materialization/SLA tasks and progresses through task center', async () => {
    const dq = await call<AsyncTask>('POST', '/api/report/dq/rules/1/run', { sampleLimit: 5 });
    expect(dq.data.taskType).toBe('report-dq-rule-run');
    expect(dq.data.status).toBe('running');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const progressed = await call<AsyncTask>('GET', `/api/async-tasks/${dq.data.id}`);
    expect(progressed.data.processedCount).toBeGreaterThan(0);

    const materialize = await call<AsyncTask>(
      'POST',
      '/api/report/materializations/datasets/2/refresh',
      { strategy: 'full' },
    );
    expect(materialize.data.taskType).toBe('report-dataset-materialize');
    const sla = await call<AsyncTask>('POST', '/api/report/sla/rules/1/evaluate');
    expect(sla.data.taskType).toBe('report-sla-rule-evaluate');

    const taskTypes = await call<Array<{ taskType: string }>>('GET', '/api/async-tasks/types');
    expect(taskTypes.data.map((item) => item.taskType)).toEqual(expect.arrayContaining([
      'report-dq-rule-run',
      'report-dataset-materialize',
      'report-sla-rule-evaluate',
      'report-fill-sync',
    ]));
  });

  it('returns quota limits/usage and reusable asset application shapes', async () => {
    const unsafeRule = await call<null>('POST', '/api/report/dq/rules', {
      datasetId: 2,
      name: '越权质量规则',
      type: 'custom_sql',
      severity: 'high',
      config: { sql: 'SELECT row FROM users' },
      enabled: true,
    });
    expect(unsafeRule.code).toBe(400);

    const quota = await call<PaginatedResponse<{ id: number }>>(
      'GET',
      '/api/report/query-capacity/quotas?page=1&pageSize=10',
    );
    expect(quota.data.list[0].id).toBe(1);
    const usage = await call<ReportQueryQuotaUsage>(
      'GET',
      '/api/report/query-capacity/quotas/1/usage?scopeDate=2026-06-01',
    );
    expect(usage.data).toEqual(expect.objectContaining({
      maxConcurrent: 20,
      dailyQueryLimit: 0,
      day: '2026-06-01',
    }));

    const applied = await call<{ name: string; resourceType: string; resourceId: number }>(
      'POST',
      '/api/report/assets/templates/1/apply',
      { name: '合同测试仪表盘', folderId: 3 },
    );
    expect(applied.data).toEqual(expect.objectContaining({
      name: '合同测试仪表盘',
      resourceType: 'dashboard',
      resourceId: expect.any(Number),
    }));
  });
});

describe('report P2 ChatBI handlers', () => {
  it('rejects malformed/write requests and supports safe ask, quota, and save', async () => {
    const malformed = await call<null>('POST', '/api/report/chatbi/sessions', undefined, '{"title":');
    expect(malformed.code).toBe(400);

    const session = await call<ReportChatbiSession>('POST', '/api/report/chatbi/sessions', {
      title: 'Demo 安全分析',
      datasetId: 2,
      allowedTables: ['departments'],
    });
    expect(session.data.allowedTables).toEqual(['departments']);
    const denied = await call<null>('POST', `/api/report/chatbi/sessions/${session.data.id}/ask`, {
      content: 'delete from users',
    });
    expect(denied.code).toBe(400);

    const answer = await call<ReportChatbiMessage>(
      'POST',
      `/api/report/chatbi/sessions/${session.data.id}/ask`,
      { content: '各部门人数', requestChart: true },
    );
    expect(answer.data.generatedSql).toMatch(/^SELECT /);
    const saved = await call<{ resourceType: string; datasetId: number }>(
      'POST',
      `/api/report/chatbi/messages/${answer.data.id}/save`,
      { resourceType: 'dataset', name: '部门分析数据集' },
    );
    expect(saved.data).toEqual(expect.objectContaining({ resourceType: 'dataset', datasetId: expect.any(Number) }));
    const quota = await call<{ aiRequestsToday: number; queryCountToday: number }>('GET', '/api/report/chatbi/quotas/me');
    expect(quota.data.aiRequestsToday).toBeGreaterThan(0);
    expect(quota.data.queryCountToday).toBeGreaterThan(0);
  });
});

describe('report P2 fill handlers', () => {
  it('supports template clone/publish and fill submit/review/sync linkage', async () => {
    const clone = await call<ReportFillTemplate>('POST', '/api/report/fill/templates/1/clone', {
      code: 'monthly_operation_fill_contract',
      name: '月度运营数据填报副本',
      folderId: 7,
    });
    expect(clone.data.status).toBe('draft');
    const published = await call<ReportFillTemplate>(
      'POST',
      `/api/report/fill/templates/${clone.data.id}/lifecycle`,
      { action: 'publish', expectedRevision: 1 },
    );
    expect(published.data.publishedSchema?.fields.length).toBeGreaterThan(0);

    const created = await call<ReportFillRecord>('POST', '/api/report/fill/records', {
      templateId: 1,
      data: {
        period: '2026-06',
        department: '运营部',
        activeUsers: 1280,
        revenue: 268000,
      },
    });
    const submitted = await call<ReportFillRecord>(
      'POST',
      `/api/report/fill/records/${created.data.id}/submit`,
      { expectedRevision: 1, comment: '合同测试提交' },
    );
    expect(submitted.data.status).toBe('submitted');
    const reviewed = await call<ReportFillRecord>(
      'POST',
      `/api/report/fill/records/${created.data.id}/review`,
      { decision: 'approved', expectedRevision: 2, comment: '合同测试通过' },
    );
    expect(reviewed.data).toEqual(expect.objectContaining({
      status: 'approved',
      syncStatus: 'succeeded',
      generatedDatasetId: expect.any(Number),
      syncTaskId: expect.any(Number),
    }));
    const task = await call<AsyncTask>('GET', `/api/async-tasks/${reviewed.data.syncTaskId}`);
    expect(task.data.taskType).toBe('report-fill-sync');
  });

  it('enforces required fields and withdrawal FSM', async () => {
    const invalid = await call<ReportFillRecord>('POST', '/api/report/fill/records', {
      templateId: 1,
      data: { department: '运营部' },
    });
    const invalidSubmit = await call<null>(
      'POST',
      `/api/report/fill/records/${invalid.data.id}/submit`,
      { expectedRevision: 1 },
    );
    expect(invalidSubmit.code).toBe(400);

    const valid = await call<ReportFillRecord>('POST', '/api/report/fill/records', {
      templateId: 1,
      data: { period: '2026-07', department: '产品部', activeUsers: 88, revenue: 12000 },
    });
    const withdrawn = await call<ReportFillRecord>(
      'POST',
      `/api/report/fill/records/${valid.data.id}/withdraw`,
      { expectedRevision: 1, reason: '重新填写' },
    );
    expect(withdrawn.data.status).toBe('cancelled');
  });
});
