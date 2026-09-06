import { requireRow } from '../../lib/db-assert';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, or } from 'drizzle-orm';
import type { CreateReportEnvironmentInput, CreateReportEnvironmentPromotionInput, CreateReportPublishApprovalInput, CreateReportResourceTransferInput, DecideReportPublishApprovalInput, DecideReportResourceTransferInput, ReportApprovalStatus, ReportDashboardSnapshot, ReportCanvasItem, ReportDashboardConfig, ReportFilter, ReportGridItem, ReportWidget, ReportEnvironment, ReportEnvironmentPromotion, ReportEnvironmentPromotionActionInput, ReportPromotionStatus, ReportPublishApproval, ReportResourceTransfer, ReportResourceType, ReportTransferStatus, UpdateReportEnvironmentInput } from '@zenith/shared/report';
import { db } from '../../db';
import {
  reportDashboards,
  reportEnvironmentPromotions,
  reportEnvironments,
  reportMetrics,
  reportPublishApprovals,
  reportResourceTransfers,
} from '../../db/schema';
import { currentUserId, isSuperAdmin } from '../../lib/context';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { clearDefaultFlag } from '../../lib/default-flag';
import { exactTenantCondition } from '../../lib/tenant';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { reportCreateTenantId, reportScopedWhere, reportTenantScope } from './report-access';
import { ensureReportResourceAccess } from './report-resource-acl.service';
import {
  ensureReportOwner,
  resolveReportResource,
  resolveReportResourceNames,
  setReportResourceOwner,
} from './report-resource.service';
import { buildWhere } from '../../lib/where-helpers';

type TransferRow = typeof reportResourceTransfers.$inferSelect & {
  fromOwner?: { nickname: string | null; username: string } | null;
  toOwner?: { nickname: string | null; username: string } | null;
};

type ApprovalRow = typeof reportPublishApprovals.$inferSelect & {
  requestedByUser?: { nickname: string | null; username: string } | null;
  decidedByUser?: { nickname: string | null; username: string } | null;
};

type PromotionRow = typeof reportEnvironmentPromotions.$inferSelect & {
  sourceEnvironment?: { name: string } | null;
  targetEnvironment?: { name: string } | null;
};

export function assertGovernedResourceRevision(
  currentRevision: number | null,
  expectedRevision: number,
  message = '资源版本已变更，请刷新后重试',
): void {
  if (currentRevision !== expectedRevision) throw new HTTPException(409, { message });
}

export function assertPendingGovernanceStatus(
  status: ReportTransferStatus | ReportApprovalStatus,
  label: string,
): void {
  if (status !== 'pending') throw new HTTPException(409, { message: `${label}已处理` });
}

function canonicalSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSnapshotValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalSnapshotValue(record[key])]));
  }
  return value;
}

export function reportResourceSnapshotsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return JSON.stringify(canonicalSnapshotValue(left)) === JSON.stringify(canonicalSnapshotValue(right));
}

function userName(user: { nickname: string | null; username: string } | null | undefined): string | null {
  return user?.nickname || user?.username || null;
}

function dashboardSnapshotFromRecord(snapshot: Record<string, unknown>): ReportDashboardSnapshot {
  if (typeof snapshot.name !== 'string'
    || !Array.isArray(snapshot.layout)
    || !Array.isArray(snapshot.widgets)
    || !Array.isArray(snapshot.filters)
    || !snapshot.config
    || typeof snapshot.config !== 'object'
    || Array.isArray(snapshot.config)) {
    throw new HTTPException(409, { message: '审批快照不完整，无法发布' });
  }
  return {
    name: snapshot.name,
    layout: snapshot.layout as ReportGridItem[],
    canvasLayout: Array.isArray(snapshot.canvasLayout) ? snapshot.canvasLayout as ReportCanvasItem[] : [],
    widgets: snapshot.widgets as ReportWidget[],
    filters: snapshot.filters as ReportFilter[],
    config: snapshot.config as ReportDashboardConfig,
    categoryId: typeof snapshot.categoryId === 'number' ? snapshot.categoryId : null,
    remark: typeof snapshot.remark === 'string' ? snapshot.remark : null,
  };
}

