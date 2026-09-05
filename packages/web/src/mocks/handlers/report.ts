import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mock } from '@/mocks/utils/contract';
import {
  renderPrintContent,
  reportAiContract,
  reportAlertContract,
  reportCategoryContract,
  reportDashboardContract,
  reportDashboardOpsContract,
  reportDatasetContract,
  reportDatasourceContract,
  reportDeliveryRunContract,
  reportMetaContract,
  reportPrintContract,
  reportPublicContract,
  reportSubscriptionContract,
} from '@zenith/shared/report';
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
  ReportAlertRule,
  ReportDashboard,
  ReportDashboardCategory,
  ReportDashboardData,
  ReportDashboardSubscription,
  ReportDataset,
  ReportDatasetQueryOptions,
  ReportDatasource,
  ReportDeliveryRun,
  ReportPrintRenderResult,
  ReportPrintResolvedSubreport,
  ReportPrintTemplate,
  ReportPublicDashboard,
} from '@zenith/shared/report';

function applyDatasetQuery(data: ReturnType<typeof getMockDatasetData>, query?: Pick<ReportDatasetQueryOptions, 'limit' | 'page' | 'pageSize' | 'sortField' | 'sortOrder'>) {
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

/** 按仪表盘取数请求体裁剪各组件数据：表格组件用组件级查询，其余用全局 limit */
function buildDashboardDataFor(
  dash: ReportDashboard,
  body: { limit?: number; widgetQueries?: Record<string, ReportDatasetQueryOptions> },
): ReportDashboardData {
  const data = buildDashboardData(dash);
  for (const widget of dash.widgets ?? []) {
    if (!widget.datasetId || !data[widget.i]?.data) continue;
    data[widget.i] = {
      ...data[widget.i],
      data: applyDatasetQuery(data[widget.i].data!, widget.type === 'table' ? body.widgetQueries?.[widget.i] : { limit: body.limit }),
    };
  }
  return data;
}

function toPublicDashboard(dash: ReportDashboard): ReportPublicDashboard {
  return {
    name: dash.name, layout: dash.layout, canvasLayout: dash.canvasLayout,
    widgets: dash.widgets, filters: dash.filters, config: dash.config, filterOptions: {},
  };
}

/** 分享 / 嵌入令牌对应的仪表盘；Demo 中未登记的令牌回落到首个仪表盘 */
function resolveSharedDashboard(token: string) {
  const share = mockReportShares.find((s) => s.token === token);
  return mockReportDashboards.find((d) => d.id === (share?.dashboardId ?? 1)) ?? mockReportDashboards[0];
}

function renderMockPrintTemplate(
  template: ReportPrintTemplate,
  params: Record<string, unknown>,
  limit: number,
  path: number[] = [],
  overrideRows?: Record<string, unknown>[],
): ReportPrintRenderResult {
  if (path.includes(template.id) || path.length >= 3) throw new Error('子报表存在循环引用或超过 3 层');
  const rows = overrideRows ?? getMockDatasetData(template.datasetId).rows.slice(0, limit);
  const bindings = template.content.datasetBindings ?? [];
  const datasets = Object.fromEntries(bindings.map((binding) => [
    binding.key.toLowerCase(),
    getMockDatasetData(binding.datasetId).rows.slice(0, Math.min(limit, binding.rowLimit ?? limit)),
  ]));
  const resolvedSubreports: ReportPrintResolvedSubreport[] = [];
  for (const sheet of template.content.sheets ?? [{ id: 'sheet-01', grid: template.content.grid ?? { rows: 1, cols: 1, cells: [] } }]) {
    for (const cell of sheet.grid.cells) {
      if (!cell.subreport) continue;
      const child = mockReportPrintTemplates.find((item) => item.id === cell.subreport?.templateId);
      if (!child) throw new Error(`子报表模板 #${cell.subreport.templateId} 不存在`);
      const childParams = Object.fromEntries(Object.entries(cell.subreport.paramBindings ?? {}).map(([target, source]) => [target, params[source]]));
      const childRows = cell.subreport.datasetKey
        ? (cell.subreport.datasetKey.toLowerCase() === 'main' ? rows : datasets[cell.subreport.datasetKey.toLowerCase()])
        : undefined;
      if (cell.subreport.datasetKey && !childRows) throw new Error(`子报表数据集绑定 ${cell.subreport.datasetKey} 不存在`);
      resolvedSubreports.push({
        sheetId: sheet.id,
        row: cell.row,
        col: cell.col,
        templateId: child.id,
        result: renderMockPrintTemplate(child, childParams, limit, [...path, template.id], childRows),
      });
    }
  }
  return renderPrintContent(template.name, template.content, rows, params, template.pageConfig, {
    datasets,
    bindings,
    subreports: resolvedSubreports,
    renderedAt: mockDateTime(),
  });
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

/** Demo 固定的可视化建模元数据（内置库表 / 列清单） */
const META_TABLES = ['departments', 'dict_items', 'dicts', 'menus', 'positions', 'roles'];
const META_COLUMNS: Record<string, Array<{ name: string; type: string }>> = {
  menus: [{ name: 'id', type: 'integer' }, { name: 'title', type: 'varchar' }, { name: 'type', type: 'varchar' }, { name: 'status', type: 'varchar' }, { name: 'sort', type: 'integer' }],
  departments: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'varchar' }, { name: 'category', type: 'varchar' }, { name: 'status', type: 'varchar' }],
  roles: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'varchar' }, { name: 'code', type: 'varchar' }, { name: 'status', type: 'varchar' }],
  positions: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'varchar' }, { name: 'code', type: 'varchar' }, { name: 'status', type: 'varchar' }],
  dicts: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'varchar' }, { name: 'code', type: 'varchar' }],
  dict_items: [{ name: 'id', type: 'integer' }, { name: 'label', type: 'varchar' }, { name: 'value', type: 'varchar' }, { name: 'sort', type: 'integer' }],
};

