import type { ReportChatbiMessage, ReportChatbiSession, ReportChatbiSessionDetail } from '@zenith/shared/report';
import { reportChatbiContract } from '@zenith/shared/report';
import {
  getNextReportDashboardId,
  getNextReportDatasetId,
  mockReportDashboards,
  mockReportDatasets,
  mockReportDatasources,
} from '@/mocks/data/report';
import {
  mockReportChatbiMessages,
  mockReportChatbiSessions,
  nextReportP2Id,
} from '@/mocks/data/report-p2';
import { removeWhere } from '@/mocks/utils/array';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';
import { badRequest, conflict, forbidden, notFound } from '@/mocks/utils/handlers';
import { DEMO_TENANT_ID, DEMO_USER_ID } from './report-mock-utils';

const SAFE_TABLES = ['menus', 'departments', 'users'] as const;

function ownedSession(id: number): ReportChatbiSession | undefined {
  return mockReportChatbiSessions.find((item) => item.id === id && item.userId === DEMO_USER_ID);
}

function sessionDetail(session: ReportChatbiSession): ReportChatbiSessionDetail {
  return {
    session,
    messages: mockReportChatbiMessages.filter((message) => message.sessionId === session.id)
      .sort((a, b) => a.id - b.id),
  };
}

function addMessage(message: Omit<ReportChatbiMessage, 'id' | 'tenantId' | 'createdAt'>): ReportChatbiMessage {
  const created: ReportChatbiMessage = {
    ...message,
    id: nextReportP2Id('chatbi-message', mockReportChatbiMessages),
    tenantId: DEMO_TENANT_ID,
    createdAt: mockDateTime(),
  };
  mockReportChatbiMessages.push(created);
  return created;
}