export function mapReportResourceTransfer(row: TransferRow, resourceName?: string | null): ReportResourceTransfer {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    resourceName: resourceName ?? null,
    fromOwnerId: row.fromOwnerId ?? null,
    fromOwnerName: userName(row.fromOwner),
    toOwnerId: row.toOwnerId,
    toOwnerName: userName(row.toOwner),
    status: row.status,
    reason: row.reason ?? null,
    requestedBy: row.requestedBy ?? null,
    decidedBy: row.decidedBy ?? null,
    decidedAt: formatNullableDateTime(row.decidedAt),
    decisionNote: row.decisionNote ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function createReportResourceTransfer(
  input: CreateReportResourceTransferInput,
): Promise<ReportResourceTransfer> {
  const resource = await ensureReportResourceAccess(input.resourceType, input.resourceId, 'owner');
  if (resource.ownerId === input.toOwnerId || (!resource.ownerId && resource.createdBy === input.toOwnerId)) {
    throw new HTTPException(400, { message: '目标负责人已经是当前负责人' });
  }
  await ensureReportOwner(input.toOwnerId, resource.tenantId);
  const pending = await db.$count(reportResourceTransfers, reportScopedWhere(
    reportResourceTransfers,
    and(
      eq(reportResourceTransfers.resourceType, input.resourceType),
      eq(reportResourceTransfers.resourceId, input.resourceId),
      eq(reportResourceTransfers.status, 'pending'),
    )!,
  ));
  if (pending > 0) throw new HTTPException(409, { message: '该资源已有待处理的转移申请' });
  const [row] = await db.insert(reportResourceTransfers).values({
    tenantId: resource.tenantId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    fromOwnerId: resource.ownerId ?? resource.createdBy,
    toOwnerId: input.toOwnerId,
    reason: input.reason ?? null,
    requestedBy: currentUserId(),
  }).returning();
  return mapReportResourceTransfer(row, resource.name);
}

export async function listReportResourceTransfers(query: {
  page?: number;
  pageSize?: number;
  status?: ReportTransferStatus;
  resourceType?: ReportResourceType;
}) {
  const { page = 1, pageSize = 20, status, resourceType } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportResourceTransfers);
  if (tenantScope) conds.push(tenantScope);
  if (status) conds.push(eq(reportResourceTransfers.status, status));
  if (resourceType) conds.push(eq(reportResourceTransfers.resourceType, resourceType));
  const where = buildWhere(...conds);
  const [total, rows] = await Promise.all([
    db.$count(reportResourceTransfers, where),
    db.query.reportResourceTransfers.findMany({
      where,
      with: {
        fromOwner: { columns: { nickname: true, username: true } },
        toOwner: { columns: { nickname: true, username: true } },
      },
      orderBy: desc(reportResourceTransfers.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  const names = await resolveReportResourceNames(rows);
  const list = rows.map((row) => mapReportResourceTransfer(row, names.get(`${row.resourceType}:${row.resourceId}`) ?? null));
  return { list, total, page, pageSize };
}

async function ensureTransfer(id: number) {
  const rowOrUndefined = await db.query.reportResourceTransfers.findFirst({
    where: reportScopedWhere(reportResourceTransfers, eq(reportResourceTransfers.id, id)),
    with: {
      fromOwner: { columns: { nickname: true, username: true } },
      toOwner: { columns: { nickname: true, username: true } },
    },
  });
  const row = requireRow(rowOrUndefined, '资源转移申请不存在');
  return row;
}

export async function decideReportResourceTransfer(
  id: number,
  input: DecideReportResourceTransferInput,
): Promise<ReportResourceTransfer> {
  const transfer = await ensureTransfer(id);
  assertPendingGovernanceStatus(transfer.status, '资源转移申请');
  const userId = currentUserId();
  if (!isSuperAdmin() && transfer.toOwnerId !== userId) {
    throw new HTTPException(403, { message: '仅目标负责人可处理转移申请' });
  }
  const resource = await resolveReportResource(transfer.resourceType, transfer.resourceId);
  const status = input.decision;
  if (status === 'accepted' && (resource.ownerId ?? resource.createdBy) !== transfer.fromOwnerId) {
    throw new HTTPException(409, { message: '资源负责人已变更，转移申请已失效' });
  }
  const rowOrUndefined = await db.transaction(async (tx) => {
    if (status === 'accepted') {
      await ensureReportOwner(transfer.toOwnerId, resource.tenantId);
      await setReportResourceOwner(tx, transfer.resourceType, transfer.resourceId, transfer.toOwnerId);
    }
    const [updated] = await tx.update(reportResourceTransfers).set({
      status,
      decidedBy: userId,
      decidedAt: new Date(),
      decisionNote: input.note ?? null,
    }).where(and(eq(reportResourceTransfers.id, id), eq(reportResourceTransfers.status, 'pending'))).returning();
    return updated;
  });
  const row = requireRow(rowOrUndefined, '资源转移申请已处理', 409);
  return mapReportResourceTransfer(row, resource.name);
}

export async function cancelReportResourceTransfer(id: number, reason?: string): Promise<ReportResourceTransfer> {
  const transfer = await ensureTransfer(id);
  assertPendingGovernanceStatus(transfer.status, '资源转移申请');
  const userId = currentUserId();
  if (!isSuperAdmin() && transfer.requestedBy !== userId) throw new HTTPException(403, { message: '仅申请人可取消转移' });
  const [rowOrUndefined] = await db.update(reportResourceTransfers).set({
    status: 'cancelled',
    decidedBy: userId,
    decidedAt: new Date(),
    decisionNote: reason ?? null,
  }).where(and(eq(reportResourceTransfers.id, id), eq(reportResourceTransfers.status, 'pending'))).returning();
  const row = requireRow(rowOrUndefined, '资源转移申请已处理', 409);
  return mapReportResourceTransfer(row);
}

export function mapReportPublishApproval(row: ApprovalRow, resourceName?: string | null): ReportPublishApproval {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    resourceName: resourceName ?? null,
    action: row.action,
    requestedRevision: row.requestedRevision,
    snapshot: row.snapshot,
    status: row.status,
    requestedBy: row.requestedBy ?? null,
    requestedByName: userName(row.requestedByUser),
    requestedAt: formatDateTime(row.requestedAt),
    decidedBy: row.decidedBy ?? null,
    decidedByName: userName(row.decidedByUser),
    decidedAt: formatNullableDateTime(row.decidedAt),
    decisionNote: row.decisionNote ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function createReportPublishApproval(
  input: CreateReportPublishApprovalInput,
): Promise<ReportPublishApproval> {
  const resource = await ensureReportResourceAccess(input.resourceType, input.resourceId, 'editor');
  assertGovernedResourceRevision(resource.revision, input.requestedRevision, '资源版本已变更，请刷新后重新提交审批');
  if (input.action === 'publish' && input.resourceType !== 'dashboard' && input.resourceType !== 'metric') {
    throw new HTTPException(400, { message: '仅仪表盘和指标支持发布审批' });
  }
  if (input.action === 'deprecate' && input.resourceType !== 'metric') {
    throw new HTTPException(400, { message: '仅指标支持废弃审批' });
  }
  const pending = await db.$count(reportPublishApprovals, reportScopedWhere(
    reportPublishApprovals,
    and(
      eq(reportPublishApprovals.resourceType, input.resourceType),
      eq(reportPublishApprovals.resourceId, input.resourceId),
      eq(reportPublishApprovals.action, input.action),
      eq(reportPublishApprovals.status, 'pending'),
    )!,
  ));
  if (pending > 0) throw new HTTPException(409, { message: '该资源已有待处理的审批申请' });
  const [row] = await db.insert(reportPublishApprovals).values({
    tenantId: resource.tenantId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    action: input.action,
    requestedRevision: resource.revision,
    snapshot: resource.snapshot,
    requestedBy: currentUserId(),
    decisionNote: input.note ?? null,
  }).returning();
  return mapReportPublishApproval(row, resource.name);
}

export async function listReportPublishApprovals(query: {
  page?: number;
  pageSize?: number;
  status?: ReportApprovalStatus;
  resourceType?: ReportResourceType;
}) {
  const { page = 1, pageSize = 20, status, resourceType } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportPublishApprovals);
  if (tenantScope) conds.push(tenantScope);
  if (status) conds.push(eq(reportPublishApprovals.status, status));
  if (resourceType) conds.push(eq(reportPublishApprovals.resourceType, resourceType));
  const where = buildWhere(...conds);
  const [total, rows] = await Promise.all([
    db.$count(reportPublishApprovals, where),
    db.query.reportPublishApprovals.findMany({
      where,
      with: {
        requestedByUser: { columns: { nickname: true, username: true } },
        decidedByUser: { columns: { nickname: true, username: true } },
      },
      orderBy: desc(reportPublishApprovals.requestedAt),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  const names = await resolveReportResourceNames(rows);
  const list = rows.map((row) => mapReportPublishApproval(row, names.get(`${row.resourceType}:${row.resourceId}`) ?? null));
  return { list, total, page, pageSize };
}

async function ensureApproval(id: number) {
  const rowOrUndefined = await db.query.reportPublishApprovals.findFirst({
    where: reportScopedWhere(reportPublishApprovals, eq(reportPublishApprovals.id, id)),
    with: {
      requestedByUser: { columns: { nickname: true, username: true } },
      decidedByUser: { columns: { nickname: true, username: true } },
    },
  });
  const row = requireRow(rowOrUndefined, '发布审批不存在');
  return row;
}

export async function decideReportPublishApproval(
  id: number,
  input: DecideReportPublishApprovalInput,
): Promise<ReportPublishApproval> {
  const approval = await ensureApproval(id);
  assertPendingGovernanceStatus(approval.status, '发布审批');
  const resource = await resolveReportResource(approval.resourceType, approval.resourceId);
  if (input.decision === 'approved') {
    assertGovernedResourceRevision(resource.revision, approval.requestedRevision, '资源版本已变更，审批请求已失效');
  }
  const decidedBy = currentUserId();
  const rowOrUndefined = await db.transaction(async (tx) => {
    if (input.decision === 'approved' && approval.action === 'publish') {
      if (approval.resourceType === 'dashboard') {
        const [updatedOrUndefined] = await tx.update(reportDashboards).set({
          lifecycleStatus: 'published',
          publishedSnapshot: dashboardSnapshotFromRecord(approval.snapshot),
          publishedAt: new Date(),
          publishedBy: decidedBy,
          revision: approval.requestedRevision + 1,
        }).where(and(
          eq(reportDashboards.id, approval.resourceId),
          eq(reportDashboards.revision, approval.requestedRevision),
        )).returning({ id: reportDashboards.id });
        requireRow(updatedOrUndefined, '仪表盘版本已变更，审批请求已失效', 409);
      } else if (approval.resourceType === 'metric') {
        const [updatedOrUndefined] = await tx.update(reportMetrics).set({
          lifecycleStatus: 'published',
          publishedSnapshot: approval.snapshot,
          publishedAt: new Date(),
          publishedBy: decidedBy,
          revision: approval.requestedRevision + 1,
        }).where(and(
          eq(reportMetrics.id, approval.resourceId),
          eq(reportMetrics.revision, approval.requestedRevision),
        )).returning({ id: reportMetrics.id });
        requireRow(updatedOrUndefined, '指标版本已变更，审批请求已失效', 409);
      }
    } else if (input.decision === 'approved' && approval.action === 'deprecate' && approval.resourceType === 'metric') {
      const [updatedOrUndefined] = await tx.update(reportMetrics).set({
        lifecycleStatus: 'deprecated',
        deprecatedAt: new Date(),
        deprecatedBy: decidedBy,
        deprecationReason: input.note ?? null,
        revision: approval.requestedRevision + 1,
      }).where(and(
        eq(reportMetrics.id, approval.resourceId),
        eq(reportMetrics.revision, approval.requestedRevision),
      )).returning({ id: reportMetrics.id });
      requireRow(updatedOrUndefined, '指标版本已变更，审批请求已失效', 409);
    }
    const [updatedApproval] = await tx.update(reportPublishApprovals).set({
      status: input.decision,
      decidedBy,
      decidedAt: new Date(),
      decisionNote: input.note ?? null,
    }).where(and(eq(reportPublishApprovals.id, id), eq(reportPublishApprovals.status, 'pending'))).returning();
    return updatedApproval;
  });
  const row = requireRow(rowOrUndefined, '发布审批已处理', 409);
  return mapReportPublishApproval(row, resource.name);
}

export async function cancelReportPublishApproval(id: number, reason?: string): Promise<ReportPublishApproval> {
  const approval = await ensureApproval(id);
  assertPendingGovernanceStatus(approval.status, '发布审批');
  const userId = currentUserId();
  if (!isSuperAdmin() && approval.requestedBy !== userId) throw new HTTPException(403, { message: '仅申请人可取消审批' });
  const [rowOrUndefined] = await db.update(reportPublishApprovals).set({
    status: 'cancelled',
    decidedBy: userId,
    decidedAt: new Date(),
    decisionNote: reason ?? null,
  }).where(and(eq(reportPublishApprovals.id, id), eq(reportPublishApprovals.status, 'pending'))).returning();
  const row = requireRow(rowOrUndefined, '发布审批已处理', 409);
  return mapReportPublishApproval(row);
}

export function mapReportEnvironment(row: typeof reportEnvironments.$inferSelect): ReportEnvironment {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    code: row.code,
    name: row.name,
    kind: row.kind,
    description: row.description ?? null,
    baseUrl: row.baseUrl ?? null,
    config: row.config ?? {},
    isDefault: row.isDefault,
    status: row.status,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listReportEnvironments(): Promise<ReportEnvironment[]> {
  const rows = await db.select().from(reportEnvironments)
    .where(reportTenantScope(reportEnvironments)).orderBy(desc(reportEnvironments.isDefault), desc(reportEnvironments.id));
  return rows.map(mapReportEnvironment);
}

export async function getReportEnvironment(id: number) {
  const [rowOrUndefined] = await db.select().from(reportEnvironments)
    .where(reportScopedWhere(reportEnvironments, eq(reportEnvironments.id, id))).limit(1);
  const row = requireRow(rowOrUndefined, '报表环境不存在');
  return row;
}

export async function createReportEnvironment(input: CreateReportEnvironmentInput): Promise<ReportEnvironment> {
  const tenantId = reportCreateTenantId();
  try {
    const row = await db.transaction(async (tx) => {
      // 同租户内至多一个默认环境（平台级 tenantId 为 null）
      if (input.isDefault) await clearDefaultFlag(tx, reportEnvironments, exactTenantCondition(reportEnvironments.tenantId, tenantId));
      const [created] = await tx.insert(reportEnvironments).values({
        tenantId,
        code: input.code,
        name: input.name,
        kind: input.kind,
        description: input.description ?? null,
        baseUrl: input.baseUrl ?? null,
        config: input.config ?? {},
        isDefault: input.isDefault ?? false,
        status: input.status ?? 'enabled',
      }).returning();
      return created;
    });
    return mapReportEnvironment(row);
  } catch (error) {
    rethrowPgUniqueViolation(error, '环境编码或默认环境已存在');
    throw error;
  }
}

export async function updateReportEnvironment(
  id: number,
  input: UpdateReportEnvironmentInput,
): Promise<ReportEnvironment> {
  const existing = await getReportEnvironment(id);
  try {
    const rowOrUndefined = await db.transaction(async (tx) => {
      if (input.isDefault) await clearDefaultFlag(tx, reportEnvironments, exactTenantCondition(reportEnvironments.tenantId, existing.tenantId));
      const [updated] = await tx.update(reportEnvironments).set({
        name: input.name,
        kind: input.kind,
        description: input.description,
        baseUrl: input.baseUrl,
        config: input.config,
        isDefault: input.isDefault,
        status: input.status,
      }).where(eq(reportEnvironments.id, id)).returning();
      return updated;
    });
    const row = requireRow(rowOrUndefined, '报表环境不存在');
    return mapReportEnvironment(row);
  } catch (error) {
    rethrowPgUniqueViolation(error, '默认环境已存在');
    throw error;
  }
}

export async function deleteReportEnvironment(id: number): Promise<void> {
  await getReportEnvironment(id);
  const refs = await db.$count(reportEnvironmentPromotions, reportScopedWhere(
    reportEnvironmentPromotions,
    or(
      eq(reportEnvironmentPromotions.sourceEnvironmentId, id),
      eq(reportEnvironmentPromotions.targetEnvironmentId, id),
    )!,
  ));
  if (refs > 0) throw new HTTPException(400, { message: '环境已有发布历史，不能删除' });
  await db.delete(reportEnvironments).where(eq(reportEnvironments.id, id));
}

export function mapReportEnvironmentPromotion(
  row: PromotionRow,
  resourceName?: string | null,
): ReportEnvironmentPromotion {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    resourceName: resourceName ?? null,
    sourceEnvironmentId: row.sourceEnvironmentId,
    sourceEnvironmentName: row.sourceEnvironment?.name ?? null,
    targetEnvironmentId: row.targetEnvironmentId,
    targetEnvironmentName: row.targetEnvironment?.name ?? null,
    sourceRevision: row.sourceRevision,
    sourceSnapshot: row.sourceSnapshot,
    targetSnapshot: row.targetSnapshot ?? null,
    rollbackSnapshot: row.rollbackSnapshot ?? null,
    status: row.status,
    requestedBy: row.requestedBy ?? null,
    approvedBy: row.approvedBy ?? null,
    deployedBy: row.deployedBy ?? null,
    startedAt: formatNullableDateTime(row.startedAt),
    completedAt: formatNullableDateTime(row.completedAt),
    errorMessage: row.errorMessage ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function isPromotionTransitionAllowed(
  from: ReportPromotionStatus,
  action: ReportEnvironmentPromotionActionInput['action'],
): boolean {
  return (action === 'approve' && from === 'pending')
    || (action === 'deploy' && from === 'approved')
    || (action === 'cancel' && (from === 'pending' || from === 'approved'))
    || (action === 'rollback' && from === 'succeeded');
}

async function ensureApprovedPromotionRequest(
  resourceType: ReportResourceType,
  resourceId: number,
  revision: number,
): Promise<void> {
  if (isSuperAdmin()) return;
  const approved = await db.$count(reportPublishApprovals, reportScopedWhere(
    reportPublishApprovals,
    and(
      eq(reportPublishApprovals.resourceType, resourceType),
      eq(reportPublishApprovals.resourceId, resourceId),
      eq(reportPublishApprovals.action, 'promote'),
      eq(reportPublishApprovals.requestedRevision, revision),
      eq(reportPublishApprovals.status, 'approved'),
    )!,
  ));
  if (approved === 0) throw new HTTPException(403, { message: '生产环境发布必须先通过发布审批' });
}

export async function createReportEnvironmentPromotion(
  input: CreateReportEnvironmentPromotionInput,
): Promise<ReportEnvironmentPromotion> {
  const resource = await ensureReportResourceAccess(input.resourceType, input.resourceId, 'editor');
  assertGovernedResourceRevision(resource.revision, input.sourceRevision);
  const [source, target] = await Promise.all([
    getReportEnvironment(input.sourceEnvironmentId),
    getReportEnvironment(input.targetEnvironmentId),
  ]);
  if (source.tenantId !== resource.tenantId || target.tenantId !== resource.tenantId) {
    throw new HTTPException(400, { message: '环境与资源不属于同一租户' });
  }
  if (source.status !== 'enabled' || target.status !== 'enabled') throw new HTTPException(400, { message: '来源或目标环境已停用' });
  if (target.kind === 'production') {
    await ensureApprovedPromotionRequest(input.resourceType, input.resourceId, input.sourceRevision);
  }
  const previous = await db.query.reportEnvironmentPromotions.findFirst({
    where: reportScopedWhere(reportEnvironmentPromotions, and(
      eq(reportEnvironmentPromotions.resourceType, input.resourceType),
      eq(reportEnvironmentPromotions.resourceId, input.resourceId),
      eq(reportEnvironmentPromotions.targetEnvironmentId, input.targetEnvironmentId),
      eq(reportEnvironmentPromotions.status, 'succeeded'),
    )!),
    orderBy: desc(reportEnvironmentPromotions.completedAt),
  });
  const [row] = await db.insert(reportEnvironmentPromotions).values({
    tenantId: resource.tenantId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    sourceEnvironmentId: input.sourceEnvironmentId,
    targetEnvironmentId: input.targetEnvironmentId,
    sourceRevision: resource.revision,
    sourceSnapshot: resource.snapshot,
    targetSnapshot: previous?.sourceSnapshot ?? null,
    rollbackSnapshot: previous?.sourceSnapshot ?? null,
    status: isSuperAdmin() ? 'approved' : 'pending',
    requestedBy: currentUserId(),
    approvedBy: isSuperAdmin() ? currentUserId() : null,
  }).returning();
  return mapReportEnvironmentPromotion(row, resource.name);
}

export async function listReportEnvironmentPromotions(query: {
  page?: number;
  pageSize?: number;
  status?: ReportPromotionStatus;
  resourceType?: ReportResourceType;
}) {
  const { page = 1, pageSize = 20, status, resourceType } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportEnvironmentPromotions);
  if (tenantScope) conds.push(tenantScope);
  if (status) conds.push(eq(reportEnvironmentPromotions.status, status));
  if (resourceType) conds.push(eq(reportEnvironmentPromotions.resourceType, resourceType));
  const where = buildWhere(...conds);
  const [total, rows] = await Promise.all([
    db.$count(reportEnvironmentPromotions, where),
    db.query.reportEnvironmentPromotions.findMany({
      where,
      with: {
        sourceEnvironment: { columns: { name: true } },
        targetEnvironment: { columns: { name: true } },
      },
      orderBy: desc(reportEnvironmentPromotions.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  const names = await resolveReportResourceNames(rows);
  const list = rows.map((row) => mapReportEnvironmentPromotion(row, names.get(`${row.resourceType}:${row.resourceId}`) ?? null));
  return { list, total, page, pageSize };
}

async function ensurePromotion(id: number) {
  const rowOrUndefined = await db.query.reportEnvironmentPromotions.findFirst({
    where: reportScopedWhere(reportEnvironmentPromotions, eq(reportEnvironmentPromotions.id, id)),
    with: {
      sourceEnvironment: { columns: { name: true } },
      targetEnvironment: { columns: { name: true } },
    },
  });
  const row = requireRow(rowOrUndefined, '环境发布记录不存在');
  return row;
}

export async function transitionReportEnvironmentPromotion(
  id: number,
  input: ReportEnvironmentPromotionActionInput,
): Promise<ReportEnvironmentPromotion> {
  const promotion = await ensurePromotion(id);
  if (promotion.status !== input.expectedStatus || !isPromotionTransitionAllowed(promotion.status, input.action)) {
    throw new HTTPException(409, { message: '环境发布状态已变化或当前操作不允许' });
  }
  const resource = await resolveReportResource(promotion.resourceType, promotion.resourceId);
  await ensureReportResourceAccess(promotion.resourceType, promotion.resourceId, 'editor');
  if (input.action === 'approve') {
    const target = await getReportEnvironment(promotion.targetEnvironmentId);
    if (target.kind === 'production') {
      await ensureApprovedPromotionRequest(promotion.resourceType, promotion.resourceId, promotion.sourceRevision);
    }
  }
  if (input.action === 'deploy') {
    assertGovernedResourceRevision(resource.revision, promotion.sourceRevision, '资源版本已变更，发布记录已失效');
    if (!reportResourceSnapshotsEqual(resource.snapshot, promotion.sourceSnapshot)) {
      throw new HTTPException(409, { message: '资源内容已变更，发布记录已失效' });
    }
  }
  const now = new Date();
  const changes = input.action === 'approve'
    ? { status: 'approved' as const, approvedBy: currentUserId() }
    : input.action === 'deploy'
      ? {
          status: 'succeeded' as const,
          deployedBy: currentUserId(),
          startedAt: now,
          completedAt: now,
          targetSnapshot: promotion.sourceSnapshot,
          errorMessage: null,
        }
      : input.action === 'cancel'
        ? { status: 'cancelled' as const, completedAt: now, errorMessage: input.note ?? null }
        : { status: 'rolled_back' as const, completedAt: now, targetSnapshot: promotion.rollbackSnapshot };
  const [rowOrUndefined] = await db.update(reportEnvironmentPromotions).set(changes)
    .where(and(
      eq(reportEnvironmentPromotions.id, id),
      eq(reportEnvironmentPromotions.status, input.expectedStatus),
    )).returning();
  const row = requireRow(rowOrUndefined, '环境发布状态已变化', 409);
  return mapReportEnvironmentPromotion(row, resource.name);
}
