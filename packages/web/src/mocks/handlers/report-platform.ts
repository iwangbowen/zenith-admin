import type { ReportAclRole, ReportEnvironment, ReportEnvironmentPromotion, ReportFolder, ReportFolderTreeNode, ReportMetric, ReportPublishApproval, ReportResourceAcl, ReportResourceTransfer, ReportResourceType } from '@zenith/shared/report';
import { reportEnvironmentContract, reportFolderContract, reportGovernanceContract, reportMetricContract } from '@zenith/shared/report';
import {
  mockReportDashboards,
  mockReportDatasets,
  mockReportDatasources,
  mockReportPrintTemplates,
  getMockDatasetData,
} from '@/mocks/data/report';
import {
  mockReportAssetTemplates,
  mockReportEnvironments,
  mockReportFillTemplates,
  mockReportFolders,
  mockReportMetrics,
  mockReportPromotions,
  mockReportPublishApprovals,
  mockReportResourceAcls,
  mockReportResourceTransfers,
  nextReportP2Id,
} from '@/mocks/data/report-p2';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';
import { badRequest, conflict, forbidden, notFound } from '@/mocks/utils/handlers';
import { DEMO_TENANT_ID, DEMO_USER_ID, DEMO_USER_NAME } from './report-mock-utils';

type MutableResource = {
  id: number;
  name: string;
  ownerId?: number | null;
  ownerName?: string | null;
  folderId?: number | null;
  status?: string;
  updatedAt: string;
};

function resourceList(type: ReportResourceType): MutableResource[] {
  switch (type) {
    case 'datasource': return mockReportDatasources;
    case 'dataset': return mockReportDatasets;
    case 'dashboard': return mockReportDashboards;
    case 'metric': return mockReportMetrics;
    case 'print_template': return mockReportPrintTemplates;
    case 'fill_template': return mockReportFillTemplates;
    case 'asset_template': return mockReportAssetTemplates;
  }
}

function findResource(type: ReportResourceType, id: number): MutableResource | undefined {
  return resourceList(type).find((item) => item.id === id);
}

function folderTree(resourceType?: ReportResourceType): ReportFolderTreeNode[] {
  const rows = mockReportFolders
    .filter((folder) => (!resourceType || folder.resourceType === resourceType) && folder.status === 'enabled')
    .sort((a, b) => a.sort - b.sort || a.id - b.id);
  const build = (parentId: number | null): ReportFolderTreeNode[] => rows
    .filter((folder) => folder.parentId === parentId)
    .map((folder) => ({
      ...folder,
      ownerName: folder.ownerId === DEMO_USER_ID ? DEMO_USER_NAME : null,
      resourceCount: resourceList(folder.resourceType).filter((resource) => resource.folderId === folder.id).length,
      children: build(folder.id),
    }));
  return build(null);
}

function metricView(metric: ReportMetric): ReportMetric {
  const folder = mockReportFolders.find((item) => item.id === metric.folderId);
  const dataset = mockReportDatasets.find((item) => item.id === metric.datasetId);
  return {
    ...metric,
    folderName: folder?.name ?? null,
    ownerName: metric.ownerId === DEMO_USER_ID ? DEMO_USER_NAME : null,
    datasetName: dataset?.name ?? null,
  };
}

function roleAllows(actual: ReportAclRole, required: ReportAclRole): boolean {
  const weights: Record<ReportAclRole, number> = { viewer: 1, editor: 2, owner: 3 };
  return weights[actual] >= weights[required];
}

function hasAccess(resourceType: ReportResourceType, resourceId: number, requiredRole: ReportAclRole): boolean {
  const resource = findResource(resourceType, resourceId);
  if (!resource) return false;
  if (resource.ownerId == null || resource.ownerId === DEMO_USER_ID) return true;
  return mockReportResourceAcls.some((acl) =>
    acl.resourceType === resourceType
    && acl.resourceId === resourceId
    && acl.subjectType === 'user'
    && acl.subjectId === DEMO_USER_ID
    && roleAllows(acl.role, requiredRole)
    && (!acl.expiresAt || acl.expiresAt >= mockDateTime()));
}

