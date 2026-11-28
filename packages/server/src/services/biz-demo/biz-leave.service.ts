import { bizLeaveContract, bizLeaveSchema } from '@zenith/shared/biz';
import type { QueryOutputOf, BodyOf } from '@zenith/shared/core';
/**
 * 业务接入示例：请假 Service
 *
 * 演示「业务模块自有实体 + 工作流编排」：请假数据存本模块自己的 biz_leaves 表，
 * 提交审批时通过 workflow-biz-bridge 发起并关联工作流实例（businessKey = biz_leave + leaveId），
 * 业务数据不进入流程；流程终态由 biz-leave-subscribers 回写本表状态。
 */
import { and, desc, eq, isNull, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { BizLeave, CreateBizLeaveInput } from '@zenith/shared/biz';
import { BIZ_LEAVE_STATUSES } from '@zenith/shared/biz';
import type { WorkflowInstanceStatus } from '@zenith/shared/workflow';
import { WORKFLOW_ACTIVE_INSTANCE_STATUSES } from '@zenith/shared/workflow';
import { db } from '../../db';
import { bizLeaves, tenants, workflowInstances, type BizLeaveRow } from '../../db/schema';
import { currentUser, currentUserDetail } from '../../lib/context';
import { formatDate, parseDateRangeStart } from '../../lib/datetime';
import { exactTenantCondition, tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { keywordCondition, buildWhere, withPagination } from '../../lib/where-helpers';
import { startWorkflowForBiz, resolveBizDefinitionId } from '../../lib/workflow-biz-bridge';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { resolveUserNames } from '../../lib/user-nicknames';
import { pickEntity } from '../../lib/entity-map';
import { getBusinessWorkflowContext, previewBusinessWorkflow, requireBusinessApprovalInstance } from '../workflow/workflow-business-context.service';
import { allocateBusinessNumber, attachBusinessNumber } from '../platform/numbering-runtime';

/** 业务类型标识（与订阅器、businessKey 保持一致） */
export const BIZ_LEAVE_TYPE = 'biz_leave';
/** 关联的工作流定义名称（需预先发布该 external 流程定义） */
export const LEAVE_WORKFLOW_NAME = '请假审批';

const LEAVE_TYPE_TEXT: Record<string, string> = {
  annual: '年假', sick: '病假', personal: '事假', marriage: '婚假', other: '其他',
};

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapBizLeave(row: BizLeaveRow, applicantName?: string | null): BizLeave {
  return pickEntity(bizLeaveSchema, row, {
    startDate: formatDate(row.startDate),
    endDate: formatDate(row.endDate),
    workflowStatus: (row.workflowStatus ?? null) as WorkflowInstanceStatus | null,
    applicantId: row.createdBy ?? null,
    applicantName: applicantName ?? null,
  });
}

async function buildApplicantNameMap(ids: Array<number | null>): Promise<Map<number, string>> {
  return resolveUserNames(ids);
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────

/** 仅本人可操作自己的请假单 */
function findOwnLeave(id: number) {
  const user = currentUser();
  return buildWhere(
    eq(bizLeaves.id, id),
    eq(bizLeaves.createdBy, user.userId),
    tenantCondition(bizLeaves, user),
  );
}

function ensureLeaveDefinitionId(tenantId: number | null): Promise<number> {
  return resolveBizDefinitionId({ name: LEAVE_WORKFLOW_NAME, formType: 'external', tenantId });
}

/** 查找该请假单当前**活跃**的流程实例（与 bridge 幂等去重口径一致）；终态实例不算占用，允许重新发起 */
async function findExistingLeaveWorkflow(leaveId: number, tenantId: number | null) {
  const [instance] = await db.select().from(workflowInstances)
    .where(and(
      eq(workflowInstances.bizType, BIZ_LEAVE_TYPE),
      eq(workflowInstances.bizId, String(leaveId)),
      exactTenantCondition(workflowInstances.tenantId, tenantId),
      inArray(workflowInstances.status, [...WORKFLOW_ACTIVE_INSTANCE_STATUSES]),
    ))
    .orderBy(desc(workflowInstances.id))
    .limit(1);
  return instance ?? null;
}

/** 只将同租户的审批实例关联到当前申请人的请假单。 */
async function linkLeaveWorkflow(leaveId: number, instance: { id: number; status: WorkflowInstanceStatus; tenantId: number | null }) {
  await db.update(bizLeaves).set({
    status: 'pending',
    workflowInstanceId: instance.id,
    workflowStatus: instance.status,
  }).where(and(findOwnLeave(leaveId), exactTenantCondition(bizLeaves.tenantId, instance.tenantId)));
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────

type BizLeaveListQuery = QueryOutputOf<typeof bizLeaveContract.list>;

export async function listBizLeaves(query: BizLeaveListQuery) {
  const user = currentUser();
  const { page, pageSize } = query;
  const where = buildWhere(
    eq(bizLeaves.createdBy, user.userId),
    tenantCondition(bizLeaves, user),
    query.status && BIZ_LEAVE_STATUSES.includes(query.status as (typeof BIZ_LEAVE_STATUSES)[number])
      ? eq(bizLeaves.status, query.status as (typeof BIZ_LEAVE_STATUSES)[number])
      : undefined,
    keywordCondition(query.keyword, [bizLeaves.leaveNo, bizLeaves.reason]),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(bizLeaves, where),
    rows: async () => {
      const rows = await withPagination(db.select().from(bizLeaves).where(where).orderBy(desc(bizLeaves.id)).$dynamic(), page, pageSize);
      const nameMap = await buildApplicantNameMap(rows.map((r) => r.createdBy));
      return rows.map((r) => mapBizLeave(r, r.createdBy != null ? nameMap.get(r.createdBy) ?? null : null));
    },
  });
}

export async function getBizLeave(id: number) {
  const [row] = await db.select().from(bizLeaves).where(findOwnLeave(id)).limit(1);
  requireRow(row, '请假单不存在');
  const nameMap = await buildApplicantNameMap([row.createdBy]);
  return mapBizLeave(row, row.createdBy != null ? nameMap.get(row.createdBy) ?? null : null);
}

/** 指定轮次的参与人读取当前业务资料，不用当前关联指针替代该轮权限。 */
export async function getBizLeaveDetail(id: number, instanceId: number) {
  await requireBusinessApprovalInstance(instanceId, BIZ_LEAVE_TYPE, String(id));
  const [row] = await db.select().from(bizLeaves).where(buildWhere(eq(bizLeaves.id, id), tenantCondition(bizLeaves, currentUser()))).limit(1);
  requireRow(row, '请假单不存在');
  const nameMap = await buildApplicantNameMap([row.createdBy]);
  return mapBizLeave(row, row.createdBy != null ? nameMap.get(row.createdBy) ?? null : null);
}

export function leaveWorkflowVariables(data: BodyOf<typeof bizLeaveContract.workflowPreview>): Record<string, unknown> {
  return { ...(data.days != null ? { days: Number(data.days) } : {}), ...(data.leaveType ? { leaveType: data.leaveType } : {}) };
}

export async function previewBizLeaveWorkflow(data: BodyOf<typeof bizLeaveContract.workflowPreview>) {
  return previewBusinessWorkflow(await ensureLeaveDefinitionId(getCreateTenantId(currentUser())), leaveWorkflowVariables(data));
}

export async function getBizLeaveWorkflowContext(id: number, instanceId?: number) {
  const leave = await getBizLeave(id);
  return getBusinessWorkflowContext(BIZ_LEAVE_TYPE, String(id), leave.status === 'draft' ? null : leave.workflowInstanceId, instanceId);
}

export async function createBizLeave(data: CreateBizLeaveInput) {
  const user = currentUser();
  const start = parseDateRangeStart(data.startDate);
  const end = parseDateRangeStart(data.endDate);
  if (!start || !end) throw new HTTPException(400, { message: '日期格式不正确' });
  if (end < start) throw new HTTPException(400, { message: '结束日期不能早于开始日期' });
  const tenantId = getCreateTenantId(user);
  const actor = requireRow(await currentUserDetail(), '当前用户不存在');
  const tenant = tenantId === null ? null : requireRow(await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId), columns: { code: true },
  }), '当前租户不存在');
  const context = {
    username: actor.username, nickname: actor.nickname, tenantCode: tenant?.code ?? 'platform',
    categoryCode: data.leaveType,
    ...(actor.department ? { departmentId: actor.department.id, departmentCode: actor.department.code, departmentName: actor.department.name } : {}),
  };
  const id = await db.transaction(async tx => {
    const [row] = await tx.insert(bizLeaves).values({
      leaveType: data.leaveType, startDate: start, endDate: end, days: data.days,
      reason: data.reason ?? null, status: 'draft', tenantId,
    }).returning();
    const created = requireRow(row, '创建请假单失败');
    const leaveNo = await allocateBusinessNumber(tx, { scene: 'biz.leave', tenantId, allocationKey: String(created.id), context });
    await tx.update(bizLeaves).set({ leaveNo }).where(eq(bizLeaves.id, created.id));
    await attachBusinessNumber(tx, { scene: 'biz.leave', tenantId, number: leaveNo, businessKey: String(created.id) });
    return created.id;
  });
  return getBizLeave(id);
}

