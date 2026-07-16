/**
 * 业务接入示例：请假 Service
 *
 * 演示「业务模块自有实体 + 工作流编排」：请假数据存本模块自己的 biz_leaves 表，
 * 提交审批时通过 workflow-biz-bridge 发起并关联工作流实例（businessKey = biz_leave + leaveId），
 * 业务数据不进入流程；流程终态由 biz-leave-subscribers 回写本表状态。
 */
import { and, desc, eq, isNull, like, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { BizLeave, BizLeaveStatus, WorkflowInstanceStatus } from '@zenith/shared';
import { WORKFLOW_ACTIVE_INSTANCE_STATUSES } from '@zenith/shared';
import { db } from '../../db';
import { bizLeaves, users, workflowDefinitions, workflowInstances, workflowTasks, type BizLeaveRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDate, formatDateTime, parseDateRangeStart } from '../../lib/datetime';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { isSuperAdmin, getUserPermissions } from '../../lib/permissions';
import { escapeLike } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { startWorkflowForBiz } from '../../lib/workflow-biz-bridge';

/** 业务类型标识（与订阅器、businessKey 保持一致） */
export const BIZ_LEAVE_TYPE = 'biz_leave';
/** 关联的工作流定义名称（需预先发布该 external 流程定义） */
export const LEAVE_WORKFLOW_NAME = '请假审批';

const LEAVE_TYPE_TEXT: Record<string, string> = {
  annual: '年假', sick: '病假', personal: '事假', marriage: '婚假', other: '其他',
};

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapBizLeave(row: BizLeaveRow, applicantName?: string | null): BizLeave {
  return {
    id: row.id,
    leaveType: row.leaveType,
    startDate: formatDate(row.startDate),
    endDate: formatDate(row.endDate),
    days: row.days,
    reason: row.reason ?? null,
    status: row.status,
    workflowInstanceId: row.workflowInstanceId ?? null,
    workflowStatus: (row.workflowStatus ?? null) as WorkflowInstanceStatus | null,
    applicantId: row.createdBy ?? null,
    applicantName: applicantName ?? null,
    tenantId: row.tenantId,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function buildApplicantNameMap(ids: Array<number | null>): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const uniq = [...new Set(ids.filter((v): v is number => typeof v === 'number'))];
  if (uniq.length === 0) return map;
  const rows = await db.select({ id: users.id, nickname: users.nickname, username: users.username }).from(users).where(inArray(users.id, uniq));
  for (const u of rows) map.set(u.id, u.nickname ?? u.username);
  return map;
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────

/** 仅本人可操作自己的请假单 */
function findOwnLeave(id: number) {
  const user = currentUser();
  const conds = [eq(bizLeaves.id, id), eq(bizLeaves.createdBy, user.userId)];
  const tc = tenantCondition(bizLeaves, user);
  if (tc) conds.push(tc);
  return and(...conds);
}

async function ensureLeaveDefinitionId(): Promise<number> {
  const [def] = await db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(and(
      eq(workflowDefinitions.name, LEAVE_WORKFLOW_NAME),
      eq(workflowDefinitions.status, 'published'),
      eq(workflowDefinitions.formType, 'external'),
    ))
    .limit(1);
  if (!def) throw new HTTPException(400, { message: `未找到已发布的「${LEAVE_WORKFLOW_NAME}」流程定义，请先在流程定义中发布` });
  return def.id;
}

/** 查找该请假单当前**活跃**的流程实例（与 bridge 幂等去重口径一致）；终态实例不算占用，允许重新发起 */
async function findExistingLeaveWorkflow(leaveId: number) {
  const [instance] = await db.select().from(workflowInstances)
    .where(and(
      eq(workflowInstances.bizType, BIZ_LEAVE_TYPE),
      eq(workflowInstances.bizId, String(leaveId)),
      inArray(workflowInstances.status, [...WORKFLOW_ACTIVE_INSTANCE_STATUSES]),
    ))
    .orderBy(desc(workflowInstances.id))
    .limit(1);
  return instance ?? null;
}

async function linkLeaveWorkflow(leaveId: number, instance: { id: number; status: WorkflowInstanceStatus }) {
  await db.update(bizLeaves).set({
    status: 'pending',
    workflowInstanceId: instance.id,
    workflowStatus: instance.status,
  }).where(eq(bizLeaves.id, leaveId));
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────

export async function listBizLeaves(query: { page?: number; pageSize?: number; keyword?: string; status?: string }) {
  const user = currentUser();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 10;
  const conds = [eq(bizLeaves.createdBy, user.userId)];
  const tc = tenantCondition(bizLeaves, user);
  if (tc) conds.push(tc);
  if (query.status) conds.push(eq(bizLeaves.status, query.status as BizLeaveStatus));
  if (query.keyword) conds.push(like(bizLeaves.reason, `%${escapeLike(query.keyword)}%`));
  const where = and(...conds);
  const [total, rows] = await Promise.all([
    db.$count(bizLeaves, where),
    db.select().from(bizLeaves).where(where).orderBy(desc(bizLeaves.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  const nameMap = await buildApplicantNameMap(rows.map((r) => r.createdBy));
  return { list: rows.map((r) => mapBizLeave(r, r.createdBy != null ? nameMap.get(r.createdBy) ?? null : null)), total, page, pageSize };
}

export async function getBizLeave(id: number) {
  const [row] = await db.select().from(bizLeaves).where(findOwnLeave(id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '请假单不存在' });
  const nameMap = await buildApplicantNameMap([row.createdBy]);
  return mapBizLeave(row, row.createdBy != null ? nameMap.get(row.createdBy) ?? null : null);
}

/**
 * 供工作流参与者（审批人等）读取请假详情：申请人本人、关联流程实例上有任务的人
 * （审批/办理/抄送任务均计入）、流程监控管理员（workflow:instance:monitor）与超管可见。
 * 与 business-integration.md 的业务详情读取契约、实例详情权限口径保持一致。
 * 用于自定义业务表单 view 组件在审批场景按 bizId 拉取业务数据。
 */
export async function getBizLeaveDetail(id: number) {
  const user = currentUser();
  const [row] = await db.select().from(bizLeaves).where(eq(bizLeaves.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '请假单不存在' });
  let allowed = row.createdBy === user.userId;
  if (!allowed && row.workflowInstanceId) {
    const [task] = await db
      .select({ id: workflowTasks.id })
      .from(workflowTasks)
      .where(and(eq(workflowTasks.instanceId, row.workflowInstanceId), eq(workflowTasks.assigneeId, user.userId)))
      .limit(1);
    allowed = !!task;
  }
  if (!allowed) {
    allowed = isSuperAdmin(user) || (await getUserPermissions(user.userId)).includes('workflow:instance:monitor');
  }
  if (!allowed) throw new HTTPException(403, { message: '无权查看该请假单' });
  const nameMap = await buildApplicantNameMap([row.createdBy]);
  return mapBizLeave(row, row.createdBy != null ? nameMap.get(row.createdBy) ?? null : null);
}

export async function createBizLeave(data: { leaveType: string; startDate: string; endDate: string; days: number; reason?: string | null }) {
  const user = currentUser();
  const start = parseDateRangeStart(data.startDate);
  const end = parseDateRangeStart(data.endDate);
  if (!start || !end) throw new HTTPException(400, { message: '日期格式不正确' });
  if (end < start) throw new HTTPException(400, { message: '结束日期不能早于开始日期' });
  const [row] = await db.insert(bizLeaves).values({
    leaveType: data.leaveType,
    startDate: start,
    endDate: end,
    days: data.days,
    reason: data.reason ?? null,
    status: 'draft',
    tenantId: getCreateTenantId(user),
  }).returning();
  return getBizLeave(row.id);
}

export async function updateBizLeave(id: number, data: Partial<{ leaveType: string; startDate: string; endDate: string; days: number; reason: string | null }>) {
  const [existing] = await db.select().from(bizLeaves).where(findOwnLeave(id)).limit(1);
  if (!existing) throw new HTTPException(404, { message: '请假单不存在' });
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
  if (!existing) throw new HTTPException(404, { message: '请假单不存在' });
  if (existing.status !== 'draft') throw new HTTPException(400, { message: '仅草稿状态可删除' });
  await db.delete(bizLeaves).where(eq(bizLeaves.id, id));
}

/** 提交审批：业务数据已落库，此处发起并关联工作流实例 */
export async function submitBizLeave(id: number) {
  const user = currentUser();
  const [leave] = await db.select().from(bizLeaves).where(findOwnLeave(id)).limit(1);
  if (!leave) throw new HTTPException(404, { message: '请假单不存在' });
  if (leave.status !== 'draft') {
    if (leave.workflowInstanceId) return getBizLeave(id);
    const existingWorkflow = await findExistingLeaveWorkflow(id);
    if (existingWorkflow) {
      await linkLeaveWorkflow(id, existingWorkflow);
      return getBizLeave(id);
    }
    throw new HTTPException(400, { message: '该请假单已提交，无法重复提交' });
  }
  const definitionId = await ensureLeaveDefinitionId();
  const [claimed] = await db.update(bizLeaves).set({
    status: 'pending',
    workflowStatus: 'running',
  }).where(and(findOwnLeave(id), eq(bizLeaves.status, 'draft'))).returning();
  if (!claimed) {
    const [fresh] = await db.select().from(bizLeaves).where(findOwnLeave(id)).limit(1);
    if (fresh?.workflowInstanceId) return getBizLeave(id);
    const existingWorkflow = await findExistingLeaveWorkflow(id);
    if (existingWorkflow) {
      await linkLeaveWorkflow(id, existingWorkflow);
      return getBizLeave(id);
    }
    throw new HTTPException(409, { message: '请假单正在提交，请稍后刷新' });
  }

  const applicant = user.username || '我';
  try {
    const existingWorkflow = await findExistingLeaveWorkflow(id);
    const instance = existingWorkflow ?? await startWorkflowForBiz({
      definitionId,
      title: `${LEAVE_TYPE_TEXT[claimed.leaveType] ?? '请假'}申请 - ${applicant} - ${formatDate(claimed.startDate)}`,
      bizType: BIZ_LEAVE_TYPE,
      bizId: claimed.id,
      // 暴露给流程的路由变量：天数 / 类型，可用于条件分支与按字段指定审批人
      variables: { days: claimed.days, leaveType: claimed.leaveType },
    });
    await linkLeaveWorkflow(id, instance);
  } catch (err) {
    await db.update(bizLeaves).set({
      status: 'draft',
      workflowStatus: null,
    }).where(and(eq(bizLeaves.id, id), isNull(bizLeaves.workflowInstanceId)));
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
  if (!leave) throw new HTTPException(404, { message: '请假单不存在' });
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
