import { http, HttpResponse } from 'msw';
import { renderPrintContent } from '@zenith/shared';
import {
  mockReportDatasources, mockReportDatasets, mockReportDashboards, mockReportCategories,
  mockReportAlerts, mockReportPrintTemplates, mockReportSubscriptions, mockReportComments,
  mockReportVersions, mockReportShares,
  getMockDatasetData, buildDashboardData,
  getNextReportDatasourceId, getNextReportDatasetId, getNextReportDashboardId, getNextReportCategoryId,
  getNextReportAlertId, getNextReportPrintId, getNextReportSubscriptionId, getNextReportCommentId,
  getNextReportVersionId, getNextReportShareId,
} from '@/mocks/data/report';
import { createImmediateMockTask } from '@/mocks/handlers/async-tasks';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import type {
  ReportDatasource, ReportDataset, ReportDashboard, ReportDashboardCategory, ReportAlertRule,
  ReportPrintTemplate, ReportDashboardSubscription, ReportDeliveryRun,
} from '@zenith/shared';

const ok = (data: unknown, message = 'ok') => HttpResponse.json({ code: 0, message, data });
const notFound = (message = '记录不存在') => HttpResponse.json({ code: 404, message, data: null });

function applyDatasetQuery(data: ReturnType<typeof getMockDatasetData>, query?: { limit?: number; page?: number; pageSize?: number; sortField?: string; sortOrder?: 'asc' | 'desc' }) {
  const rows = [...data.rows];
  if (query?.sortField && data.columns.includes(query.sortField)) {
    const dir = query.sortOrder === 'asc' ? 1 : -1;
    rows.sort((a, b) => String(a[query.sortField!] ?? '').localeCompare(String(b[query.sortField!] ?? ''), 'zh-CN', { numeric: true }) * dir);
  }
  if (query?.page && query?.pageSize) {
    const start = (query.page - 1) * query.pageSize;
    return { ...data, rows: rows.slice(start, start + query.pageSize), total: data.total ?? rows.length };
  }
  const limit = query?.limit ?? data.rows.length;
  return { ...data, rows: rows.slice(0, limit), total: data.total ?? rows.length };
}

