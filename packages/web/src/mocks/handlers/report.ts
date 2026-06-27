import { http, HttpResponse } from 'msw';
import { fillPrintGrid } from '@zenith/shared';
import {
  mockReportDatasources, mockReportDatasets, mockReportDashboards, mockReportCategories,
  mockReportAlerts, mockReportPrintTemplates, mockReportSubscriptions, mockReportComments,
  mockReportVersions, mockReportShares,
  getMockDatasetData, buildDashboardData,
  getNextReportDatasourceId, getNextReportDatasetId, getNextReportDashboardId, getNextReportCategoryId,
  getNextReportAlertId, getNextReportPrintId, getNextReportSubscriptionId, getNextReportCommentId,
  getNextReportVersionId, getNextReportShareId,
} from '@/mocks/data/report';
import { mockDateTime } from '@/mocks/utils/date';
import type {
  ReportDatasource, ReportDataset, ReportDashboard, ReportDashboardCategory, ReportAlertRule,
  ReportPrintTemplate, ReportDashboardSubscription, ReportPrintGrid,
} from '@zenith/shared';

const ok = (data: unknown, message = 'ok') => HttpResponse.json({ code: 0, message, data });
const notFound = (message = '记录不存在') => HttpResponse.json({ code: 404, message, data: null });

function paginate<T>(list: T[], request: Request) {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page')) || 1;
  const pageSize = Number(url.searchParams.get('pageSize')) || 10;
  const total = list.length;
  return { list: list.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
}

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
    rows: [{ name: '示例A', value: 10 }, { name: '示例B', value: 20 }],
    total: 2,
  })),
  http.post('/api/report/datasets/:id/data', ({ params }) => ok(getMockDatasetData(Number(params.id)))),
  http.post('/api/report/datasets/:id/materialize', ({ params }) => {
    const d = mockReportDatasets.find((x) => x.id === Number(params.id));
    if (!d) return notFound('数据集不存在');
    const rows = getMockDatasetData(d.id).total ?? 0;
    return ok(null, `已刷新物化快照（${rows} 行）`);
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
      computedFields: body.computedFields ?? [], cacheTtl: body.cacheTtl ?? 0, status: body.status ?? 'enabled',
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
    const i = mockReportDatasets.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('数据集不存在');
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
      snapshot: { layout: dash.layout, canvasLayout: dash.canvasLayout, widgets: dash.widgets, filters: dash.filters, config: dash.config },
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
  http.post('/api/report/dashboards/:id/shares', ({ params }) => {
    const item = {
      id: getNextReportShareId(), dashboardId: Number(params.id), token: `demo${Math.random().toString(36).slice(2, 10)}`,
      enabled: true, hasPassword: false, expireAt: null, createdBy: 1, createdAt: mockDateTime(), updatedAt: mockDateTime(),
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

  http.get('/api/report/dashboards/:id/comments', ({ params }) =>
    ok(mockReportComments.filter((c) => c.dashboardId === Number(params.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))),
  http.post('/api/report/dashboards/:id/comments', async ({ params, request }) => {
    const body = await request.json() as { content?: string; widgetId?: string | null };
    const item = {
      id: getNextReportCommentId(), dashboardId: Number(params.id), widgetId: body.widgetId ?? null,
      content: body.content ?? '', userId: 1, userName: '管理员', userAvatar: null, createdAt: mockDateTime(),
    };
    mockReportComments.unshift(item);
    return ok(item, '发表成功');
  }),
  http.delete('/api/report/dashboards/:id/comments/:commentId', ({ params }) => {
    const i = mockReportComments.findIndex((c) => c.id === Number(params.commentId));
    if (i === -1) return notFound('评论不存在');
    mockReportComments.splice(i, 1);
    return ok(null, '删除成功');
  }),

  http.post('/api/report/dashboards/:id/data', ({ params }) => {
    const dash = mockReportDashboards.find((x) => x.id === Number(params.id));
    if (!dash) return notFound('仪表盘不存在');
    return ok(buildDashboardData(dash));
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
    const value = (data.rows ?? []).reduce((s, r) => s + Number(r[a.field ?? 'value'] ?? 0), 0);
    const triggered = a.op === 'gt' ? value > a.threshold : a.op === 'lt' ? value < a.threshold : value === a.threshold;
    a.lastCheckedAt = mockDateTime(); a.lastTriggered = triggered; a.lastValue = value;
    return ok({ value, triggered });
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
      field: body.field ?? null, aggregate: body.aggregate ?? 'sum', op: body.op ?? 'gt', threshold: body.threshold ?? 0,
      cron: body.cron ?? null, channels: body.channels ?? ['inApp'], recipients: body.recipients ?? null,
      enabled: body.enabled ?? true, lastCheckedAt: null, lastTriggered: null, lastValue: null,
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
    const grid = (t.content?.grid ?? { rows: 0, cols: 0, cells: [] }) as ReportPrintGrid;
    const rows = getMockDatasetData(t.datasetId).rows;
    const filled = fillPrintGrid(grid, rows);
    return ok({ name: t.name, grid: filled, pageConfig: t.pageConfig });
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
    s.lastRunAt = mockDateTime();
    return ok(null, '已推送');
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
      cron: body.cron ?? '0 8 * * *', channels: body.channels ?? ['email'], recipients: body.recipients ?? null,
      enabled: body.enabled ?? true, remark: body.remark ?? null, lastRunAt: null, createdBy: 1,
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

  // ─── 公开分享页（无需鉴权）───────────────────────────────
  http.post('/api/report/public/dashboards/:token/data', ({ params }) => {
    const share = mockReportShares.find((s) => s.token === params.token);
    const dash = mockReportDashboards.find((d) => d.id === (share?.dashboardId ?? 1)) ?? mockReportDashboards[0];
    return ok(dash ? buildDashboardData(dash) : {});
  }),
  http.post('/api/report/public/dashboards/:token', ({ params }) => {
    const share = mockReportShares.find((s) => s.token === params.token);
    const dash = mockReportDashboards.find((d) => d.id === (share?.dashboardId ?? 1)) ?? mockReportDashboards[0];
    if (!dash) return notFound('分享链接无效或已失效');
    return ok({
      name: dash.name, layout: dash.layout, canvasLayout: dash.canvasLayout,
      widgets: dash.widgets, filters: dash.filters, config: dash.config,
    });
  }),
];