export async function updateBizLeave(id: number, data: Partial<{ leaveType: string; startDate: string; endDate: string; days: number; reason: string | null }>) {
  const [existing] = await db.select().from(bizLeaves).where(findOwnLeave(id)).limit(1);
  requireRow(existing, '请假单不存在');
  if (existing.status !== 'draft') throw new HTTPException(400, { message: '仅草稿状态可编辑' });
  const patch: Record<string, unknown> = {};
  if (data.leaveType !== undefined) patch.leaveType = data.leaveType;
  if (data.days !== undefined) patch.days = data.days;
  if (data.reason !== undefined) patch.reason = data.reason;
  if (data.startDate !== undefined) {
    const s = parseDateRangeStart(data.startDate);
    if (!s) throw new HTTPException(400, { message: '开始日期格式不正确' });
    patch.startDate = s;
  }
  if (data.endDate !== undefined) {
    const e = parseDateRangeStart(data.endDate);
    if (!e) throw new HTTPException(400, { message: '结束日期格式不正确' });
    patch.endDate = e;
  }
  await db.update(bizLeaves).set(patch).where(eq(bizLeaves.id, id));
  return getBizLeave(id);
}

export async function deleteBizLeave(id: number) {
  const [existing] = await db.select().from(bizLeaves).where(findOwnLeave(id)).limit(1);
  requireRow(existing, '请假单不存在');
  if (existing.status !== 'draft') throw new HTTPException(400, { message: '仅草稿状态可删除' });
  await db.delete(bizLeaves).where(eq(bizLeaves.id, id));
}