function paginate<T>(list: T[], request: Request) {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page')) || 1;
  const pageSize = Number(url.searchParams.get('pageSize')) || 10;
  const total = list.length;
  return { list: list.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
}

let nextDeliveryRunId = 8000;
const mockDeliveryRuns: ReportDeliveryRun[] = [
  {
    id: nextDeliveryRunId++,
    targetType: 'subscription',
    subscriptionId: 1,
    dashboardId: 1,
    targetName: '示例仪表盘',
    triggerType: 'scheduled',
    status: 'success',
    idempotencyKey: 'mock-subscription-1',
    attempt: 1,
    maxAttempts: 3,
    durationMs: 1200,
    errorMessage: null,
    payloadSummary: { dashboardName: '示例仪表盘', channelCount: 1 },
    startedAt: mockDateTimeOffset(-86400000),
    completedAt: mockDateTimeOffset(-86398800),
    nextRetryAt: null,
    createdAt: mockDateTimeOffset(-86400000),
    updatedAt: mockDateTimeOffset(-86398800),
  },
  {
    id: nextDeliveryRunId++,
    targetType: 'alert',
    alertRuleId: 1,
    datasetId: 1,
    targetName: '菜单总数异常预警',
    triggerType: 'scheduled',
    status: 'success',
    idempotencyKey: 'mock-alert-1',
    attempt: 1,
    maxAttempts: 3,
    durationMs: 900,
    errorMessage: null,
    payloadSummary: { ruleName: '菜单总数异常预警' },
    lastValue: 86,
    triggered: false,
    startedAt: mockDateTimeOffset(-3600000),
    completedAt: mockDateTimeOffset(-3599000),
    nextRetryAt: null,
    createdAt: mockDateTimeOffset(-3600000),
    updatedAt: mockDateTimeOffset(-3599000),
  },
];


export const reportHandlers = [
  // ─── 数据源 ───────────────────────────────────────────────
  http.post('/api/report/datasources/test', () => ok({ ok: true, message: '连接成功（Demo 模拟）', latencyMs: 12 })),
  http.get('/api/report/datasources', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const type = url.searchParams.get('type') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const list = mockReportDatasources.filter((d) =>
      (!keyword || d.name.includes(keyword)) && (!type || d.type === type) && (!status || d.status === status));
    return ok(paginate(list, request));
  }),
  http.get('/api/report/datasources/:id', ({ params }) => {
    const d = mockReportDatasources.find((x) => x.id === Number(params.id));
    return d ? ok(d) : notFound('数据源不存在');
  }),
  http.post('/api/report/datasources', async ({ request }) => {
    const body = await request.json() as Partial<ReportDatasource>;
    const item: ReportDatasource = {
      id: getNextReportDatasourceId(), name: body.name ?? '未命名数据源', type: body.type ?? 'sql',
      config: body.config ?? {}, status: body.status ?? 'enabled', remark: body.remark ?? null,
      createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportDatasources.push(item);
    return ok(item, '新增成功');
  }),
  http.put('/api/report/datasources/:id', async ({ params, request }) => {
    const d = mockReportDatasources.find((x) => x.id === Number(params.id));
    if (!d) return notFound('数据源不存在');
    Object.assign(d, await request.json(), { updatedAt: mockDateTime() });
    return ok(d, '更新成功');
  }),
  http.delete('/api/report/datasources/:id', ({ params }) => {
    const i = mockReportDatasources.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('数据源不存在');
    mockReportDatasources.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ─── 数据集 ───────────────────────────────────────────────
  http.post('/api/report/datasets/preview', () => ok(getMockDatasetData(1))),
  http.post('/api/report/datasets/parse-file', () => ok({
    columns: ['name', 'value'],
    fields: [{ name: 'name', label: 'name', type: 'string', source: 'inferred' }, { name: 'value', label: 'value', type: 'string', source: 'inferred' }],
    rows: [{ name: '示例A', value: 10 }, { name: '示例B', value: 20 }],
    total: 2,
  })),
  http.post('/api/report/datasets/:id/data', async ({ params, request }) => {
    const body = await request.json().catch(() => ({})) as { limit?: number; page?: number; pageSize?: number; sortField?: string; sortOrder?: 'asc' | 'desc' };
    return ok(applyDatasetQuery(getMockDatasetData(Number(params.id)), body));
  }),
  http.post('/api/report/datasets/:id/materialize', ({ params }) => {
    const d = mockReportDatasets.find((x) => x.id === Number(params.id));
    if (!d) return notFound('数据集不存在');
    return ok({
      id: d.id,
      taskType: 'report-dataset-materialize',
      title: `刷新物化快照 · ${d.name}`,
      module: '报表中心',
      status: 'pending',
      payload: { datasetId: d.id },
      totalCount: null,
      processedCount: 0,
      failedCount: 0,
      progressNote: '任务已提交',
      result: null,
      errorMessage: null,
      cancelRequested: false,
      attempts: 0,
      maxAttempts: 1,
      nextRunAt: null,
      createdBy: 1,
      createdByName: '管理员',
      tenantId: null,
      startedAt: null,
      completedAt: null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    }, '任务已提交，可在任务中心查看进度');
  }),
  // 血缘：扫描 mock 仪表盘 widgets/filters + 打印模板 + 预警
  http.get('/api/report/datasets/:id/refs', ({ params }) => {
    const id = Number(params.id);
    if (!mockReportDatasets.some((x) => x.id === id)) return notFound('数据集不存在');
    const dashboards = mockReportDashboards
      .map((d) => ({
        id: d.id,
        name: d.name,
        widgets: (d.widgets ?? []).filter((w) => w.datasetId === id).map((w) => w.title || w.i),
        filterIds: (d.filters ?? []).filter((f) => f.optionSource?.kind === 'dataset' && f.optionSource.datasetId === id).map((f) => f.label || f.id),
      }))
      .filter((d) => d.widgets.length || d.filterIds.length);
    return ok({
      dashboards,
      printTemplates: mockReportPrintTemplates.filter((t) => t.datasetId === id).map((t) => ({ id: t.id, name: t.name })),
      alerts: mockReportAlerts.filter((a) => a.datasetId === id).map((a) => ({ id: a.id, name: a.name })),
    });
  }),
  // 可视化建模元数据（Demo 固定表清单）
  http.get('/api/report/meta/tables', () => ok(['departments', 'dict_items', 'dicts', 'menus', 'positions', 'roles'])),
  http.get('/api/report/meta/tables/:table/columns', ({ params }) => {
    const columns: Record<string, Array<{ name: string; type: string }>> = {
      menus: [{ name: 'id', type: 'integer' }, { name: 'title', type: 'varchar' }, { name: 'type', type: 'varchar' }, { name: 'status', type: 'varchar' }, { name: 'sort', type: 'integer' }],
      departments: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'varchar' }, { name: 'category', type: 'varchar' }, { name: 'status', type: 'varchar' }],
      roles: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'varchar' }, { name: 'code', type: 'varchar' }, { name: 'status', type: 'varchar' }],
      positions: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'varchar' }, { name: 'code', type: 'varchar' }, { name: 'status', type: 'varchar' }],
      dicts: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'varchar' }, { name: 'code', type: 'varchar' }],
      dict_items: [{ name: 'id', type: 'integer' }, { name: 'label', type: 'varchar' }, { name: 'value', type: 'varchar' }, { name: 'sort', type: 'integer' }],
    };
    const cols = columns[String(params.table)];
    return cols ? ok(cols) : notFound('表不存在或不可访问');
  }),
  http.get('/api/report/datasets', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const datasourceId = url.searchParams.get('datasourceId');
    const status = url.searchParams.get('status') ?? '';
    const list = mockReportDatasets.filter((d) =>
      (!keyword || d.name.includes(keyword))
      && (!datasourceId || d.datasourceId === Number(datasourceId))
      && (!status || d.status === status));
    return ok(paginate(list, request));
  }),
  http.get('/api/report/datasets/:id', ({ params }) => {
    const d = mockReportDatasets.find((x) => x.id === Number(params.id));
    return d ? ok(d) : notFound('数据集不存在');
  }),
  http.post('/api/report/datasets', async ({ request }) => {
    const body = await request.json() as Partial<ReportDataset>;
    const item: ReportDataset = {
      id: getNextReportDatasetId(), name: body.name ?? '未命名数据集', datasourceId: body.datasourceId ?? 1,
      type: body.type ?? 'sql', content: body.content ?? {}, fields: body.fields ?? [], params: body.params ?? [],
      computedFields: body.computedFields ?? [], cacheTtl: body.cacheTtl ?? 0, rowRules: body.rowRules ?? [], status: body.status ?? 'enabled',
      remark: body.remark ?? null, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportDatasets.push(item);
    return ok(item, '新增成功');
  }),
  http.put('/api/report/datasets/:id', async ({ params, request }) => {
    const d = mockReportDatasets.find((x) => x.id === Number(params.id));
    if (!d) return notFound('数据集不存在');
    Object.assign(d, await request.json(), { updatedAt: mockDateTime() });
    return ok(d, '更新成功');
  }),
  http.delete('/api/report/datasets/:id', ({ params }) => {
    const id = Number(params.id);
    const i = mockReportDatasets.findIndex((x) => x.id === id);
    if (i === -1) return notFound('数据集不存在');
    // 与后端一致：存在下游引用时拒绝删除
    const refDash = mockReportDashboards.filter((d) =>
      (d.widgets ?? []).some((w) => w.datasetId === id)
      || (d.filters ?? []).some((f) => f.optionSource?.kind === 'dataset' && f.optionSource.datasetId === id));
    const refPrint = mockReportPrintTemplates.filter((t) => t.datasetId === id);
    const refAlert = mockReportAlerts.filter((a) => a.datasetId === id);
    const parts: string[] = [];
    if (refDash.length) parts.push(`仪表盘 ${refDash.map((d) => `《${d.name}》`).join('、')}`);
    if (refPrint.length) parts.push(`打印报表 ${refPrint.map((t) => `《${t.name}》`).join('、')}`);
    if (refAlert.length) parts.push(`预警规则 ${refAlert.map((a) => `《${a.name}》`).join('、')}`);
    if (parts.length) return HttpResponse.json({ code: 400, message: `该数据集正被引用，无法删除：${parts.join('；')}。请先在「血缘」中查看并解除引用`, data: null });
    mockReportDatasets.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ─── 仪表盘 · 版本/收藏/分享/评论（需在 /:id 之前）─────────────
  http.get('/api/report/dashboards/:id/versions', ({ params }) =>
    ok(mockReportVersions.filter((v) => v.dashboardId === Number(params.id)))),
  http.post('/api/report/dashboards/:id/versions', async ({ params, request }) => {
    const dash = mockReportDashboards.find((x) => x.id === Number(params.id));
    if (!dash) return notFound('仪表盘不存在');
    const body = await request.json().catch(() => ({})) as { remark?: string };
    const existing = mockReportVersions.filter((v) => v.dashboardId === dash.id);
    const item = {
      id: getNextReportVersionId(), dashboardId: dash.id, version: existing.length + 1,
      snapshot: { name: dash.name, layout: dash.layout, canvasLayout: dash.canvasLayout, widgets: dash.widgets, filters: dash.filters, config: dash.config, categoryId: dash.categoryId ?? null, remark: dash.remark ?? null },
      source: 'manual' as const,
      remark: body.remark ?? null, createdBy: 1, createdAt: mockDateTime(),
    };
    mockReportVersions.push(item);
    return ok(item, '已保存版本');
  }),
  http.post('/api/report/dashboards/:id/versions/:versionId/restore', () => ok(null, '已恢复到该版本')),

  http.post('/api/report/dashboards/:id/favorite', ({ params }) => {
    const dash = mockReportDashboards.find((x) => x.id === Number(params.id));
    if (!dash) return notFound('仪表盘不存在');
    dash.favorited = !dash.favorited;
    return ok({ favorited: dash.favorited }, dash.favorited ? '已收藏' : '已取消收藏');
  }),

  http.get('/api/report/dashboards/:id/shares', ({ params }) =>
    ok(mockReportShares.filter((s) => s.dashboardId === Number(params.id)))),
  http.post('/api/report/dashboards/:id/shares', async ({ params, request }) => {
    const body = await request.json().catch(() => ({})) as { password?: string; expireAt?: string | null };
    // 与后端一致：未传 expireAt 默认 30 天；显式 null = 永久
    const expireAt = body.expireAt === undefined ? mockDateTimeOffset(30 * 24 * 3600 * 1000) : body.expireAt;
    const item = {
      id: getNextReportShareId(), dashboardId: Number(params.id), token: `demo${Math.random().toString(36).slice(2, 10)}`,
      enabled: true, hasPassword: !!body.password, expireAt, accessCount: 0, lastAccessAt: null,
      createdBy: 1, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportShares.push(item);
    return ok(item, '已创建分享链接');
  }),
  http.put('/api/report/dashboards/shares/:shareId', async ({ params, request }) => {
    const s = mockReportShares.find((x) => x.id === Number(params.shareId));
    if (!s) return notFound('分享链接不存在');
    Object.assign(s, await request.json(), { updatedAt: mockDateTime() });
    return ok(s, '更新成功');
  }),
  http.delete('/api/report/dashboards/shares/:shareId', ({ params }) => {
    const i = mockReportShares.findIndex((x) => x.id === Number(params.shareId));
    if (i === -1) return notFound('分享链接不存在');
    mockReportShares.splice(i, 1);
    return ok(null, '删除成功');
  }),

  http.get('/api/report/dashboards/:id/comments', ({ params, request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const widgetId = url.searchParams.get('widgetId') ?? undefined;
    const list = mockReportComments.filter((c) => c.dashboardId === Number(params.id) && (!widgetId || c.widgetId === widgetId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return ok({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),
  http.post('/api/report/dashboards/:id/comments', async ({ params, request }) => {
    const body = await request.json() as { content?: string; widgetId?: string | null; parentId?: number | null };
    const item = {
      id: getNextReportCommentId(), dashboardId: Number(params.id), widgetId: body.widgetId ?? null, parentId: body.parentId ?? null,
      content: body.content ?? '', userId: 1, userName: '管理员', userAvatar: null, updatedAt: mockDateTime(), createdAt: mockDateTime(), replies: [], canEdit: true, canDelete: true, canResolve: true,
    };
    mockReportComments.unshift(item);
    return ok(item, '发表成功');
  }),
  http.put('/api/report/dashboards/:id/comments/:commentId', async ({ params, request }) => {
    const item = mockReportComments.find((c) => c.id === Number(params.commentId));
    if (!item) return notFound('评论不存在');
    const body = await request.json() as { content?: string };
    item.content = body.content ?? item.content;
    item.updatedAt = mockDateTime();
    return ok(item, '更新成功');
  }),
  http.post('/api/report/dashboards/:id/comments/:commentId/resolve', async ({ params, request }) => {
    const item = mockReportComments.find((c) => c.id === Number(params.commentId));
    if (!item) return notFound('评论不存在');
    const body = await request.json() as { resolved?: boolean };
    item.resolvedAt = body.resolved ? mockDateTime() : null;
    return ok(item, '操作成功');
  }),
  http.delete('/api/report/dashboards/:id/comments/:commentId', ({ params }) => {
    const i = mockReportComments.findIndex((c) => c.id === Number(params.commentId));
    if (i === -1) return notFound('评论不存在');
    mockReportComments.splice(i, 1);
    return ok(null, '删除成功');
  }),

  http.post('/api/report/dashboards/:id/data', async ({ params, request }) => {
    const dash = mockReportDashboards.find((x) => x.id === Number(params.id));
    if (!dash) return notFound('仪表盘不存在');
    const body = await request.json().catch(() => ({})) as { limit?: number; widgetQueries?: Record<string, { limit?: number; page?: number; pageSize?: number; sortField?: string; sortOrder?: 'asc' | 'desc' }> };
    const data = buildDashboardData(dash);
    for (const widget of dash.widgets ?? []) {
      if (!widget.datasetId || !data[widget.i]?.data) continue;
      data[widget.i] = {
        ...data[widget.i],
        data: applyDatasetQuery(data[widget.i].data!, widget.type === 'table' ? body.widgetQueries?.[widget.i] : { limit: body.limit }),
      };
    }
    return ok(data);
  }),

  // ─── 仪表盘 CRUD ─────────────────────────────────────────
  http.get('/api/report/dashboards', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const categoryId = url.searchParams.get('categoryId');
    const favorited = url.searchParams.get('favorited');
    const list = mockReportDashboards.filter((d) =>
      (!keyword || d.name.includes(keyword))
      && (!status || d.status === status)
      && (!categoryId || d.categoryId === Number(categoryId))
      && (favorited == null || favorited === '' || (favorited === 'true' ? !!d.favorited : true)));
    return ok(paginate(list, request));
  }),
  http.get('/api/report/dashboards/:id', ({ params }) => {
    const d = mockReportDashboards.find((x) => x.id === Number(params.id));
    return d ? ok(d) : notFound('仪表盘不存在');
  }),
  http.post('/api/report/dashboards', async ({ request }) => {
    const body = await request.json() as Partial<ReportDashboard>;
    const item: ReportDashboard = {
      id: getNextReportDashboardId(), name: body.name ?? '未命名仪表盘', layout: body.layout ?? [],
      canvasLayout: body.canvasLayout ?? [], widgets: body.widgets ?? [], filters: body.filters ?? [],
      config: body.config ?? {}, categoryId: body.categoryId ?? null, status: body.status ?? 'enabled',
      lifecycleStatus: 'draft', revision: 1,
      remark: body.remark ?? null, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportDashboards.push(item);
    return ok(item, '新增成功');
  }),
  http.put('/api/report/dashboards/:id', async ({ params, request }) => {
    const d = mockReportDashboards.find((x) => x.id === Number(params.id));
    if (!d) return notFound('仪表盘不存在');
    Object.assign(d, await request.json(), { updatedAt: mockDateTime() });
    return ok(d, '更新成功');
  }),
  http.delete('/api/report/dashboards/:id', ({ params }) => {
    const i = mockReportDashboards.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('仪表盘不存在');
    mockReportDashboards.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ─── 分类 ─────────────────────────────────────────────────
  http.get('/api/report/categories', () => ok([...mockReportCategories].sort((a, b) => a.sort - b.sort))),
  http.post('/api/report/categories', async ({ request }) => {
    const body = await request.json() as Partial<ReportDashboardCategory>;
    const item: ReportDashboardCategory = {
      id: getNextReportCategoryId(), name: body.name ?? '未命名分类', sort: body.sort ?? 0,
      remark: body.remark ?? null, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportCategories.push(item);
    return ok(item, '新增成功');
  }),
  http.put('/api/report/categories/:id', async ({ params, request }) => {
    const c = mockReportCategories.find((x) => x.id === Number(params.id));
    if (!c) return notFound('分类不存在');
    Object.assign(c, await request.json(), { updatedAt: mockDateTime() });
    return ok(c, '更新成功');
  }),
  http.delete('/api/report/categories/:id', ({ params }) => {
    const i = mockReportCategories.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('分类不存在');
    mockReportCategories.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ─── 数据预警 ─────────────────────────────────────────────
  http.post('/api/report/alerts/:id/evaluate', ({ params }) => {
    const a = mockReportAlerts.find((x) => x.id === Number(params.id));
    if (!a) return notFound('预警规则不存在');
    const data = getMockDatasetData(a.datasetId);
    const rows = data.rows ?? [];
    const compareOne = (value: number) => a.op === 'gt' ? value > a.threshold : a.op === 'lt' ? value < a.threshold : value === a.threshold;
    let value: number;
    let triggered: boolean;
    let hits: Array<{ group: string; value: number }> | undefined;
    if (a.groupByField) {
      const groups = new Map<string, number>();
      for (const r of rows) {
        const key = String(r[a.groupByField] ?? '（空）');
        groups.set(key, (groups.get(key) ?? 0) + Number(r[a.field ?? 'value'] ?? 0));
      }
      hits = [...groups.entries()].filter(([, v]) => compareOne(v)).map(([group, v]) => ({ group, value: v }));
      triggered = hits.length > 0;
      value = hits.length ? Math.max(...hits.map((h) => h.value)) : Math.max(0, ...groups.values());
    } else {
      value = rows.reduce((s, r) => s + Number(r[a.field ?? 'value'] ?? 0), 0);
      triggered = compareOne(value);
    }
    const now = mockDateTime();
    a.lastCheckedAt = now; a.lastTriggered = triggered; a.lastValue = value;
    a.lastDeliveryAt = now; a.lastDeliveryStatus = 'success'; a.lastDeliveryError = null;
    const run: ReportDeliveryRun = {
      id: nextDeliveryRunId++,
      targetType: 'alert',
      alertRuleId: a.id,
      datasetId: a.datasetId,
      targetName: a.name,
      triggerType: triggered ? 'trigger' : 'manual',
      status: 'success',
      idempotencyKey: `mock-alert-${a.id}-${Date.now()}`,
      attempt: 1,
      maxAttempts: 3,
      durationMs: 800,
      errorMessage: null,
      payloadSummary: { value, triggered, hitCount: hits?.length ?? 0 },
      lastValue: value,
      triggered,
      startedAt: now,
      completedAt: now,
      nextRetryAt: null,
      createdAt: now,
      updatedAt: now,
    };
    mockDeliveryRuns.unshift(run);
    return ok(createImmediateMockTask({
      taskType: 'report-alert-evaluate',
      title: `手动评估预警 · ${a.name}`,
      description: '报表预警异步评估任务',
      allowConcurrent: false,
      payload: { alertRuleId: a.id },
      maxAttempts: 3,
    }), '任务已提交，可在任务中心查看进度');
  }),
  http.get('/api/report/alerts', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const list = mockReportAlerts.filter((a) => !keyword || a.name.includes(keyword));
    return ok(paginate(list, request));
  }),
  http.get('/api/report/alerts/:id', ({ params }) => {
    const a = mockReportAlerts.find((x) => x.id === Number(params.id));
    return a ? ok(a) : notFound('预警规则不存在');
  }),
  http.post('/api/report/alerts', async ({ request }) => {
    const body = await request.json() as Partial<ReportAlertRule>;
    const item: ReportAlertRule = {
      id: getNextReportAlertId(), name: body.name ?? '未命名预警', datasetId: body.datasetId ?? 1,
      field: body.field ?? null, groupByField: body.groupByField ?? null,
      aggregate: body.aggregate ?? 'sum', op: body.op ?? 'gt', threshold: body.threshold ?? 0,
      cron: body.cron ?? null, timezone: body.timezone ?? 'Asia/Shanghai', misfirePolicy: body.misfirePolicy ?? 'fire_once', nextRunAt: body.cron ? mockDateTimeOffset(3600000) : null, channels: body.channels ?? ['inApp'], recipients: body.recipients ?? null,
      webhookUrl: body.webhookUrl ?? null,
      silenceMins: body.silenceMins ?? 60, notifyOnRecover: body.notifyOnRecover ?? false,
      enabled: body.enabled ?? true, lastCheckedAt: null, lastTriggered: null, lastValue: null, lastNotifiedAt: null, lastDeliveryAt: null, lastDeliveryStatus: null, lastDeliveryError: null,
      remark: body.remark ?? null, createdBy: 1, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportAlerts.push(item);
    return ok(item, '新增成功');
  }),
  http.put('/api/report/alerts/:id', async ({ params, request }) => {
    const a = mockReportAlerts.find((x) => x.id === Number(params.id));
    if (!a) return notFound('预警规则不存在');
    Object.assign(a, await request.json(), { updatedAt: mockDateTime() });
    return ok(a, '更新成功');
  }),
  http.delete('/api/report/alerts/:id', ({ params }) => {
    const i = mockReportAlerts.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('预警规则不存在');
    mockReportAlerts.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ─── AI（NL2SQL）────────────────────────────────────────
  http.post('/api/report/ai/nl2sql', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { question?: string };
    const q = body.question ?? '';
    const sql = `-- Demo 模拟生成（输入：${q || '（空）'}）\nSELECT type AS name, count(*)::int AS value\nFROM menus\nGROUP BY type\nORDER BY value DESC`;
    return ok({ sql });
  }),

  // ─── 打印报表 ─────────────────────────────────────────────
  http.post('/api/report/print/:id/render', ({ params }) => {
    const t = mockReportPrintTemplates.find((x) => x.id === Number(params.id));
    if (!t) return notFound('打印模板不存在');
    const rows = getMockDatasetData(t.datasetId).rows;
    return ok(renderPrintContent(t.name, t.content, rows, {}, t.pageConfig));
  }),
  http.get('/api/report/print', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const list = mockReportPrintTemplates.filter((t) => !keyword || t.name.includes(keyword));
    return ok(paginate(list, request));
  }),
  http.get('/api/report/print/:id', ({ params }) => {
    const t = mockReportPrintTemplates.find((x) => x.id === Number(params.id));
    return t ? ok(t) : notFound('打印模板不存在');
  }),
  http.post('/api/report/print', async ({ request }) => {
    const body = await request.json() as Partial<ReportPrintTemplate>;
    const item: ReportPrintTemplate = {
      id: getNextReportPrintId(), name: body.name ?? '未命名模板', datasetId: body.datasetId ?? null,
      content: body.content ?? {}, params: body.params ?? [], pageConfig: body.pageConfig ?? { paper: 'A4', orientation: 'portrait' },
      status: body.status ?? 'enabled', remark: body.remark ?? null, createdBy: 1, updatedBy: 1,
      createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportPrintTemplates.push(item);
    return ok(item, '新增成功');
  }),
  http.put('/api/report/print/:id', async ({ params, request }) => {
    const t = mockReportPrintTemplates.find((x) => x.id === Number(params.id));
    if (!t) return notFound('打印模板不存在');
    Object.assign(t, await request.json(), { updatedAt: mockDateTime() });
    return ok(t, '更新成功');
  }),
  http.delete('/api/report/print/:id', ({ params }) => {
    const i = mockReportPrintTemplates.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('打印模板不存在');
    mockReportPrintTemplates.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ─── 订阅推送 ─────────────────────────────────────────────
  http.post('/api/report/subscriptions/:id/run', ({ params }) => {
    const s = mockReportSubscriptions.find((x) => x.id === Number(params.id));
    if (!s) return notFound('订阅不存在');
    const now = mockDateTime();
    s.lastRunAt = now;
    s.lastDeliveryAt = now;
    s.lastDeliveryStatus = 'success';
    s.lastDeliveryError = null;
    mockDeliveryRuns.unshift({
      id: nextDeliveryRunId++,
      targetType: 'subscription',
      subscriptionId: s.id,
      dashboardId: s.dashboardId,
      targetName: s.dashboardName ?? '订阅',
      triggerType: 'manual',
      status: 'success',
      idempotencyKey: `mock-subscription-${s.id}-${Date.now()}`,
      attempt: 1,
      maxAttempts: 3,
      durationMs: 1200,
      errorMessage: null,
      payloadSummary: { dashboardName: s.dashboardName },
      startedAt: now,
      completedAt: now,
      nextRetryAt: null,
      createdAt: now,
      updatedAt: now,
    });
    return ok(createImmediateMockTask({
      taskType: 'report-subscription-deliver',
      title: `立即推送订阅 · #${s.id}`,
      description: '报表订阅异步推送任务',
      allowConcurrent: false,
      payload: { subscriptionId: s.id },
      maxAttempts: 3,
    }), '任务已提交，可在任务中心查看进度');
  }),
  http.get('/api/report/subscriptions', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const list = mockReportSubscriptions.filter((s) => !keyword || (s.dashboardName ?? '').includes(keyword));
    return ok(paginate(list, request));
  }),
  http.post('/api/report/subscriptions', async ({ request }) => {
    const body = await request.json() as Partial<ReportDashboardSubscription>;
    const dash = mockReportDashboards.find((d) => d.id === body.dashboardId);
    const item: ReportDashboardSubscription = {
      id: getNextReportSubscriptionId(), dashboardId: body.dashboardId ?? 1, dashboardName: dash?.name ?? null,
      cron: body.cron ?? '0 8 * * *', timezone: body.timezone ?? 'Asia/Shanghai', misfirePolicy: body.misfirePolicy ?? 'fire_once', nextRunAt: body.cron ? mockDateTimeOffset(86400000) : null, channels: body.channels ?? ['email'], recipients: body.recipients ?? null, webhookUrl: body.webhookUrl ?? null,
      enabled: body.enabled ?? true, remark: body.remark ?? null, lastRunAt: null, lastDeliveryAt: null, lastDeliveryStatus: null, lastDeliveryError: null, createdBy: 1,
      createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportSubscriptions.push(item);
    return ok(item, '新增成功');
  }),
  http.put('/api/report/subscriptions/:id', async ({ params, request }) => {
    const s = mockReportSubscriptions.find((x) => x.id === Number(params.id));
    if (!s) return notFound('订阅不存在');
    Object.assign(s, await request.json(), { updatedAt: mockDateTime() });
    return ok(s, '更新成功');
  }),
  http.delete('/api/report/subscriptions/:id', ({ params }) => {
    const i = mockReportSubscriptions.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('订阅不存在');
    mockReportSubscriptions.splice(i, 1);
    return ok(null, '删除成功');
  }),

  http.get('/api/report/delivery-runs', ({ request }) => {
    const url = new URL(request.url);
    const targetType = url.searchParams.get('targetType');
    const subscriptionId = Number(url.searchParams.get('subscriptionId') || 0);
    const alertRuleId = Number(url.searchParams.get('alertRuleId') || 0);
    const list = mockDeliveryRuns.filter((item) =>
      (!targetType || item.targetType === targetType)
      && (!subscriptionId || item.subscriptionId === subscriptionId)
      && (!alertRuleId || item.alertRuleId === alertRuleId));
    return ok(paginate(list, request));
  }),
  http.post('/api/report/delivery-runs/:id/acknowledge', async ({ params, request }) => {
    const run = mockDeliveryRuns.find((item) => item.id === Number(params.id));
    if (!run || run.targetType !== 'alert') return notFound('告警投递记录不存在');
    const body = await request.json().catch(() => ({})) as { note?: string };
    run.acknowledgedAt = mockDateTime();
    run.acknowledgedBy = 1;
    run.acknowledgedByName = '管理员';
    run.acknowledgeNote = body.note ?? null;
    run.updatedAt = mockDateTime();
    return ok(run, '确认成功');
  }),

  // ─── 公开分享页（无需鉴权）───────────────────────────────
  http.post('/api/report/public/dashboards/:token/access', ({ params }) => {
    const share = mockReportShares.find((s) => s.token === params.token);
    const dash = mockReportDashboards.find((d) => d.id === (share?.dashboardId ?? 1)) ?? mockReportDashboards[0];
    if (!dash) return notFound('分享链接无效或已失效');
    return ok({
      accessSessionToken: `demo-session-${params.token}`,
      expiresAt: mockDateTimeOffset(15 * 60 * 1000),
      dashboard: {
        name: dash.name, layout: dash.layout, canvasLayout: dash.canvasLayout,
        widgets: dash.widgets, filters: dash.filters, config: dash.config, filterOptions: {},
      },
    });
  }),
  http.post('/api/report/public/dashboards/:token/data', async ({ params, request }) => {
    const share = mockReportShares.find((s) => s.token === params.token);
    const dash = mockReportDashboards.find((d) => d.id === (share?.dashboardId ?? 1)) ?? mockReportDashboards[0];
    const body = await request.json().catch(() => ({})) as { limit?: number; widgetQueries?: Record<string, { limit?: number; page?: number; pageSize?: number; sortField?: string; sortOrder?: 'asc' | 'desc' }> };
    const data = dash ? buildDashboardData(dash) : {};
    if (dash) {
      for (const widget of dash.widgets ?? []) {
        if (!widget.datasetId || !data[widget.i]?.data) continue;
        data[widget.i] = {
          ...data[widget.i],
          data: applyDatasetQuery(data[widget.i].data!, widget.type === 'table' ? body.widgetQueries?.[widget.i] : { limit: body.limit }),
        };
      }
    }
    return ok(data);
  }),
  http.get('/api/report/public/dashboards/:token', ({ params }) => {
    const share = mockReportShares.find((s) => s.token === params.token);
    const dash = mockReportDashboards.find((d) => d.id === (share?.dashboardId ?? 1)) ?? mockReportDashboards[0];
    if (!dash) return notFound('分享链接无效或已失效');
    return ok({
      name: dash.name, layout: dash.layout, canvasLayout: dash.canvasLayout,
      widgets: dash.widgets, filters: dash.filters, config: dash.config, filterOptions: {},
    });
  }),
  http.post('/api/report/public/dashboards/:token', ({ params }) => {
    const share = mockReportShares.find((s) => s.token === params.token);
    const dash = mockReportDashboards.find((d) => d.id === (share?.dashboardId ?? 1)) ?? mockReportDashboards[0];
    if (!dash) return notFound('分享链接无效或已失效');
    return ok({
      name: dash.name, layout: dash.layout, canvasLayout: dash.canvasLayout,
      widgets: dash.widgets, filters: dash.filters, config: dash.config, filterOptions: {},
    });
  }),
  http.get('/api/report/public/embed/:token', ({ params }) => {
    const share = mockReportShares.find((s) => s.token === params.token);
    const dash = mockReportDashboards.find((d) => d.id === (share?.dashboardId ?? 1)) ?? mockReportDashboards[0];
    if (!dash) return notFound('嵌入令牌无效');
    return ok({
      name: dash.name, layout: dash.layout, canvasLayout: dash.canvasLayout,
      widgets: dash.widgets, filters: dash.filters, config: dash.config, filterOptions: {},
    });
  }),
  http.post('/api/report/public/embed/:token/data', async ({ params, request }) => {
    const share = mockReportShares.find((s) => s.token === params.token);
    const dash = mockReportDashboards.find((d) => d.id === (share?.dashboardId ?? 1)) ?? mockReportDashboards[0];
    const body = await request.json().catch(() => ({})) as { limit?: number; widgetQueries?: Record<string, { limit?: number; page?: number; pageSize?: number; sortField?: string; sortOrder?: 'asc' | 'desc' }> };
    const data = dash ? buildDashboardData(dash) : {};
    if (dash) {
      for (const widget of dash.widgets ?? []) {
        if (!widget.datasetId || !data[widget.i]?.data) continue;
        data[widget.i] = {
          ...data[widget.i],
          data: applyDatasetQuery(data[widget.i].data!, widget.type === 'table' ? body.widgetQueries?.[widget.i] : { limit: body.limit }),
        };
      }
    }
    return ok(data);
  }),
];
