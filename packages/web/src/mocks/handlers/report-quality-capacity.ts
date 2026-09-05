import type { ReportAssetCatalogItem, ReportAssetTemplate, ReportAssetTemplateApplyResult, ReportAssetUsageSummary, ReportDeprecationNotice, ReportDqRule, ReportDqRun, ReportMaterializationSnapshot, ReportQueryQuota, ReportResourceType, ReportSlaRule } from '@zenith/shared/report';
import { reportAssetContract, reportDqContract, reportMaterializationContract, reportQueryCapacityContract, reportSlaContract } from '@zenith/shared/report';
import {
  getNextReportDashboardId,
  getNextReportDatasetId,
  getNextReportPrintId,
  mockReportDashboards,
  mockReportDatasets,
  mockReportDatasources,
  mockReportPrintTemplates,
} from '@/mocks/data/report';
import {
  mockReportAssetTemplates,
  mockReportDeprecations,
  mockReportDqAnomalies,
  mockReportDqRules,
  mockReportDqRuns,
  mockReportDqScores,
  mockReportFillTemplates,
  mockReportFolders,
  mockReportMetrics,
  mockReportQueryCostLogs,
  mockReportQueryQuotas,
  mockReportSlaRules,
  mockReportSlaViolations,
  mockReportSnapshots,
  nextReportP2Id,
} from '@/mocks/data/report-p2';
import { mock } from '@/mocks/utils/contract';
import { mockDate, mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import { badRequest, conflict, notFound } from '@/mocks/utils/handlers';
import { createProgressingMockTask } from './async-tasks';
import { DEMO_TENANT_ID, DEMO_USER_ID, DEMO_USER_NAME } from './report-mock-utils';

function dqRuleView(rule: ReportDqRule): ReportDqRule {
  return { ...rule, datasetName: mockReportDatasets.find((item) => item.id === rule.datasetId)?.name ?? null };
}

function validateCustomDqSql(rule: Pick<ReportDqRule, 'type' | 'config'>): string | null {
  if (rule.type !== 'custom_sql') return null;
  const query = rule.config.sql?.trim() ?? '';
  if (!query
    || /;|--|\/\*|\b(with|join|union|intersect|except|lateral|values|table|insert|update|delete|drop|alter|truncate)\b/i.test(query)
    || !/^\s*select\s+(?:[A-Za-z_][\w$]*\.)?row\s+from\s+dataset(?:\s+(?:as\s+)?[A-Za-z_][\w$]*)?(?:\s+where\s+[\s\S]+)?\s*$/i.test(query)) {
    return '自定义质量 SQL 只能使用 SELECT row FROM dataset [WHERE ...] 受限语法';
  }
  return null;
}

function assetCatalog(): ReportAssetCatalogItem[] {
  const folderName = (id: number | null | undefined) => mockReportFolders.find((folder) => folder.id === id)?.name ?? null;
  const map = (
    resourceType: ReportResourceType,
    items: Array<{ id: number; name: string; tenantId?: number | null; ownerId?: number | null; ownerName?: string | null; folderId?: number | null; status?: string; lifecycleStatus?: string; updatedAt: string }>,
  ) => items.map((item): ReportAssetCatalogItem => ({
    resourceType,
    resourceId: item.id,
    tenantId: item.tenantId ?? null,
    name: item.name,
    ownerId: item.ownerId ?? DEMO_USER_ID,
    ownerName: item.ownerName ?? DEMO_USER_NAME,
    folderId: item.folderId ?? null,
    folderName: folderName(item.folderId),
    lifecycleStatus: item.lifecycleStatus ?? null,
    status: item.status ?? null,
    deprecationEffectiveAt: mockReportDeprecations.find((notice) =>
      notice.resourceType === resourceType && notice.resourceId === item.id && notice.publishedAt)?.effectiveAt ?? null,
    updatedAt: item.updatedAt,
  }));
  return [
    ...map('datasource', mockReportDatasources),
    ...map('dataset', mockReportDatasets),
    ...map('dashboard', mockReportDashboards),
    ...map('metric', mockReportMetrics),
    ...map('print_template', mockReportPrintTemplates),
    ...map('fill_template', mockReportFillTemplates),
    ...map('asset_template', mockReportAssetTemplates),
  ];
}

function usageSummary(resourceType: ReportResourceType, resourceId: number): ReportAssetUsageSummary {
  const multiplier = resourceId + resourceType.length;
  const notice = mockReportDeprecations.find((item) =>
    item.resourceType === resourceType && item.resourceId === resourceId && item.publishedAt);
  return {
    resourceType,
    resourceId,
    views: multiplier * 7,
    queries: multiplier * 4,
    exports: multiplier,
    uniqueUsers: Math.max(1, multiplier % 9),
    lastUsedAt: mockDateTimeOffset(-multiplier * 60_000),
    deprecated: Boolean(notice),
    deprecationNotice: notice ?? null,
  };
}

export const reportQualityCapacityHandlers = [
  mock(reportDqContract.rules, ({ query, ok, paginate }) => {
    const list = mockReportDqRules.filter((item) =>
      (!query.datasetId || item.datasetId === query.datasetId)
      && (!query.type || item.type === query.type)
      && (query.enabled === undefined || item.enabled === query.enabled))
      .map(dqRuleView);
    return ok(paginate(list));
  }),

  mock(reportDqContract.ruleDetail, ({ params, ok }) => {
    const rule = mockReportDqRules.find((item) => item.id === params.id);
    return rule ? ok(dqRuleView(rule)) : notFound('质量规则不存在', { status: 404 });
  }),

  mock(reportDqContract.createRule, ({ body, ok }) => {
    if (!mockReportDatasets.some((item) => item.id === body.datasetId)) return notFound('数据集不存在', { status: 404 });
    const customSqlError = validateCustomDqSql(body);
    if (customSqlError) return badRequest(customSqlError, { status: 400 });
    const now = mockDateTime();
    const rule: ReportDqRule = {
      ...body,
      id: nextReportP2Id('dq-rule', mockReportDqRules),
      tenantId: DEMO_TENANT_ID,
      field: body.field ?? null,
      cron: body.cron ?? null,
      lastRunAt: null,
      lastStatus: null,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportDqRules.push(rule);
    return ok(dqRuleView(rule), '创建成功');
  }),

  mock(reportDqContract.updateRule, ({ params, body, ok }) => {
    const rule = mockReportDqRules.find((item) => item.id === params.id);
    if (!rule) return notFound('质量规则不存在', { status: 404 });
    const customSqlError = validateCustomDqSql({
      type: body.type ?? rule.type,
      config: body.config ?? rule.config,
    });
    if (customSqlError) return badRequest(customSqlError, { status: 400 });
    Object.assign(rule, body, { updatedBy: DEMO_USER_ID, updatedAt: mockDateTime() });
    return ok(dqRuleView(rule), '更新成功');
  }),

  mock(reportDqContract.removeRule, ({ params, ok }) => {
    const index = mockReportDqRules.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('质量规则不存在', { status: 404 });
    mockReportDqRules.splice(index, 1);
    return ok(null, '删除成功');
  }),

  mock(reportDqContract.toggleRule, ({ params, ok }) => {
    const rule = mockReportDqRules.find((item) => item.id === params.id);
    if (!rule) return notFound('质量规则不存在', { status: 404 });
    rule.enabled = !rule.enabled;
    rule.updatedAt = mockDateTime();
    return ok(dqRuleView(rule), rule.enabled ? '已启用' : '已停用');
  }),

  mock(reportDqContract.runRule, ({ params, body, ok }) => {
    const rule = mockReportDqRules.find((item) => item.id === params.id);
    if (!rule) return notFound('质量规则不存在', { status: 404 });
    if (!rule.enabled) return conflict('质量规则已停用', { status: 409 });
    const now = mockDateTime();
    const failedRows = rule.type === 'row_count' ? 1 : 0;
    const run: ReportDqRun = {
      id: nextReportP2Id('dq-run', mockReportDqRuns),
      tenantId: DEMO_TENANT_ID,
      ruleId: rule.id,
      datasetId: rule.datasetId,
      status: 'succeeded',
      triggerType: 'manual',
      checkedRows: 6,
      failedRows,
      passRate: failedRows ? 83.33 : 100,
      sampleRows: failedRows && body.sampleLimit > 0 ? [{ name: '演示异常行', value: null }] : [],
      sampleRowCount: failedRows,
      sampleBytes: failedRows ? 48 : 0,
      startedAt: now,
      completedAt: now,
      durationMs: 320,
      errorMessage: null,
      schemaSignature: 'demo-department-ranking-v1',
      requestedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportDqRuns.unshift(run);
    rule.lastRunAt = now;
    rule.lastStatus = 'succeeded';
    rule.updatedAt = now;
    mockReportDqScores.unshift({
      id: nextReportP2Id('dq-score', mockReportDqScores),
      tenantId: DEMO_TENANT_ID,
      datasetId: rule.datasetId,
      score: failedRows ? 83.33 : 100,
      passedRules: failedRows ? 1 : 2,
      failedRules: failedRows ? 1 : 0,
      totalRules: 2,
      dimensions: { completeness: failedRows ? 80 : 100, validity: 100 },
      measuredAt: now,
      createdAt: now,
    });
    if (failedRows) {
      mockReportDqAnomalies.unshift({
        id: nextReportP2Id('dq-anomaly', mockReportDqAnomalies),
        tenantId: DEMO_TENANT_ID,
        datasetId: rule.datasetId,
        ruleId: rule.id,
        runId: run.id,
        severity: rule.severity,
        title: `${rule.name}未通过`,
        detail: 'Demo 规则执行产生的示例异常。',
        sample: { failedRows },
        sampleRowCount: failedRows,
        sampleBytes: 48,
        status: 'open',
        acknowledgedAt: null,
        acknowledgedBy: null,
        acknowledgementNote: null,
        resolvedAt: null,
        resolvedBy: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    return ok(createProgressingMockTask({
      taskType: 'report-dq-rule-run',
      title: `执行质量规则 · ${rule.name}`,
      payload: { ruleId: rule.id, runId: run.id, sampleLimit: body.sampleLimit },
      totalItems: 6,
    }), '任务已提交');
  }),

  mock(reportDqContract.runs, ({ query, ok, paginate }) => {
    const list = mockReportDqRuns.filter((item) =>
      (!query.datasetId || item.datasetId === query.datasetId)
      && (!query.ruleId || item.ruleId === query.ruleId)
      && (!query.status || item.status === query.status));
    return ok(paginate(list));
  }),

  mock(reportDqContract.scores, ({ params, ok, paginate }) =>
    ok(paginate(mockReportDqScores.filter((item) => item.datasetId === params.id)))),

  mock(reportDqContract.currentScore, ({ params, ok }) =>
    ok(mockReportDqScores.find((item) => item.datasetId === params.id) ?? null)),

  mock(reportDqContract.anomalies, ({ query, ok, paginate }) => {
    const list = mockReportDqAnomalies.filter((item) =>
      (!query.datasetId || item.datasetId === query.datasetId)
      && (!query.status || item.status === query.status));
    return ok(paginate(list));
  }),

  mock(reportDqContract.updateAnomalyStatus, ({ params, body, ok }) => {
    const anomaly = mockReportDqAnomalies.find((item) => item.id === params.id);
    if (!anomaly) return notFound('质量异常不存在', { status: 404 });
    const now = mockDateTime();
    anomaly.status = body.status;
    anomaly.acknowledgementNote = body.note ?? null;
    if (body.status === 'acknowledged') {
      anomaly.acknowledgedAt = now;
      anomaly.acknowledgedBy = DEMO_USER_ID;
    }
    if (body.status === 'resolved') {
      anomaly.resolvedAt = now;
      anomaly.resolvedBy = DEMO_USER_ID;
    }
    anomaly.updatedAt = now;
    return ok(anomaly, '操作成功');
  }),

  mock(reportMaterializationContract.snapshots, ({ params, ok, paginate }) =>
    ok(paginate(mockReportSnapshots.filter((item) => item.datasetId === params.id)))),

  mock(reportMaterializationContract.current, ({ params, ok }) =>
    ok(mockReportSnapshots.find((item) => item.datasetId === params.id && item.status === 'ready') ?? null)),

  mock(reportMaterializationContract.refresh, ({ params, body, ok }) => {
    const datasetId = params.id;
    const dataset = mockReportDatasets.find((item) => item.id === datasetId);
    if (!dataset) return notFound('数据集不存在', { status: 404 });
    const now = mockDateTime();
    const revision = Math.max(0, ...mockReportSnapshots.filter((item) => item.datasetId === datasetId).map((item) => item.revision)) + 1;
    const snapshot: ReportMaterializationSnapshot = {
      id: nextReportP2Id('snapshot', mockReportSnapshots),
      tenantId: DEMO_TENANT_ID,
      datasetId,
      strategy: body.strategy,
      status: 'ready',
      revision,
      keyField: body.keyField ?? null,
      watermark: body.strategy === 'incremental' ? now : null,
      deltaWindowMinutes: body.deltaWindowMinutes ?? null,
      fileId: null,
      rowCount: 6,
      byteSize: 512,
      checksum: `demo-snapshot-${datasetId}-${revision}`,
      startedAt: now,
      completedAt: now,
      expiresAt: body.expiresAt ?? null,
      errorMessage: null,
      createdBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportSnapshots.unshift(snapshot);
    return ok(createProgressingMockTask({
      taskType: 'report-dataset-materialize',
      title: `物化数据集 · ${dataset.name}`,
      payload: { datasetId, snapshotId: snapshot.id, strategy: snapshot.strategy },
      totalItems: 8,
    }), '任务已提交');
  }),

  mock(reportMaterializationContract.purge, ({ params, ok }) => {
    const snapshot = mockReportSnapshots.find((item) => item.id === params.id);
    if (!snapshot) return notFound('物化快照不存在', { status: 404 });
    snapshot.status = 'deleted';
    snapshot.updatedAt = mockDateTime();
    return ok(null, '清除成功');
  }),

  mock(reportMaterializationContract.purgeDataset, ({ params, ok }) => {
    mockReportSnapshots
      .filter((item) => item.datasetId === params.id && item.status !== 'deleted')
      .forEach((item) => { item.status = 'deleted'; item.updatedAt = mockDateTime(); });
    return ok(null, '清除成功');
  }),

  mock(reportQueryCapacityContract.quotas, ({ ok, paginate }) => ok(paginate(mockReportQueryQuotas))),

  mock(reportQueryCapacityContract.quotaDetail, ({ params, ok }) => {
    const quota = mockReportQueryQuotas.find((item) => item.id === params.id);
    return quota ? ok(quota) : notFound('查询配额不存在', { status: 404 });
  }),

  mock(reportQueryCapacityContract.createQuota, ({ body, ok }) => {
    if (mockReportQueryQuotas.some((item) => item.scope === body.scope && item.userId === (body.userId ?? null))) {
      return conflict('该作用域已配置查询配额', { status: 409 });
    }
    const now = mockDateTime();
    const quota: ReportQueryQuota = {
      ...body,
      id: nextReportP2Id('quota', mockReportQueryQuotas),
      tenantId: DEMO_TENANT_ID,
      userId: body.userId ?? null,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportQueryQuotas.push(quota);
    return ok(quota, '创建成功');
  }),

  mock(reportQueryCapacityContract.updateQuota, ({ params, body, ok }) => {
    const quota = mockReportQueryQuotas.find((item) => item.id === params.id);
    if (!quota) return notFound('查询配额不存在', { status: 404 });
    Object.assign(quota, body, { updatedBy: DEMO_USER_ID, updatedAt: mockDateTime() });
    return ok(quota, '更新成功');
  }),

  mock(reportQueryCapacityContract.removeQuota, ({ params, ok }) => {
    const index = mockReportQueryQuotas.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('查询配额不存在', { status: 404 });
    mockReportQueryQuotas.splice(index, 1);
    return ok(null, '删除成功');
  }),

  mock(reportQueryCapacityContract.quotaUsage, ({ params, query, ok }) => {
    const quota = mockReportQueryQuotas.find((item) => item.id === params.id);
    if (!quota) return notFound('查询配额不存在', { status: 404 });
    return ok({
      tenantId: quota.tenantId,
      userId: quota.userId ?? null,
      timezone: quota.resetTimezone,
      day: query.scopeDate ?? mockDate(),
      concurrent: 1,
      queries: 42,
      rows: 2_860,
      bytes: 524_288,
      costUnits: 1.25,
      maxConcurrent: quota.maxConcurrent,
      dailyQueryLimit: quota.dailyQueryLimit,
      dailyRowLimit: quota.dailyRowLimit,
      dailyByteLimit: quota.dailyByteLimit,
      dailyCostLimit: quota.dailyCostLimit,
    });
  }),

  mock(reportQueryCapacityContract.resetQuota, ({ params, ok }) => {
    if (!mockReportQueryQuotas.some((item) => item.id === params.id)) return notFound('查询配额不存在', { status: 404 });
    return ok(null, '重置成功');
  }),

  mock(reportQueryCapacityContract.costLogs, ({ query, ok, paginate }) => {
    const list = mockReportQueryCostLogs.filter((item) =>
      (!query.userId || item.userId === query.userId)
      && (!query.datasetId || item.datasetId === query.datasetId)
      && (!query.datasourceId || item.datasourceId === query.datasourceId)
      && (!query.scene || item.scene === query.scene)
      && (query.success === undefined || item.success === query.success));
    return ok(paginate(list));
  }),

  mock(reportQueryCapacityContract.costStats, ({ ok }) => {
    const queries = mockReportQueryCostLogs.length;
    return ok({
      queries,
      rows: mockReportQueryCostLogs.reduce((sum, item) => sum + item.rowCount, 0),
      bytes: mockReportQueryCostLogs.reduce((sum, item) => sum + item.byteSize, 0),
      costUnits: mockReportQueryCostLogs.reduce((sum, item) => sum + item.costUnits, 0),
      avgDurationMs: queries ? Math.round(mockReportQueryCostLogs.reduce((sum, item) => sum + item.durationMs, 0) / queries) : 0,
      failures: mockReportQueryCostLogs.filter((item) => !item.success).length,
      capacity: { globalLimit: 100, running: 1, queueDepth: 0, datasourceQueues: 1 },
    });
  }),

  mock(reportQueryCapacityContract.costTrend, ({ ok }) => ok(
    Array.from({ length: 7 }, (_, index) => ({
      bucket: mockDateTimeOffset(-(6 - index) * 86_400_000),
      queries: 18 + index * 4,
      rows: 900 + index * 120,
      bytes: 120_000 + index * 24_000,
      costUnits: 0.4 + index * 0.08,
      avgDurationMs: 42 - index,
      queueMs: Math.max(0, 6 - index),
    })),
  )),

  mock(reportSlaContract.rules, ({ query, ok, paginate }) => {
    const list = mockReportSlaRules.filter((item) =>
      (!query.datasetId || item.datasetId === query.datasetId)
      && (!query.type || item.type === query.type)
      && (query.enabled === undefined || item.enabled === query.enabled));
    return ok(paginate(list));
  }),

  mock(reportSlaContract.ruleDetail, ({ params, ok }) => {
    const rule = mockReportSlaRules.find((item) => item.id === params.id);
    return rule ? ok(rule) : notFound('SLA 规则不存在', { status: 404 });
  }),

  mock(reportSlaContract.createRule, ({ body, ok }) => {
    const now = mockDateTime();
    const rule: ReportSlaRule = {
      ...body,
      id: nextReportP2Id('sla-rule', mockReportSlaRules),
      tenantId: DEMO_TENANT_ID,
      warningValue: body.warningValue ?? null,
      cron: body.cron ?? null,
      recipients: body.recipients ?? null,
      webhookUrl: body.webhookUrl ?? null,
      lastEvaluatedAt: null,
      lastNotifiedAt: null,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportSlaRules.push(rule);
    return ok(rule, '创建成功');
  }),

  mock(reportSlaContract.updateRule, ({ params, body, ok }) => {
    const rule = mockReportSlaRules.find((item) => item.id === params.id);
    if (!rule) return notFound('SLA 规则不存在', { status: 404 });
    Object.assign(rule, body, { updatedBy: DEMO_USER_ID, updatedAt: mockDateTime() });
    return ok(rule, '更新成功');
  }),

  mock(reportSlaContract.removeRule, ({ params, ok }) => {
    const index = mockReportSlaRules.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('SLA 规则不存在', { status: 404 });
    mockReportSlaRules.splice(index, 1);
    return ok(null, '删除成功');
  }),

  mock(reportSlaContract.evaluate, ({ params, ok }) => {
    const rule = mockReportSlaRules.find((item) => item.id === params.id);
    if (!rule) return notFound('SLA 规则不存在', { status: 404 });
    rule.lastEvaluatedAt = mockDateTime();
    rule.updatedAt = rule.lastEvaluatedAt;
    return ok(createProgressingMockTask({
      taskType: 'report-sla-rule-evaluate',
      title: `评估 SLA · ${rule.name}`,
      payload: { ruleId: rule.id, datasetId: rule.datasetId },
      totalItems: 4,
    }), '任务已提交');
  }),

  mock(reportSlaContract.violations, ({ query, ok, paginate }) => {
    const list = mockReportSlaViolations.filter((item) =>
      (!query.datasetId || item.datasetId === query.datasetId)
      && (!query.ruleId || item.ruleId === query.ruleId)
      && (!query.status || item.status === query.status));
    return ok(paginate(list));
  }),

  mock(reportSlaContract.updateViolationStatus, ({ params, body, ok }) => {
    const violation = mockReportSlaViolations.find((item) => item.id === params.id);
    if (!violation) return notFound('SLA 违规不存在', { status: 404 });
    const now = mockDateTime();
    violation.status = body.status;
    if (body.status === 'acknowledged') {
      violation.acknowledgedAt = now;
      violation.acknowledgedBy = DEMO_USER_ID;
    } else {
      violation.resolvedAt = now;
      violation.resolvedBy = DEMO_USER_ID;
      violation.resolutionNote = body.note ?? null;
    }
    violation.updatedAt = now;
    return ok(violation, '操作成功');
  }),

  mock(reportAssetContract.catalog, ({ query, ok, paginate }) => {
    const types = (query.types ?? '').split(',').filter(Boolean);
    const list = assetCatalog().filter((item) =>
      (!query.keyword || item.name.includes(query.keyword))
      && (!types.length || types.includes(item.resourceType))
      && (!query.ownerId || item.ownerId === query.ownerId)
      && (!query.folderId || item.folderId === query.folderId)
      && (!query.lifecycle || item.lifecycleStatus === query.lifecycle)
      && (!query.status || item.status === query.status));
    return ok(paginate(list));
  }),

  mock(reportAssetContract.topAssets, ({ query, ok }) => {
    const list = assetCatalog().map((item) => usageSummary(item.resourceType, item.resourceId))
      .sort((a, b) => b.views - a.views).slice(0, query.limit);
    return ok(list);
  }),

  mock(reportAssetContract.inactiveAssets, ({ ok, paginate }) =>
    ok(paginate(assetCatalog().filter((item) => item.resourceId % 2 === 0)))),

  mock(reportAssetContract.usageTrend, ({ ok }) => ok(
    Array.from({ length: 7 }, (_, index) => ({
      bucket: mockDateTimeOffset(-(6 - index) * 86_400_000),
      views: 20 + index * 5,
      queries: 12 + index * 3,
      exports: 2 + index,
      embeds: 1 + index,
      shares: index,
      uniqueUsers: 5 + index,
    })),
  )),

  mock(reportAssetContract.usage, ({ params, ok }) => {
    if (!assetCatalog().some((item) => item.resourceType === params.resourceType && item.resourceId === params.id)) {
      return notFound('报表资产不存在', { status: 404 });
    }
    return ok(usageSummary(params.resourceType, params.id));
  }),

  mock(reportAssetContract.deprecations, ({ query, ok, paginate }) => {
    const list = mockReportDeprecations.filter((item) =>
      (!query.resourceType || item.resourceType === query.resourceType)
      && (!query.resourceId || item.resourceId === query.resourceId)
      && (query.published === undefined || Boolean(item.publishedAt) === query.published));
    return ok(paginate(list));
  }),

  mock(reportAssetContract.createDeprecation, ({ body, ok }) => {
    if (!assetCatalog().some((item) => item.resourceType === body.resourceType && item.resourceId === body.resourceId)) {
      return notFound('报表资产不存在', { status: 404 });
    }
    const now = mockDateTime();
    const notice: ReportDeprecationNotice = {
      ...body,
      id: nextReportP2Id('deprecation', mockReportDeprecations),
      tenantId: DEMO_TENANT_ID,
      replacementResourceType: body.replacementResourceType ?? null,
      replacementResourceId: body.replacementResourceId ?? null,
      expiresAt: body.expiresAt ?? null,
      publishedAt: null,
      publishedBy: null,
      processedAt: null,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportDeprecations.unshift(notice);
    return ok(notice, '创建成功');
  }),

  mock(reportAssetContract.updateDeprecation, ({ params, body, ok }) => {
    const notice = mockReportDeprecations.find((item) => item.id === params.id);
    if (!notice) return notFound('弃用公告不存在', { status: 404 });
    if (notice.publishedAt) return conflict('已发布公告不能编辑', { status: 409 });
    Object.assign(notice, body, { updatedBy: DEMO_USER_ID, updatedAt: mockDateTime() });
    return ok(notice, '更新成功');
  }),

  mock(reportAssetContract.publishDeprecation, ({ params, body, ok }) => {
    const notice = mockReportDeprecations.find((item) => item.id === params.id);
    if (!notice) return notFound('弃用公告不存在', { status: 404 });
    notice.publishedAt = body.publish ? mockDateTime() : null;
    notice.publishedBy = body.publish ? DEMO_USER_ID : null;
    notice.updatedAt = mockDateTime();
    return ok(notice, body.publish ? '发布成功' : '已撤销发布');
  }),

  mock(reportAssetContract.removeDeprecation, ({ params, ok }) => {
    const index = mockReportDeprecations.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('弃用公告不存在', { status: 404 });
    mockReportDeprecations.splice(index, 1);
    return ok(null, '删除成功');
  }),

  mock(reportAssetContract.templates, ({ query, ok, paginate }) => {
    const list = mockReportAssetTemplates.filter((item) =>
      (!query.keyword || item.name.includes(query.keyword) || item.code.includes(query.keyword))
      && (!query.type || item.type === query.type)
      && (!query.status || item.status === query.status));
    return ok(paginate(list));
  }),

  mock(reportAssetContract.templateDetail, ({ params, ok }) => {
    const template = mockReportAssetTemplates.find((item) => item.id === params.id);
    return template ? ok(template) : notFound('资产模板不存在', { status: 404 });
  }),

  mock(reportAssetContract.createTemplate, ({ body, ok }) => {
    if (mockReportAssetTemplates.some((item) => item.code === body.code)) return conflict('模板编码已存在', { status: 409 });
    const now = mockDateTime();
    const template: ReportAssetTemplate = {
      ...body,
      id: nextReportP2Id('asset-template', mockReportAssetTemplates),
      tenantId: DEMO_TENANT_ID,
      folderId: body.folderId ?? null,
      folderName: mockReportFolders.find((item) => item.id === body.folderId)?.name ?? null,
      ownerId: body.ownerId ?? DEMO_USER_ID,
      ownerName: DEMO_USER_NAME,
      previewFileId: body.previewFileId ?? null,
      version: 1,
      usageCount: 0,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportAssetTemplates.push(template);
    return ok(template, '创建成功');
  }),

  mock(reportAssetContract.updateTemplate, ({ params, body, ok }) => {
    const template = mockReportAssetTemplates.find((item) => item.id === params.id);
    if (!template) return notFound('资产模板不存在', { status: 404 });
    Object.assign(template, body, { version: template.version + 1, updatedBy: DEMO_USER_ID, updatedAt: mockDateTime() });
    return ok(template, '更新成功');
  }),

  mock(reportAssetContract.cloneTemplate, ({ params, body, ok }) => {
    const source = mockReportAssetTemplates.find((item) => item.id === params.id);
    if (!source) return notFound('资产模板不存在', { status: 404 });
    const now = mockDateTime();
    const copy: ReportAssetTemplate = {
      ...source,
      id: nextReportP2Id('asset-template', mockReportAssetTemplates),
      code: `${source.code}_copy_${mockReportAssetTemplates.length + 1}`,
      name: body.name,
      folderId: body.folderId ?? source.folderId,
      folderName: mockReportFolders.find((item) => item.id === (body.folderId ?? source.folderId))?.name ?? null,
      version: 1,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockReportAssetTemplates.push(copy);
    return ok(copy, '克隆成功');
  }),

  mock(reportAssetContract.applyTemplate, ({ params, body, ok }) => {
    const template = mockReportAssetTemplates.find((item) => item.id === params.id);
    if (!template) return notFound('资产模板不存在', { status: 404 });
    if (template.status !== 'enabled') return conflict('资产模板已停用', { status: 409 });
    let result: ReportAssetTemplateApplyResult;
    if (template.type === 'semantic_model') {
      const source = mockReportDatasets[0];
      const created = { ...source, id: getNextReportDatasetId(), name: body.name ?? template.name, folderId: body.folderId ?? template.folderId, ownerId: DEMO_USER_ID, createdAt: mockDateTime(), updatedAt: mockDateTime() };
      mockReportDatasets.push(created);
      result = { resourceType: 'dataset', resourceId: created.id, name: created.name };
    } else if (template.type === 'print') {
      const source = mockReportPrintTemplates[0];
      const created = { ...source, id: getNextReportPrintId(), name: body.name ?? template.name, folderId: body.folderId ?? template.folderId, ownerId: DEMO_USER_ID, createdAt: mockDateTime(), updatedAt: mockDateTime() };
      mockReportPrintTemplates.push(created);
      result = { resourceType: 'print_template', resourceId: created.id, name: created.name };
    } else if (template.type === 'widget') {
      const dashboard = mockReportDashboards.find((item) => item.id === body.targetResourceId);
      if (!dashboard) return badRequest('应用组件模板必须指定目标仪表盘', { status: 400 });
      const widgetId = `tpl_${template.id}_${dashboard.widgets.length + 1}`;
      dashboard.widgets.push({ i: widgetId, type: 'text', title: template.name, options: { text: '模板组件' } });
      dashboard.layout.push({ i: widgetId, x: 0, y: dashboard.layout.length * 4, w: 6, h: 4 });
      dashboard.revision += 1;
      dashboard.updatedAt = mockDateTime();
      result = { resourceType: 'dashboard', resourceId: dashboard.id, name: dashboard.name };
    } else {
      const source = mockReportDashboards[0];
      const created = { ...source, id: getNextReportDashboardId(), name: body.name ?? template.name, folderId: body.folderId ?? template.folderId, ownerId: DEMO_USER_ID, layout: [], canvasLayout: [], widgets: [], filters: [], lifecycleStatus: 'draft' as const, revision: 1, publishedSnapshot: null, publishedAt: null, publishedBy: null, publishedByName: null, createdAt: mockDateTime(), updatedAt: mockDateTime() };
      mockReportDashboards.push(created);
      result = { resourceType: 'dashboard', resourceId: created.id, name: created.name };
    }
    template.usageCount += 1;
    template.updatedAt = mockDateTime();
    return ok(result, '应用成功');
  }),

  mock(reportAssetContract.removeTemplate, ({ params, ok }) => {
    const index = mockReportAssetTemplates.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('资产模板不存在', { status: 404 });
    mockReportAssetTemplates.splice(index, 1);
    return ok(null, '删除成功');
  }),
];