/** 提交审批：业务数据已落库，此处发起并关联工作流实例 */
export async function submitBizLeave(id: number) {
  const user = currentUser();
  const [leave] = await db.select().from(bizLeaves).where(findOwnLeave(id)).limit(1);
  requireRow(leave, '请假单不存在');
  if (leave.tenantId !== getCreateTenantId(user)) {
    throw new HTTPException(400, { message: '请选择请假单所属的租户视角后提交' });
  }
  if (leave.status !== 'draft') {
    if (leave.workflowInstanceId) return getBizLeave(id);
    const existingWorkflow = await findExistingLeaveWorkflow(id, leave.tenantId);
    if (existingWorkflow) {
      await linkLeaveWorkflow(id, existingWorkflow);
      return getBizLeave(id);
    }
    throw new HTTPException(400, { message: '该请假单已提交，无法重复提交' });
  }
  const definitionId = await ensureLeaveDefinitionId(leave.tenantId);
  const [claimed] = await db.update(bizLeaves).set({
    status: 'pending',
    workflowStatus: 'running',
  }).where(and(findOwnLeave(id), eq(bizLeaves.status, 'draft'))).returning();
  if (!claimed) {
    const [fresh] = await db.select().from(bizLeaves).where(findOwnLeave(id)).limit(1);
    if (fresh?.workflowInstanceId) return getBizLeave(id);
    const existingWorkflow = await findExistingLeaveWorkflow(id, leave.tenantId);
    if (existingWorkflow) {
      await linkLeaveWorkflow(id, existingWorkflow);
      return getBizLeave(id);
    }
    throw new HTTPException(409, { message: '请假单正在提交，请稍后刷新' });
  }

  const applicant = user.username || '我';
  try {
    const existingWorkflow = await findExistingLeaveWorkflow(id, claimed.tenantId);
    const instance = existingWorkflow ?? await startWorkflowForBiz({
      definitionId,
      title: `${LEAVE_TYPE_TEXT[claimed.leaveType] ?? '请假'}申请 - ${applicant} - ${formatDate(claimed.startDate)}`,
      bizType: BIZ_LEAVE_TYPE,
      bizId: claimed.id,
      // 暴露给流程的路由变量：天数 / 类型，可用于条件分支与按字段指定审批人
      variables: leaveWorkflowVariables({ days: claimed.days, leaveType: claimed.leaveType as BodyOf<typeof bizLeaveContract.workflowPreview>['leaveType'] }),
    });
    await linkLeaveWorkflow(id, instance);
  } catch (err) {
    await db.update(bizLeaves).set({
      status: 'draft',
      workflowStatus: null,
    }).where(and(findOwnLeave(id), isNull(bizLeaves.workflowInstanceId)));
    throw err;
  }
  return getBizLeave(id);
}

/**
 * 重新编辑：已驳回/已取消的请假单转回草稿，可修改后再次「提交审批」。
 * 旧流程实例已终态、不再占用业务键（bizType+bizId 唯一约束仅作用于活跃实例），
 * 再次提交时将发起一个全新的流程实例。
 */
export async function reopenBizLeave(id: number) {
  const [leave] = await db.select().from(bizLeaves).where(findOwnLeave(id)).limit(1);
  requireRow(leave, '请假单不存在');
  if (leave.status !== 'rejected' && leave.status !== 'cancelled') {
    throw new HTTPException(400, { message: '仅已驳回或已取消的请假单可重新编辑' });
  }
  await db.update(bizLeaves).set({
    status: 'draft',
    workflowInstanceId: null,
    workflowStatus: null,
  }).where(and(eq(bizLeaves.id, id), inArray(bizLeaves.status, ['rejected', 'cancelled'])));
  return getBizLeave(id);
}