function filterGovernance<T extends { resourceType: ReportResourceType; status: string }>(
  source: T[],
  query: { resourceType?: ReportResourceType; status?: string },
) {
  return source.filter((item) => (!query.resourceType || item.resourceType === query.resourceType) && (!query.status || item.status === query.status));
}

/** 指标发布 / 废弃：修订号匹配后推进生命周期 */
function transitionMetric(metric: ReportMetric, action: 'publish' | 'deprecate', reason?: string) {
  metric.revision += 1;
  metric.updatedAt = mockDateTime();
  if (action === 'publish') {
    metric.lifecycleStatus = 'published';
    metric.publishedAt = metric.updatedAt;
    metric.publishedBy = DEMO_USER_ID;
    metric.publishedSnapshot = {
      code: metric.code, name: metric.name, type: metric.type, datasetId: metric.datasetId,
      sourceField: metric.sourceField, formula: metric.formula, aggregate: metric.aggregate,
      dimensions: metric.dimensions, unit: metric.unit, format: metric.format,
    };
  } else {
    metric.lifecycleStatus = 'deprecated';
    metric.deprecatedAt = metric.updatedAt;
    metric.deprecatedBy = DEMO_USER_ID;
    metric.deprecationReason = reason ?? 'Demo 生命周期操作';
  }
}

const metricLifecycleHandler = (action: 'publish' | 'deprecate') =>
  mock(reportMetricContract[action], ({ params, body, ok }) => {
    const metric = mockReportMetrics.find((item) => item.id === params.id);
    if (!metric) return notFound('指标不存在', { status: 404 });
    if (body.expectedRevision !== metric.revision) return conflict('指标修订号不匹配', { status: 409 });
    transitionMetric(metric, action, body.reason);
    return ok(metricView(metric), '操作成功');
  });