export const reportHandlers = [
  // ─── 数据源 ───────────────────────────────────────────────
  mock(reportDatasourceContract.test, ({ ok }) => ok({ ok: true, message: '连接成功（Demo 模拟）', latencyMs: 12 })),
  mock(reportDatasourceContract.list, ({ query, ok, paginate }) => {
    const list = mockReportDatasources.filter((d) =>
      (!query.keyword || d.name.includes(query.keyword)) && (!query.type || d.type === query.type) && (!query.status || d.status === query.status));
    return ok(paginate(list));
  }),
  mock(reportDatasourceContract.detail, ({ params, ok }) => {
    const d = mockReportDatasources.find((x) => x.id === params.id);
    return d ? ok(d) : notFound('数据源不存在');
  }),
  mock(reportDatasourceContract.create, ({ body, ok }) => {
    const item: ReportDatasource = {
      id: getNextReportDatasourceId(), name: body.name, type: body.type,
      config: body.config as ReportDatasource['config'], status: body.status, remark: body.remark ?? null,
      createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportDatasources.push(item);
    return ok(item, '新增成功');
  }),
  mock(reportDatasourceContract.update, ({ params, body, ok }) => {
    const d = mockReportDatasources.find((x) => x.id === params.id);
    if (!d) return notFound('数据源不存在');
    Object.assign(d, body, { updatedAt: mockDateTime() });
    return ok(d, '更新成功');
  }),
  mock(reportDatasourceContract.remove, ({ params, ok }) => {
    const i = mockReportDatasources.findIndex((x) => x.id === params.id);
    if (i === -1) return notFound('数据源不存在');
    mockReportDatasources.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ─── 数据集 ───────────────────────────────────────────────
  mock(reportDatasetContract.preview, ({ ok }) => ok(getMockDatasetData(1))),
  mock(reportDatasetContract.parseFile, ({ ok }) => ok({
    columns: ['name', 'value'],
    fields: [{ name: 'name', label: 'name', type: 'string', source: 'inferred' }, { name: 'value', label: 'value', type: 'string', source: 'inferred' }],
    rows: [{ name: '示例A', value: 10 }, { name: '示例B', value: 20 }],
    total: 2,
  })),
  mock(reportDatasetContract.data, ({ params, body, ok }) => ok(applyDatasetQuery(getMockDatasetData(params.id), body))),
  mock(reportDatasetContract.materialize, ({ params, ok }) => {
    const d = mockReportDatasets.find((x) => x.id === params.id);
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
      traceId: null,
      startedAt: null,
      completedAt: null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    }, '任务已提交，可在任务中心查看进度');
  }),
  // 血缘：扫描 mock 仪表盘 widgets/filters + 打印模板 + 预警
  mock(reportDatasetContract.refs, ({ params, ok }) => {
    const id = params.id;
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
      metrics: [],
      alerts: mockReportAlerts.filter((a) => a.datasetId === id).map((a) => ({ id: a.id, name: a.name })),
    });
  }),
  // 可视化建模元数据（Demo 固定表清单）
  mock(reportMetaContract.tables, ({ ok }) => ok(META_TABLES)),
  mock(reportMetaContract.columns, ({ params, ok }) => {
    const cols = META_COLUMNS[params.table];
    return cols ? ok(cols) : notFound('表不存在或不可访问');
  }),
  mock(reportDatasetContract.list, ({ query, ok, paginate }) => {
    const list = mockReportDatasets.filter((d) =>
      (!query.keyword || d.name.includes(query.keyword))
      && (!query.datasourceId || d.datasourceId === query.datasourceId)
      && (!query.status || d.status === query.status));
    return ok(paginate(list));
  }),
  mock(reportDatasetContract.detail, ({ params, ok }) => {
    const d = mockReportDatasets.find((x) => x.id === params.id);
    return d ? ok(d) : notFound('数据集不存在');
  }),
  mock(reportDatasetContract.create, ({ body, ok }) => {
    const datasource = mockReportDatasources.find((x) => x.id === body.datasourceId);
    const item: ReportDataset = {
      id: getNextReportDatasetId(), name: body.name, datasourceId: body.datasourceId,
      type: datasource?.type ?? 'sql', content: body.content as ReportDataset['content'], fields: body.fields, params: body.params,
      computedFields: body.computedFields, cacheTtl: body.cacheTtl, rowRules: body.rowRules, status: body.status,
      remark: body.remark ?? null, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportDatasets.push(item);
    return ok(item, '新增成功');
  }),
  mock(reportDatasetContract.update, ({ params, body, ok }) => {
    const d = mockReportDatasets.find((x) => x.id === params.id);
    if (!d) return notFound('数据集不存在');
    Object.assign(d, body, { updatedAt: mockDateTime() });
    return ok(d, '更新成功');
  }),
  mock(reportDatasetContract.remove, ({ params, ok }) => {
    const id = params.id;
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
    if (parts.length) return badRequest(`该数据集正被引用，无法删除：${parts.join('；')}。请先在「血缘」中查看并解除引用`);
    mockReportDatasets.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ─── 仪表盘 · 版本/收藏/分享/评论（需在 /:id 之前）─────────────
  mock(reportDashboardOpsContract.versions, ({ params, ok }) =>
    ok(mockReportVersions.filter((v) => v.dashboardId === params.id))),
  mock(reportDashboardOpsContract.createVersion, ({ params, body, ok }) => {
    const dash = mockReportDashboards.find((x) => x.id === params.id);
    if (!dash) return notFound('仪表盘不存在');
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
  mock(reportDashboardOpsContract.restoreVersion, ({ ok }) => ok(null, '已恢复到该版本')),

  mock(reportDashboardOpsContract.favorite, ({ params, ok }) => {
    const dash = mockReportDashboards.find((x) => x.id === params.id);
    if (!dash) return notFound('仪表盘不存在');
    dash.favorited = !dash.favorited;
    return ok({ favorited: dash.favorited }, dash.favorited ? '已收藏' : '已取消收藏');
  }),

  mock(reportDashboardOpsContract.shares, ({ params, ok }) =>
    ok(mockReportShares.filter((s) => s.dashboardId === params.id))),
  mock(reportDashboardOpsContract.createShare, ({ params, body, ok }) => {
    // 与后端一致：未传 expireAt 默认 30 天；显式 null = 永久
    const expireAt = body.expireAt === undefined ? mockDateTimeOffset(30 * 24 * 3600 * 1000) : body.expireAt;
    const item = {
      id: getNextReportShareId(), dashboardId: params.id, token: `demo${Math.random().toString(36).slice(2, 10)}`,
      enabled: true, hasPassword: !!body.password, expireAt, accessCount: 0, lastAccessAt: null,
      createdBy: 1, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportShares.push(item);
    return ok(item, '已创建分享链接');
  }),
  mock(reportDashboardOpsContract.updateShare, ({ params, body, ok }) => {
    const s = mockReportShares.find((x) => x.id === params.shareId);
    if (!s) return notFound('分享链接不存在');
    const { password, ...rest } = body;
    Object.assign(s, rest, { updatedAt: mockDateTime() }, password === undefined ? {} : { hasPassword: !!password });
    return ok(s, '更新成功');
  }),
  mock(reportDashboardOpsContract.removeShare, ({ params, ok }) => {
    const i = mockReportShares.findIndex((x) => x.id === params.shareId);
    if (i === -1) return notFound('分享链接不存在');
    mockReportShares.splice(i, 1);
    return ok(null, '删除成功');
  }),

  mock(reportDashboardOpsContract.comments, ({ params, query, ok, paginate }) => {
    const list = mockReportComments
      .filter((c) => c.dashboardId === params.id && (!query.widgetId || c.widgetId === query.widgetId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return ok(paginate(list));
  }),
  mock(reportDashboardOpsContract.createComment, ({ params, body, ok }) => {
    const item = {
      id: getNextReportCommentId(), dashboardId: params.id, widgetId: body.widgetId ?? null, parentId: body.parentId ?? null,
      content: body.content, userId: 1, userName: '管理员', userAvatar: null, updatedAt: mockDateTime(), createdAt: mockDateTime(), replies: [], canEdit: true, canDelete: true, canResolve: true,
    };
    mockReportComments.unshift(item);
    return ok(item, '发表成功');
  }),
  mock(reportDashboardOpsContract.updateComment, ({ params, body, ok }) => {
    const item = mockReportComments.find((c) => c.id === params.commentId);
    if (!item) return notFound('评论不存在');
    item.content = body.content;
    item.updatedAt = mockDateTime();
    return ok(item, '更新成功');
  }),
  mock(reportDashboardOpsContract.resolveComment, ({ params, body, ok }) => {
    const item = mockReportComments.find((c) => c.id === params.commentId);
    if (!item) return notFound('评论不存在');
    item.resolvedAt = body.resolved ? mockDateTime() : null;
    return ok(item, '操作成功');
  }),
  mock(reportDashboardOpsContract.removeComment, ({ params, ok }) => {
    const i = mockReportComments.findIndex((c) => c.id === params.commentId);
    if (i === -1) return notFound('评论不存在');
    mockReportComments.splice(i, 1);
    return ok(null, '删除成功');
  }),

  mock(reportDashboardContract.data, ({ params, body, ok }) => {
    const dash = mockReportDashboards.find((x) => x.id === params.id);
    if (!dash) return notFound('仪表盘不存在');
    return ok(buildDashboardDataFor(dash, body));
  }),

  // ─── 仪表盘 CRUD ─────────────────────────────────────────
  mock(reportDashboardContract.list, ({ query, ok, paginate }) => {
    const list = mockReportDashboards.filter((d) =>
      (!query.keyword || d.name.includes(query.keyword))
      && (!query.status || d.status === query.status)
      && (!query.categoryId || d.categoryId === query.categoryId)
      && (!query.favorited || !!d.favorited));
    return ok(paginate(list));
  }),
  mock(reportDashboardContract.detail, ({ params, ok }) => {
    const d = mockReportDashboards.find((x) => x.id === params.id);
    return d ? ok(d) : notFound('仪表盘不存在');
  }),
  mock(reportDashboardContract.create, ({ body, ok }) => {
    const item: ReportDashboard = {
      id: getNextReportDashboardId(), name: body.name, layout: body.layout,
      canvasLayout: body.canvasLayout, widgets: body.widgets as ReportDashboard['widgets'], filters: body.filters,
      config: body.config, categoryId: body.categoryId ?? null, status: body.status,
      lifecycleStatus: 'draft', revision: 1,
      remark: body.remark ?? null, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportDashboards.push(item);
    return ok(item, '新增成功');
  }),
  mock(reportDashboardContract.update, ({ params, body, ok }) => {
    const d = mockReportDashboards.find((x) => x.id === params.id);
    if (!d) return notFound('仪表盘不存在');
    const { expectedRevision: _expectedRevision, ...rest } = body;
    Object.assign(d, rest, { updatedAt: mockDateTime() });
    return ok(d, '更新成功');
  }),
  mock(reportDashboardContract.remove, ({ params, ok }) => {
    const i = mockReportDashboards.findIndex((x) => x.id === params.id);
    if (i === -1) return notFound('仪表盘不存在');
    mockReportDashboards.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ─── 分类 ─────────────────────────────────────────────────
  mock(reportCategoryContract.list, ({ ok }) => ok([...mockReportCategories].sort((a, b) => a.sort - b.sort))),
  mock(reportCategoryContract.create, ({ body, ok }) => {
    const item: ReportDashboardCategory = {
      id: getNextReportCategoryId(), name: body.name, sort: body.sort,
      remark: body.remark ?? null, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportCategories.push(item);
    return ok(item, '新增成功');
  }),
  mock(reportCategoryContract.update, ({ params, body, ok }) => {
    const c = mockReportCategories.find((x) => x.id === params.id);
    if (!c) return notFound('分类不存在');
    Object.assign(c, body, { updatedAt: mockDateTime() });
    return ok(c, '更新成功');
  }),
  mock(reportCategoryContract.remove, ({ params, ok }) => {
    const i = mockReportCategories.findIndex((x) => x.id === params.id);
    if (i === -1) return notFound('分类不存在');
    mockReportCategories.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ─── 数据预警 ─────────────────────────────────────────────
  mock(reportAlertContract.evaluate, ({ params, ok }) => {
    const a = mockReportAlerts.find((x) => x.id === params.id);
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
  mock(reportAlertContract.list, ({ query, ok, paginate }) => {
    const list = mockReportAlerts.filter((a) => !query.keyword || a.name.includes(query.keyword));
    return ok(paginate(list));
  }),
  mock(reportAlertContract.detail, ({ params, ok }) => {
    const a = mockReportAlerts.find((x) => x.id === params.id);
    return a ? ok(a) : notFound('预警规则不存在');
  }),
  mock(reportAlertContract.create, ({ body, ok }) => {
    const item: ReportAlertRule = {
      id: getNextReportAlertId(), name: body.name, datasetId: body.datasetId ?? null,
      metricId: body.metricId ?? null,
      field: body.field ?? null, groupByField: body.groupByField ?? null,
      aggregate: body.aggregate, op: body.op, threshold: body.threshold,
      cron: body.cron ?? null, timezone: body.timezone, misfirePolicy: body.misfirePolicy, nextRunAt: body.cron ? mockDateTimeOffset(3600000) : null, channels: body.channels, recipients: body.recipients ?? null,
      webhookUrl: body.webhookUrl ?? null,
      silenceMins: body.silenceMins, notifyOnRecover: body.notifyOnRecover,
      enabled: body.enabled, lastCheckedAt: null, lastTriggered: null, lastValue: null, lastNotifiedAt: null, lastDeliveryAt: null, lastDeliveryStatus: null, lastDeliveryError: null,
      remark: body.remark ?? null, createdBy: 1, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportAlerts.push(item);
    return ok(item, '新增成功');
  }),
  mock(reportAlertContract.update, ({ params, body, ok }) => {
    const a = mockReportAlerts.find((x) => x.id === params.id);
    if (!a) return notFound('预警规则不存在');
    Object.assign(a, body, { updatedAt: mockDateTime() });
    return ok(a, '更新成功');
  }),
  mock(reportAlertContract.remove, ({ params, ok }) => {
    const i = mockReportAlerts.findIndex((x) => x.id === params.id);
    if (i === -1) return notFound('预警规则不存在');
    mockReportAlerts.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ─── AI（NL2SQL）────────────────────────────────────────
  mock(reportAiContract.nl2sql, ({ body, ok }) => {
    const sql = `-- Demo 模拟生成（输入：${body.question || '（空）'}）\nSELECT type AS name, count(*)::int AS value\nFROM menus\nGROUP BY type\nORDER BY value DESC`;
    return ok({ sql });
  }),

  // ─── 打印报表 ─────────────────────────────────────────────
  mock(reportPrintContract.render, ({ params, body, ok }) => {
    const t = mockReportPrintTemplates.find((x) => x.id === params.id);
    if (!t) return notFound('打印模板不存在');
    try {
      return ok(renderMockPrintTemplate(t, body.params ?? {}, Math.min(Math.max(body.limit ?? 300, 1), 5000)));
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : '打印预览生成失败', { status: 400 });
    }
  }),
  mock(reportPrintContract.list, ({ query, ok, paginate }) => {
    const list = mockReportPrintTemplates.filter((t) => !query.keyword || t.name.includes(query.keyword));
    return ok(paginate(list));
  }),
  mock(reportPrintContract.detail, ({ params, ok }) => {
    const t = mockReportPrintTemplates.find((x) => x.id === params.id);
    return t ? ok(t) : notFound('打印模板不存在');
  }),
  mock(reportPrintContract.create, ({ body, ok }) => {
    const item: ReportPrintTemplate = {
      id: getNextReportPrintId(), name: body.name, datasetId: body.datasetId ?? null,
      content: body.content, params: body.params, pageConfig: body.pageConfig,
      status: body.status, remark: body.remark ?? null, createdBy: 1, updatedBy: 1,
      createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportPrintTemplates.push(item);
    return ok(item, '新增成功');
  }),
  mock(reportPrintContract.update, ({ params, body, ok }) => {
    const t = mockReportPrintTemplates.find((x) => x.id === params.id);
    if (!t) return notFound('打印模板不存在');
    Object.assign(t, body, { updatedAt: mockDateTime() });
    return ok(t, '更新成功');
  }),
  mock(reportPrintContract.remove, ({ params, ok }) => {
    const i = mockReportPrintTemplates.findIndex((x) => x.id === params.id);
    if (i === -1) return notFound('打印模板不存在');
    mockReportPrintTemplates.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ─── 订阅推送 ─────────────────────────────────────────────
  mock(reportSubscriptionContract.run, ({ params, ok }) => {
    const s = mockReportSubscriptions.find((x) => x.id === params.id);
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
  mock(reportSubscriptionContract.list, ({ query, ok, paginate }) => {
    const list = mockReportSubscriptions.filter((s) => !query.keyword || (s.dashboardName ?? '').includes(query.keyword));
    return ok(paginate(list));
  }),
  mock(reportSubscriptionContract.create, ({ body, ok }) => {
    const dash = mockReportDashboards.find((d) => d.id === body.dashboardId);
    const item: ReportDashboardSubscription = {
      id: getNextReportSubscriptionId(), dashboardId: body.dashboardId, dashboardName: dash?.name ?? null,
      cron: body.cron, timezone: body.timezone, misfirePolicy: body.misfirePolicy, nextRunAt: body.cron ? mockDateTimeOffset(86400000) : null, channels: body.channels, recipients: body.recipients ?? null, webhookUrl: body.webhookUrl ?? null,
      enabled: body.enabled, remark: body.remark ?? null, lastRunAt: null, lastDeliveryAt: null, lastDeliveryStatus: null, lastDeliveryError: null, createdBy: 1,
      createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockReportSubscriptions.push(item);
    return ok(item, '新增成功');
  }),
  mock(reportSubscriptionContract.update, ({ params, body, ok }) => {
    const s = mockReportSubscriptions.find((x) => x.id === params.id);
    if (!s) return notFound('订阅不存在');
    Object.assign(s, body, { updatedAt: mockDateTime() });
    return ok(s, '更新成功');
  }),
  mock(reportSubscriptionContract.remove, ({ params, ok }) => {
    const i = mockReportSubscriptions.findIndex((x) => x.id === params.id);
    if (i === -1) return notFound('订阅不存在');
    mockReportSubscriptions.splice(i, 1);
    return ok(null, '删除成功');
  }),

  mock(reportDeliveryRunContract.list, ({ query, ok, paginate }) => {
    const list = mockDeliveryRuns.filter((item) =>
      (!query.targetType || item.targetType === query.targetType)
      && (!query.subscriptionId || item.subscriptionId === query.subscriptionId)
      && (!query.alertRuleId || item.alertRuleId === query.alertRuleId));
    return ok(paginate(list));
  }),
  mock(reportDeliveryRunContract.acknowledge, ({ params, body, ok }) => {
    const run = mockDeliveryRuns.find((item) => item.id === params.id);
    if (!run || run.targetType !== 'alert') return notFound('告警投递记录不存在');
    run.acknowledgedAt = mockDateTime();
    run.acknowledgedBy = 1;
    run.acknowledgedByName = '管理员';
    run.acknowledgeNote = body.note ?? null;
    run.updatedAt = mockDateTime();
    return ok(run, '确认成功');
  }),

  // ─── 公开分享页（无需鉴权）───────────────────────────────
  mock(reportPublicContract.access, ({ params, ok }) => {
    const dash = resolveSharedDashboard(params.token);
    if (!dash) return notFound('分享链接无效或已失效');
    return ok({
      accessSessionToken: `demo-session-${params.token}`,
      expiresAt: mockDateTimeOffset(15 * 60 * 1000),
      dashboard: toPublicDashboard(dash),
    });
  }),
  mock(reportPublicContract.dashboardData, ({ params, body, ok }) => {
    const dash = resolveSharedDashboard(params.token);
    return ok(dash ? buildDashboardDataFor(dash, body) : {});
  }),
  mock(reportPublicContract.dashboard, ({ params, ok }) => {
    const dash = resolveSharedDashboard(params.token);
    if (!dash) return notFound('分享链接无效或已失效');
    return ok(toPublicDashboard(dash));
  }),
  mock(reportPublicContract.embed, ({ params, ok }) => {
    const dash = resolveSharedDashboard(params.token);
    if (!dash) return notFound('嵌入令牌无效');
    return ok(toPublicDashboard(dash));
  }),
  mock(reportPublicContract.embedData, ({ params, body, ok }) => {
    const dash = resolveSharedDashboard(params.token);
    return ok(dash ? buildDashboardDataFor(dash, body) : {});
  }),
];