export const reportChatbiHandlers = [
  mock(reportChatbiContract.sessions, ({ query, ok, paginate }) => {
    const list = mockReportChatbiSessions.filter((item) =>
      item.userId === DEMO_USER_ID
      && (!query.keyword || item.title.includes(query.keyword))
      && (!query.status || item.status === query.status)
      && (!query.userId || item.userId === query.userId));
    return ok(paginate(list));
  }),

  mock(reportChatbiContract.createSession, ({ body, ok }) => {
    const datasetId = body.datasetId ?? null;
    const dataset = datasetId ? mockReportDatasets.find((item) => item.id === datasetId) : null;
    const datasource = mockReportDatasources.find((item) => item.id === (dataset?.datasourceId ?? body.datasourceId ?? null));
    if (!datasource) return badRequest('必须选择有效的数据源或数据集上下文', { status: 400 });
    const requestedTables = body.allowedTables ?? [];
    const allowedTables = requestedTables.length
      ? requestedTables.filter((table) => SAFE_TABLES.includes(table as typeof SAFE_TABLES[number]))
      : [...SAFE_TABLES];
    if (requestedTables.length && allowedTables.length !== requestedTables.length) return badRequest('包含不允许访问的数据表', { status: 400 });
    const now = mockDateTime();
    const session: ReportChatbiSession = {
      id: nextReportP2Id('chatbi-session', mockReportChatbiSessions),
      tenantId: DEMO_TENANT_ID,
      userId: DEMO_USER_ID,
      title: body.title.trim(),
      datasourceId: datasource.id,
      datasetId: dataset?.id ?? null,
      allowedTables,
      contextSnapshot: {
        datasourceId: datasource.id,
        datasourceName: datasource.name,
        datasourceType: datasource.type,
        datasetId: dataset?.id ?? null,
        tables: allowedTables.map((name) => ({
          name,
          columns: name === 'departments'
            ? [{ name: 'id', type: 'number' }, { name: 'name', type: 'string' }]
            : [{ name: 'id', type: 'number' }, { name: 'status', type: 'string' }],
        })),
        frozenAt: now,
      },
      status: 'active',
      totalTokens: 0,
      totalCostUnits: 0,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now,
    };
    mockReportChatbiSessions.unshift(session);
    return ok(session, '创建成功');
  }),

  mock(reportChatbiContract.sessionDetail, ({ params, ok }) => {
    const session = ownedSession(params.id);
    return session ? ok(sessionDetail(session)) : notFound('ChatBI 会话不存在', { status: 404 });
  }),

  mock(reportChatbiContract.updateSession, ({ params, body, ok }) => {
    const session = ownedSession(params.id);
    if (!session) return notFound('ChatBI 会话不存在', { status: 404 });
    if (typeof body.title === 'string') session.title = body.title.trim();
    if (body.status === 'active' || body.status === 'archived') session.status = body.status;
    session.updatedAt = mockDateTime();
    return ok(session, '更新成功');
  }),

  mock(reportChatbiContract.archiveSession, ({ params, ok }) => {
    const session = ownedSession(params.id);
    if (!session) return notFound('ChatBI 会话不存在', { status: 404 });
    session.status = 'archived';
    session.updatedAt = mockDateTime();
    return ok(session, '归档成功');
  }),

  mock(reportChatbiContract.removeSession, ({ params, ok }) => {
    const index = mockReportChatbiSessions.findIndex((item) => item.id === params.id && item.userId === DEMO_USER_ID);
    if (index < 0) return notFound('ChatBI 会话不存在', { status: 404 });
    mockReportChatbiSessions.splice(index, 1);
    removeWhere(mockReportChatbiMessages, (message) => message.sessionId === params.id);
    return ok(null, '删除成功');
  }),

  mock(reportChatbiContract.ask, ({ params, body, ok }) => {
    const session = ownedSession(params.id);
    if (!session) return notFound('ChatBI 会话不存在', { status: 404 });
    if (session.status !== 'active') return conflict('已归档会话不能继续提问', { status: 409 });
    const question = body.content.trim();
    if (/\b(insert|update|delete|drop|alter|truncate|grant|revoke)\b/i.test(question)) {
      return badRequest('ChatBI 仅支持只读分析问题', { status: 400 });
    }
    const asksDepartment = question.includes('部门');
    const requestedTable = asksDepartment ? 'departments' : 'menus';
    if (!session.allowedTables.includes(requestedTable)) {
      return forbidden(`当前会话未授权访问 ${requestedTable} 表`, { status: 403 });
    }
    addMessage({
      sessionId: session.id,
      userId: DEMO_USER_ID,
      role: 'user',
      content: question,
      generatedSql: null,
      chartSuggestion: null,
      resultSample: [],
      resultRowCount: 0,
      resultByteSize: 0,
      savedResourceType: null,
      savedResourceId: null,
      savedDatasetId: null,
      savedDashboardId: null,
      promptTokens: 0,
      completionTokens: 0,
      costUnits: 0,
      latencyMs: null,
      modelId: null,
      errorMessage: null,
    });
    const generatedSql = asksDepartment
      ? 'SELECT name, COUNT(*) AS user_count FROM departments GROUP BY name ORDER BY user_count DESC LIMIT 100'
      : 'SELECT type, COUNT(*) AS item_count FROM menus GROUP BY type ORDER BY item_count DESC LIMIT 100';
    const resultSample = asksDepartment
      ? [{ name: '研发部', user_count: 28 }, { name: '产品部', user_count: 16 }]
      : [{ type: 'menu', item_count: 24 }, { type: 'button', item_count: 53 }];
    const assistant = addMessage({
      sessionId: session.id,
      userId: DEMO_USER_ID,
      role: 'assistant',
      content: asksDepartment ? '研发部人数最多，其次是产品部。' : '按钮类型数量最多，其次是菜单类型。',
      generatedSql,
      chartSuggestion: body.requestChart === false ? null : {
        type: 'bar',
        title: asksDepartment ? '部门用户数' : '菜单类型分布',
        categoryField: asksDepartment ? 'name' : 'type',
        valueFields: [asksDepartment ? 'user_count' : 'item_count'],
        options: {},
      },
      resultSample,
      resultRowCount: resultSample.length,
      resultByteSize: JSON.stringify(resultSample).length,
      savedResourceType: null,
      savedResourceId: null,
      savedDatasetId: null,
      savedDashboardId: null,
      promptTokens: 48,
      completionTokens: 72,
      costUnits: 0.12,
      latencyMs: 420,
      modelId: 'demo-readonly-model',
      errorMessage: null,
    });
    session.totalTokens += assistant.promptTokens + assistant.completionTokens;
    session.totalCostUnits += assistant.costUnits;
    session.lastMessageAt = assistant.createdAt;
    session.updatedAt = assistant.createdAt;
    return ok(assistant);
  }),

  mock(reportChatbiContract.saveMessage, ({ params, body, ok }) => {
    const message = mockReportChatbiMessages.find((item) => item.id === params.id && item.userId === DEMO_USER_ID);
    if (!message || message.role !== 'assistant' || !message.generatedSql) return notFound('可保存的 ChatBI 回答不存在', { status: 404 });
    const name = body.name?.trim() ? body.name.trim() : `ChatBI 分析 ${message.id}`;
    const now = mockDateTime();
    if (body.resourceType === 'dataset') {
      const source = mockReportDatasets[0];
      const dataset = {
        ...source,
        id: getNextReportDatasetId(),
        name,
        content: { sql: message.generatedSql },
        fields: Object.keys(message.resultSample[0] ?? {}).map((field) => ({ name: field, label: field, type: 'string' as const })),
        folderId: body.folderId ?? null,
        ownerId: DEMO_USER_ID,
        createdAt: now,
        updatedAt: now,
      };
      mockReportDatasets.push(dataset);
      message.savedResourceType = 'dataset';
      message.savedResourceId = dataset.id;
      message.savedDatasetId = dataset.id;
      return ok({ resourceType: 'dataset' as const, resourceId: dataset.id, name: dataset.name, datasetId: dataset.id }, '保存成功');
    }
    const targetDashboardId = body.targetDashboardId ?? null;
    const target = targetDashboardId ? mockReportDashboards.find((item) => item.id === targetDashboardId) : null;
    if (targetDashboardId && !target) return notFound('目标仪表盘不存在', { status: 404 });
    if (target) {
      if (body.expectedDashboardRevision !== target.revision) return conflict('仪表盘修订号不匹配', { status: 409 });
      const widgetId = `chatbi_${message.id}`;
      target.widgets.push({
        i: widgetId,
        type: message.chartSuggestion?.type ?? 'table',
        title: message.chartSuggestion?.title ?? name,
        options: message.chartSuggestion?.options ?? {},
      });
      target.layout.push({ i: widgetId, x: 0, y: target.layout.length * 4, w: 6, h: 4 });
      target.revision += 1;
      target.updatedAt = now;
      message.savedResourceType = 'dashboard';
      message.savedResourceId = target.id;
      message.savedDashboardId = target.id;
      return ok({ resourceType: 'dashboard' as const, resourceId: target.id, name: target.name, datasetId: null }, '保存成功');
    }
    const source = mockReportDashboards[0];
    const dashboard = {
      ...source,
      id: getNextReportDashboardId(),
      name,
      folderId: body.folderId ?? null,
      ownerId: DEMO_USER_ID,
      layout: [{ i: `chatbi_${message.id}`, x: 0, y: 0, w: 12, h: 6 }],
      canvasLayout: [],
      widgets: [{
        i: `chatbi_${message.id}`,
        type: message.chartSuggestion?.type ?? 'table',
        title: message.chartSuggestion?.title ?? name,
        options: message.chartSuggestion?.options ?? {},
      }],
      filters: [],
      lifecycleStatus: 'draft' as const,
      revision: 1,
      publishedSnapshot: null,
      publishedAt: null,
      publishedBy: null,
      publishedByName: null,
      createdAt: now,
      updatedAt: now,
    };
    mockReportDashboards.push(dashboard);
    message.savedResourceType = 'dashboard';
    message.savedResourceId = dashboard.id;
    message.savedDashboardId = dashboard.id;
    return ok({ resourceType: 'dashboard' as const, resourceId: dashboard.id, name: dashboard.name, datasetId: null }, '保存成功');
  }),

  mock(reportChatbiContract.myQuota, ({ ok }) => {
    const messages = mockReportChatbiMessages.filter((item) => item.userId === DEMO_USER_ID && item.role === 'assistant');
    return ok({
      aiPromptTokensToday: messages.reduce((sum, item) => sum + item.promptTokens, 0),
      aiCompletionTokensToday: messages.reduce((sum, item) => sum + item.completionTokens, 0),
      aiRequestsToday: messages.length,
      queryCountToday: messages.filter((item) => item.generatedSql).length,
      queryRowsToday: messages.reduce((sum, item) => sum + item.resultRowCount, 0),
      queryBytesToday: messages.reduce((sum, item) => sum + item.resultByteSize, 0),
      queryCostUnitsToday: messages.reduce((sum, item) => sum + item.costUnits, 0),
    });
  }),

  mock(reportChatbiContract.audit, ({ query, ok, paginate }) => {
    const list = mockReportChatbiMessages.filter((item) =>
      item.role === 'assistant'
      && (!query.userId || item.userId === query.userId)
      && (!query.failedOnly || Boolean(item.errorMessage)));
    return ok(paginate(list));
  }),
];