export const reportPlatformHandlers = [
  mock(reportFolderContract.tree, ({ query, ok }) => ok(folderTree(query.resourceType))),

  mock(reportFolderContract.detail, ({ params, ok }) => {
    const folder = mockReportFolders.find((item) => item.id === params.id);
    return folder ? ok({ ...folder, ownerName: folder.ownerId === DEMO_USER_ID ? DEMO_USER_NAME : null }) : notFound('资源目录不存在', { status: 404 });
  }),

  mock(reportFolderContract.create, ({ body, ok }) => {
    if (body.parentId && !mockReportFolders.some((item) => item.id === body.parentId && item.resourceType === body.resourceType)) {
      return badRequest('父目录不存在或资源类型不一致', { status: 400 });
    }
    const now = mockDateTime();
    const folder: ReportFolder = {
      id: nextReportP2Id('folder', mockReportFolders),
      tenantId: DEMO_TENANT_ID,
      parentId: body.parentId ?? null,
      name: body.name,
      resourceType: body.resourceType,
      ownerId: body.ownerId ?? DEMO_USER_ID,
      sort: body.sort,
      status: body.status,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportFolders.push(folder);
    return ok(folder, '创建成功');
  }),

  mock(reportFolderContract.update, ({ params, body, ok }) => {
    const folder = mockReportFolders.find((item) => item.id === params.id);
    if (!folder) return notFound('资源目录不存在', { status: 404 });
    Object.assign(folder, body, { updatedBy: DEMO_USER_ID, updatedAt: mockDateTime() });
    return ok(folder, '更新成功');
  }),

  mock(reportFolderContract.move, ({ params, body, ok }) => {
    const folder = mockReportFolders.find((item) => item.id === params.id);
    if (!folder) return notFound('资源目录不存在', { status: 404 });
    if (body.parentId === folder.id) return badRequest('目录不能移动到自身', { status: 400 });
    const parent = body.parentId ? mockReportFolders.find((item) => item.id === body.parentId) : null;
    if (body.parentId && (!parent || parent.resourceType !== folder.resourceType)) return badRequest('目标父目录不存在或资源类型不一致', { status: 400 });
    folder.parentId = body.parentId;
    folder.sort = body.sort ?? folder.sort;
    folder.updatedAt = mockDateTime();
    return ok(folder, '移动成功');
  }),

  mock(reportFolderContract.remove, ({ params, ok }) => {
    const index = mockReportFolders.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('资源目录不存在', { status: 404 });
    if (mockReportFolders.some((item) => item.parentId === params.id) || resourceList(mockReportFolders[index].resourceType).some((item) => item.folderId === params.id)) {
      return conflict('目录非空，不能删除', { status: 409 });
    }
    mockReportFolders.splice(index, 1);
    return ok(null, '删除成功');
  }),

  mock(reportMetricContract.lookup, ({ query, ok }) => {
    const list = mockReportMetrics
      .filter((item) => (!query.keyword || item.name.includes(query.keyword) || item.code.includes(query.keyword)) && (!query.status || item.lifecycleStatus === query.status))
      .slice(0, query.limit)
      .map((item) => ({ id: item.id, name: item.name, code: item.code, status: item.lifecycleStatus, datasetId: item.datasetId, type: 'metric' as const }));
    return ok(list);
  }),

  mock(reportMetricContract.list, ({ query, ok, paginate }) => {
    const list = mockReportMetrics.filter((item) =>
      (!query.keyword || item.name.includes(query.keyword) || item.code.includes(query.keyword))
      && (!query.datasetId || item.datasetId === query.datasetId)
      && (!query.folderId || item.folderId === query.folderId)
      && (!query.ownerId || item.ownerId === query.ownerId)
      && (!query.type || item.type === query.type)
      && (!query.status || item.lifecycleStatus === query.status))
      .map(metricView);
    return ok(paginate(list));
  }),

  mock(reportMetricContract.refs, ({ params, ok }) => {
    const metric = mockReportMetrics.find((item) => item.id === params.id);
    if (!metric) return notFound('指标不存在', { status: 404 });
    const dashboards = mockReportDashboards.flatMap((dashboard) => {
      const widgets = dashboard.widgets.filter((widget) => widget.metricId === metric.id).map((widget) => widget.i);
      return widgets.length ? [{ id: dashboard.id, name: dashboard.name, widgets }] : [];
    });
    const metrics = mockReportMetrics
      .filter((item) => item.id !== metric.id && (item.formula ?? '').includes(metric.code))
      .map((item) => ({ id: item.id, code: item.code, name: item.name }));
    return ok({ dashboards, alerts: [], metrics });
  }),

  mock(reportMetricContract.detail, ({ params, ok }) => {
    const metric = mockReportMetrics.find((item) => item.id === params.id);
    return metric ? ok(metricView(metric)) : notFound('指标不存在', { status: 404 });
  }),

  mock(reportMetricContract.create, ({ body, ok }) => {
    if (mockReportMetrics.some((item) => item.code === body.code)) return conflict('指标编码已存在', { status: 409 });
    const now = mockDateTime();
    const metric: ReportMetric = {
      ...body,
      id: nextReportP2Id('metric', mockReportMetrics),
      tenantId: DEMO_TENANT_ID,
      folderId: body.folderId ?? null,
      ownerId: body.ownerId ?? DEMO_USER_ID,
      lifecycleStatus: 'draft',
      revision: 1,
      publishedSnapshot: null,
      publishedAt: null,
      publishedBy: null,
      deprecatedAt: null,
      deprecatedBy: null,
      deprecationReason: null,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportMetrics.push(metric);
    return ok(metricView(metric), '创建成功');
  }),

  mock(reportMetricContract.update, ({ params, body, ok }) => {
    const metric = mockReportMetrics.find((item) => item.id === params.id);
    if (!metric) return notFound('指标不存在', { status: 404 });
    if (body.expectedRevision !== metric.revision) return conflict('指标已被其他用户修改', { status: 409 });
    const { expectedRevision: _expectedRevision, ...patch } = body;
    Object.assign(metric, patch, { revision: metric.revision + 1, updatedBy: DEMO_USER_ID, updatedAt: mockDateTime() });
    return ok(metricView(metric), '更新成功');
  }),

  mock(reportMetricContract.evaluate, ({ params, ok }) => {
    const metric = mockReportMetrics.find((item) => item.id === params.id);
    if (!metric) return notFound('指标不存在', { status: 404 });
    const data = getMockDatasetData(metric.datasetId);
    const values = data.rows.map((row) => Number(row[metric.sourceField ?? 'value'] ?? 0)).filter(Number.isFinite);
    const value = metric.aggregate === 'avg'
      ? values.reduce((sum, item) => sum + item, 0) / Math.max(values.length, 1)
      : values.reduce((sum, item) => sum + item, 0);
    return ok({
      metricId: metric.id,
      code: metric.code,
      value,
      formattedValue: new Intl.NumberFormat('zh-CN').format(value),
      unit: metric.unit ?? null,
      durationMs: 18,
      cacheHit: true,
    });
  }),

  metricLifecycleHandler('publish'),
  metricLifecycleHandler('deprecate'),

  mock(reportMetricContract.remove, ({ params, ok }) => {
    const index = mockReportMetrics.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('指标不存在', { status: 404 });
    if (mockReportMetrics[index].lifecycleStatus === 'published') return conflict('已发布指标不能删除', { status: 409 });
    mockReportMetrics.splice(index, 1);
    return ok(null, '删除成功');
  }),

  mock(reportGovernanceContract.acls, ({ query, ok }) => {
    const list = mockReportResourceAcls.filter((item) =>
      item.resourceType === query.resourceType
      && item.resourceId === query.resourceId
      && item.inheritFromFolder === query.inheritFromFolder);
    return ok(list);
  }),

  mock(reportGovernanceContract.grantAcl, ({ body, ok }) => {
    if (!findResource(body.resourceType, body.resourceId)) return notFound('资源不存在', { status: 404 });
    if (!hasAccess(body.resourceType, body.resourceId, 'owner')) return forbidden('仅资源所有者可授权', { status: 403 });
    const now = mockDateTime();
    const acl: ReportResourceAcl = {
      ...body,
      id: nextReportP2Id('acl', mockReportResourceAcls),
      tenantId: DEMO_TENANT_ID,
      expiresAt: body.expiresAt ?? null,
      grantedBy: DEMO_USER_ID,
      grantedByName: DEMO_USER_NAME,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportResourceAcls.push(acl);
    return ok(acl, '授权成功');
  }),

  mock(reportGovernanceContract.updateAcl, ({ params, body, ok }) => {
    const acl = mockReportResourceAcls.find((item) => item.id === params.id);
    if (!acl) return notFound('授权记录不存在', { status: 404 });
    Object.assign(acl, body, { updatedBy: DEMO_USER_ID, updatedAt: mockDateTime() });
    return ok(acl, '更新成功');
  }),

  mock(reportGovernanceContract.revokeAcl, ({ params, ok }) => {
    const index = mockReportResourceAcls.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('授权记录不存在', { status: 404 });
    mockReportResourceAcls.splice(index, 1);
    return ok(null, '撤销成功');
  }),

  mock(reportGovernanceContract.checkAccess, ({ body, ok }) =>
    ok({ allowed: hasAccess(body.resourceType, body.resourceId, body.requiredRole), requiredRole: body.requiredRole })),

  mock(reportGovernanceContract.approvals, ({ query, ok, paginate }) =>
    ok(paginate(filterGovernance(mockReportPublishApprovals, query)))),

  mock(reportGovernanceContract.createApproval, ({ body, ok }) => {
    const resource = findResource(body.resourceType, body.resourceId);
    if (!resource) return notFound('资源不存在', { status: 404 });
    const now = mockDateTime();
    const { note: _note, ...rest } = body;
    const approval: ReportPublishApproval = {
      ...rest,
      id: nextReportP2Id('approval', mockReportPublishApprovals),
      tenantId: DEMO_TENANT_ID,
      resourceName: resource.name,
      status: 'pending',
      requestedBy: DEMO_USER_ID,
      requestedByName: DEMO_USER_NAME,
      requestedAt: now,
      decidedBy: null,
      decidedByName: null,
      decidedAt: null,
      decisionNote: null,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportPublishApprovals.unshift(approval);
    return ok(approval, '申请成功');
  }),

  mock(reportGovernanceContract.decideApproval, ({ params, body, ok }) => {
    const approval = mockReportPublishApprovals.find((item) => item.id === params.id);
    if (!approval) return notFound('审批不存在', { status: 404 });
    if (approval.status !== 'pending') return conflict('审批已处理', { status: 409 });
    approval.status = body.decision;
    approval.decidedBy = DEMO_USER_ID;
    approval.decidedByName = DEMO_USER_NAME;
    approval.decidedAt = mockDateTime();
    approval.decisionNote = body.note ?? null;
    approval.updatedAt = approval.decidedAt;
    return ok(approval, '审批完成');
  }),

  mock(reportGovernanceContract.cancelApproval, ({ params, body, ok }) => {
    const approval = mockReportPublishApprovals.find((item) => item.id === params.id);
    if (!approval) return notFound('审批不存在', { status: 404 });
    if (approval.status !== 'pending' || approval.requestedBy !== DEMO_USER_ID) return forbidden('不能取消该审批', { status: 403 });
    approval.status = 'cancelled';
    approval.decisionNote = body.reason ?? null;
    approval.updatedAt = mockDateTime();
    return ok(approval, '已取消');
  }),

  mock(reportGovernanceContract.transfers, ({ query, ok, paginate }) =>
    ok(paginate(filterGovernance(mockReportResourceTransfers, query)))),

  mock(reportGovernanceContract.createTransfer, ({ body, ok }) => {
    const resource = findResource(body.resourceType, body.resourceId);
    if (!resource) return notFound('资源不存在', { status: 404 });
    if (!hasAccess(body.resourceType, body.resourceId, 'owner')) return forbidden('仅资源所有者可转移', { status: 403 });
    const now = mockDateTime();
    const transfer: ReportResourceTransfer = {
      ...body,
      id: nextReportP2Id('transfer', mockReportResourceTransfers),
      tenantId: DEMO_TENANT_ID,
      resourceName: resource.name,
      fromOwnerId: resource.ownerId ?? null,
      fromOwnerName: resource.ownerId === DEMO_USER_ID ? DEMO_USER_NAME : null,
      toOwnerName: body.toOwnerId === DEMO_USER_ID ? DEMO_USER_NAME : `用户 ${body.toOwnerId}`,
      status: 'pending',
      requestedBy: DEMO_USER_ID,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportResourceTransfers.unshift(transfer);
    return ok(transfer, '转移申请已创建');
  }),

  mock(reportGovernanceContract.decideTransfer, ({ params, body, ok }) => {
    const transfer = mockReportResourceTransfers.find((item) => item.id === params.id);
    if (!transfer) return notFound('转移申请不存在', { status: 404 });
    if (transfer.status !== 'pending') return conflict('转移申请已处理', { status: 409 });
    transfer.status = body.decision;
    transfer.decidedBy = DEMO_USER_ID;
    transfer.decidedAt = mockDateTime();
    transfer.decisionNote = body.note ?? null;
    transfer.updatedAt = transfer.decidedAt;
    if (body.decision === 'accepted') {
      const resource = findResource(transfer.resourceType, transfer.resourceId);
      if (resource) {
        resource.ownerId = transfer.toOwnerId;
        resource.ownerName = transfer.toOwnerName;
        resource.updatedAt = transfer.decidedAt;
      }
    }
    return ok(transfer, '转移申请已处理');
  }),

  mock(reportGovernanceContract.cancelTransfer, ({ params, body, ok }) => {
    const transfer = mockReportResourceTransfers.find((item) => item.id === params.id);
    if (!transfer) return notFound('转移申请不存在', { status: 404 });
    if (transfer.status !== 'pending' || transfer.requestedBy !== DEMO_USER_ID) return forbidden('不能取消该转移申请', { status: 403 });
    transfer.status = 'cancelled';
    transfer.decisionNote = body.reason ?? null;
    transfer.updatedAt = mockDateTime();
    return ok(transfer, '已取消');
  }),

  mock(reportEnvironmentContract.list, ({ ok }) => ok(mockReportEnvironments)),

  mock(reportEnvironmentContract.create, ({ body, ok }) => {
    if (mockReportEnvironments.some((item) => item.code === body.code)) return conflict('环境编码已存在', { status: 409 });
    if (body.isDefault) mockReportEnvironments.forEach((item) => { item.isDefault = false; });
    const now = mockDateTime();
    const environment: ReportEnvironment = {
      ...body,
      id: nextReportP2Id('environment', mockReportEnvironments),
      tenantId: DEMO_TENANT_ID,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportEnvironments.push(environment);
    return ok(environment, '创建成功');
  }),

  mock(reportEnvironmentContract.update, ({ params, body, ok }) => {
    const environment = mockReportEnvironments.find((item) => item.id === params.id);
    if (!environment) return notFound('环境不存在', { status: 404 });
    if (body.isDefault) mockReportEnvironments.forEach((item) => { item.isDefault = item.id === environment.id; });
    Object.assign(environment, body, { updatedBy: DEMO_USER_ID, updatedAt: mockDateTime() });
    return ok(environment, '更新成功');
  }),

  mock(reportEnvironmentContract.remove, ({ params, ok }) => {
    const index = mockReportEnvironments.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('环境不存在', { status: 404 });
    if (mockReportEnvironments[index].isDefault) return conflict('默认环境不能删除', { status: 409 });
    mockReportEnvironments.splice(index, 1);
    return ok(null, '删除成功');
  }),

  mock(reportEnvironmentContract.promotions, ({ query, ok, paginate }) => {
    const list = mockReportPromotions.filter((item) =>
      (!query.resourceType || item.resourceType === query.resourceType)
      && (!query.status || item.status === query.status));
    return ok(paginate(list));
  }),

  mock(reportEnvironmentContract.createPromotion, ({ body, ok }) => {
    const resource = findResource(body.resourceType, body.resourceId);
    const source = mockReportEnvironments.find((item) => item.id === body.sourceEnvironmentId);
    const target = mockReportEnvironments.find((item) => item.id === body.targetEnvironmentId);
    if (!resource || !source || !target) return notFound('资源或环境不存在', { status: 404 });
    if (source.id === target.id) return badRequest('来源环境和目标环境不能相同', { status: 400 });
    const now = mockDateTime();
    const promotion: ReportEnvironmentPromotion = {
      ...body,
      id: nextReportP2Id('promotion', mockReportPromotions),
      tenantId: DEMO_TENANT_ID,
      resourceName: resource.name,
      sourceEnvironmentName: source.name,
      targetEnvironmentName: target.name,
      targetSnapshot: null,
      rollbackSnapshot: null,
      status: 'pending',
      requestedBy: DEMO_USER_ID,
      approvedBy: null,
      deployedBy: null,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportPromotions.unshift(promotion);
    return ok(promotion, '发布申请已创建');
  }),

  mock(reportEnvironmentContract.transitionPromotion, ({ params, body, ok }) => {
    const promotion = mockReportPromotions.find((item) => item.id === params.id);
    if (!promotion) return notFound('发布记录不存在', { status: 404 });
    if (promotion.status !== body.expectedStatus) return conflict('发布状态已变化', { status: 409 });
    const now = mockDateTime();
    if (body.action === 'approve' && promotion.status === 'pending') {
      promotion.status = 'approved';
      promotion.approvedBy = DEMO_USER_ID;
    } else if (body.action === 'deploy' && promotion.status === 'approved') {
      promotion.status = 'succeeded';
      promotion.deployedBy = DEMO_USER_ID;
      promotion.startedAt = now;
      promotion.completedAt = now;
      promotion.targetSnapshot = promotion.sourceSnapshot;
    } else if (body.action === 'rollback' && promotion.status === 'succeeded') {
      promotion.status = 'rolled_back';
      promotion.rollbackSnapshot = promotion.targetSnapshot;
      promotion.completedAt = now;
    } else if (body.action === 'cancel' && ['pending', 'approved'].includes(promotion.status)) {
      promotion.status = 'cancelled';
      promotion.completedAt = now;
    } else {
      return conflict('当前状态不允许该操作', { status: 409 });
    }
    promotion.updatedAt = now;
    return ok(promotion, '操作成功');
  }),
];
