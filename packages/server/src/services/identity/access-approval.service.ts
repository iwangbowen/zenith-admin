import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { ACCESS_REQUEST_BIZ_TYPE, ACCESS_APPROVAL_ORDER, type AccessApprovalPlan, type AccessApprovalPolicy } from '@zenith/shared/identity';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { departments, identityAccessRequests, roles, userGroupMembers, userGroupRoles, userGroups, userRoles, users, userMfaFactors } from '../../db/schema';
import { exactTenantCondition } from '../../lib/tenant';
import { formatDateTime } from '../../lib/datetime';
import { getUserPermissions, runWithFreshUserPermissions } from '../../lib/permissions';
import redis from '../../lib/redis';
import { config } from '../../config';
import { assertAccessSnapshotDuration } from './access-policy.service';
import { verifyUserTotp } from './identity-security.service';

type InstanceRef = { id: number; tenantId: number | null; bizType: string | null; bizId: string | null };
export type AccessMfaEvidence = { actorId: number; taskId: number; factorId: number; verifiedAt: Date };

async function securityCandidates(tenantId: number | null, executor: DbExecutor) {
  const roleScope = and(eq(roles.status, 'enabled'), or(
    and(inArray(roles.code, ['security_admin', 'tenant_admin']), exactTenantCondition(roles.tenantId, tenantId)),
    and(eq(roles.code, 'super_admin'), isNull(roles.tenantId)),
  ));
  const columns = { id: users.id, name: users.nickname, username: users.username, code: roles.code };
  const [direct, grouped] = await Promise.all([
    executor.select(columns).from(users).innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(users.status, 'enabled'), exactTenantCondition(users.tenantId, tenantId), roleScope)).orderBy(asc(users.id)),
    executor.select(columns).from(users).innerJoin(userGroupMembers, eq(userGroupMembers.userId, users.id)).innerJoin(userGroups, eq(userGroups.id, userGroupMembers.groupId))
      .innerJoin(userGroupRoles, eq(userGroupRoles.groupId, userGroups.id)).innerJoin(roles, eq(roles.id, userGroupRoles.roleId))
      .where(and(eq(users.status, 'enabled'), exactTenantCondition(users.tenantId, tenantId), eq(userGroups.status, 'enabled'), exactTenantCondition(userGroups.tenantId, tenantId), roleScope)).orderBy(asc(users.id)),
  ]);
  const priority: Record<string, number> = { security_admin: 0, tenant_admin: 1, super_admin: 2 };
  const unique = new Map<number, (typeof direct)[number]>();
  for (const candidate of [...direct, ...grouped].sort((a, b) => priority[a.code] - priority[b.code] || a.id - b.id)) if (!unique.has(candidate.id)) unique.set(candidate.id, candidate);
  return [...unique.values()];
}

async function canHandleWorkflow(userId: number, executor: DbExecutor): Promise<boolean> {
  return runWithFreshUserPermissions(userId, async () => (await getUserPermissions(userId)).includes('workflow:task:handle'), executor);
}

export async function resolveAccessApprovalPlan(targetUserId: number, tenantId: number | null, approvalPolicy: AccessApprovalPolicy, mfaRequired: boolean, executor: DbExecutor = db): Promise<AccessApprovalPlan> {
  const target = await executor.query.users.findFirst({ where: and(eq(users.id, targetUserId), exactTenantCondition(users.tenantId, tenantId), eq(users.status, 'enabled')), columns: { departmentId: true } });
  if (!target) throw new HTTPException(400, { message: '申请人不存在或已停用' });
  const plan: AccessApprovalPlan = { approvalPolicy, mfaRequired, steps: [] };
  if (approvalPolicy === 'none') return plan;
  const manager = target.departmentId ? await executor.select({ id: users.id, name: users.nickname, username: users.username }).from(departments)
    .innerJoin(users, eq(users.id, departments.leaderId)).where(and(eq(departments.id, target.departmentId), exactTenantCondition(departments.tenantId, tenantId), exactTenantCondition(users.tenantId, tenantId), eq(departments.status, 'enabled'), eq(users.status, 'enabled'))).limit(1) : [];
  if (!manager[0] || manager[0].id === targetUserId) throw new HTTPException(409, { message: '请先配置有效且独立的部门负责人，不能由申请人本人审批' });
  if (!await canHandleWorkflow(manager[0].id, executor)) throw new HTTPException(409, { message: '部门负责人尚未获得审批办理权限' });
  plan.steps.push({ nodeKey: 'approve_manager', label: '部门负责人审批', userId: manager[0].id, userName: manager[0].name || manager[0].username, reason: '申请人所在部门的有效负责人' });
  if (ACCESS_APPROVAL_ORDER[approvalPolicy] < ACCESS_APPROVAL_ORDER.manager_security) return plan;
  const candidates = (await securityCandidates(tenantId, executor)).filter(candidate => candidate.id !== targetUserId && candidate.id !== manager[0].id);
  const capable = await Promise.all(candidates.map(async candidate => ({ ...candidate, capable: candidate.code === 'super_admin' || await canHandleWorkflow(candidate.id, executor) })));
  const eligible = capable.filter(candidate => candidate.capable);
  const needed = approvalPolicy === 'two_person' ? 2 : 1;
  if (eligible.length < needed) throw new HTTPException(409, { message: needed === 2 ? '缺少两名独立且可办理审批的安全审批人' : '缺少独立且可办理审批的安全审批人' });
  for (let index = 0; index < needed; index++) plan.steps.push({
    nodeKey: index === 0 ? 'approve_security' : 'approve_second_security', label: index === 0 ? '安全管理员审批' : '第二独立安全审批',
    userId: eligible[index].id, userName: eligible[index].name || eligible[index].username, reason: `${eligible[index].code === 'security_admin' ? '安全管理员' : '管理角色兜底'}；按角色优先级与用户 ID 确定`,
  });
  return plan;
}

async function loadAccessApprovalRequest(executor: DbExecutor, instance: InstanceRef) {
  const request = await executor.query.identityAccessRequests.findFirst({
    where: and(eq(identityAccessRequests.workflowInstanceId, instance.id), eq(identityAccessRequests.id, Number(instance.bizId)), exactTenantCondition(identityAccessRequests.tenantId, instance.tenantId)),
  });
  if (!request) throw new HTTPException(409, { message: '权限申请缺少有效业务关联' });
  return request;
}

export async function assertAccessGrantApproversCurrent(executor: DbExecutor, request: Pick<typeof identityAccessRequests.$inferSelect, 'tenantId' | 'targetUserId' | 'approvalPlan' | 'approvalEvidence'>): Promise<void> {
  if (!request.approvalPlan.steps.length) return;
  const actorIds = [...new Set(request.approvalEvidence.map(evidence => evidence.actorId))];
  const active = await executor.select({ id: users.id }).from(users).where(and(inArray(users.id, actorIds), exactTenantCondition(users.tenantId, request.tenantId), eq(users.status, 'enabled')));
  if (active.length !== actorIds.length) throw new HTTPException(409, { message: '审批参与人已停用，请重新申请' });
  const target = await executor.query.users.findFirst({ where: and(eq(users.id, request.targetUserId), exactTenantCondition(users.tenantId, request.tenantId)), columns: { departmentId: true } });
  const department = target?.departmentId ? await executor.query.departments.findFirst({ where: and(eq(departments.id, target.departmentId), exactTenantCondition(departments.tenantId, request.tenantId), eq(departments.status, 'enabled')), columns: { leaderId: true } }) : null;
  const security = new Set((await securityCandidates(request.tenantId, executor)).map(candidate => candidate.id));
  for (const evidence of request.approvalEvidence) {
    if (evidence.nodeKey === 'approve_manager' ? department?.leaderId !== evidence.actorId : !security.has(evidence.actorId)) throw new HTTPException(409, { message: '审批人组织关系或安全身份已经变化，请重新申请' });
  }
}

export async function assertAccessTaskAssigneeInTransaction(executor: DbExecutor, instance: InstanceRef, nodeKey: string, targetUserId: number): Promise<void> {
  if (instance.bizType !== ACCESS_REQUEST_BIZ_TYPE) return;
  const request = await loadAccessApprovalRequest(executor, instance);
  const target = await executor.query.users.findFirst({ where: and(eq(users.id, targetUserId), exactTenantCondition(users.tenantId, instance.tenantId), eq(users.status, 'enabled')), columns: { id: true } });
  if (!target) throw new HTTPException(403, { message: '新处理人不存在或已停用' });
  const step = request.approvalPlan.steps.find(entry => entry.nodeKey === nodeKey);
  if (!step || targetUserId === request.targetUserId || targetUserId === request.applicantUserId || request.approvalEvidence.some(entry => entry.actorId === targetUserId) || request.approvalPlan.steps.some(entry => entry.nodeKey !== nodeKey && entry.userId === targetUserId)) throw new HTTPException(403, { message: '该成员不能独立办理当前权限审批，不能自审或复用其他审批节点成员' });
  if (step.nodeKey === 'approve_manager' && targetUserId !== step.userId) throw new HTTPException(403, { message: '部门负责人节点不可转给其他成员，请按组织关系重新发起' });
  if (step.nodeKey !== 'approve_manager' && !(await securityCandidates(instance.tenantId, executor)).some(candidate => candidate.id === targetUserId)) throw new HTTPException(403, { message: '新处理人没有有效的安全审批身份' });
  const capable = await runWithFreshUserPermissions(targetUserId, async () => (await getUserPermissions(targetUserId)).includes('workflow:task:handle'), executor);
  if (!capable) throw new HTTPException(403, { message: '新处理人没有审批办理权限' });
}

export async function verifyAccessApprovalMfa(instance: InstanceRef, taskId: number, actorId: number, code?: string): Promise<AccessMfaEvidence | undefined> {
  if (instance.bizType !== ACCESS_REQUEST_BIZ_TYPE) return undefined;
  const request = await loadAccessApprovalRequest(db, instance);
  if (!request.approvalPlan.mfaRequired) return undefined;
  const receipt = await verifyAccessMfa(actorId, code);
  return { actorId, taskId, ...receipt };
}

export async function verifyAccessMfa(actorId: number, code?: string) {
  if (!code) throw new HTTPException(400, { message: '该操作要求 MFA，请输入本人认证器的动态验证码；批量操作请改为逐笔办理' });
  const key = `${config.redis.keyPrefix}access-approval-mfa:${actorId}`;
  const attempt = await redis.incr(key);
  if (attempt === 1) await redis.expire(key, 300);
  if (attempt > 10) throw new HTTPException(429, { message: 'MFA 验证尝试过多，请 5 分钟后再试' });
  const factorId = await verifyUserTotp(actorId, code);
  await redis.del(key);
  return { factorId, verifiedAt: new Date() };
}

export async function assertAccessApprovalInTransaction(executor: DbExecutor, instance: InstanceRef, task: { id: number; nodeKey: string }, actorId: number, mfa?: AccessMfaEvidence): Promise<void> {
  if (instance.bizType !== ACCESS_REQUEST_BIZ_TYPE) return;
  const requestId = Number(instance.bizId);
  await executor.select({ id: identityAccessRequests.id }).from(identityAccessRequests)
    .where(and(eq(identityAccessRequests.id, requestId), exactTenantCondition(identityAccessRequests.tenantId, instance.tenantId))).for('update');
  const request = await loadAccessApprovalRequest(executor, instance);
  if (request.status !== 'pending') throw new HTTPException(409, { message: '权限申请已经结束，不能继续审批' });
  const actor = await executor.query.users.findFirst({ where: and(eq(users.id, actorId), exactTenantCondition(users.tenantId, instance.tenantId), eq(users.status, 'enabled')), columns: { id: true } });
  const target = await executor.query.users.findFirst({ where: and(eq(users.id, request.targetUserId), exactTenantCondition(users.tenantId, instance.tenantId),   eq(users.status, 'enabled')), columns: { id: true, departmentId: true } });
  if (!actor || !target) throw new HTTPException(409, { message: '申请人或审批人已经停用' });
  if (actorId === request.applicantUserId || actorId === request.targetUserId || request.approvalEvidence.some(evidence => evidence.actorId === actorId)) throw new HTTPException(403, { message: '权限申请必须由独立审批人逐级办理，不能自审或重复审批' });
  const step = request.approvalPlan.steps.find(item => item.nodeKey === task.nodeKey);
  if (!step) throw new HTTPException(403, { message: '该任务不属于权限策略要求的审批计划' });
  const stepIndex = request.approvalPlan.steps.indexOf(step);
  if (request.approvalPlan.steps.slice(0, stepIndex).some(previous => !request.approvalEvidence.some(evidence => evidence.nodeKey === previous.nodeKey))) throw new HTTPException(409, { message: '前置权限审批尚未完成，不能跳级办理' });
  if (step.nodeKey === 'approve_manager') {
    const department = target.departmentId ? await executor.query.departments.findFirst({ where: and(eq(departments.id, target.departmentId), exactTenantCondition(departments.tenantId, instance.tenantId), eq(departments.status, 'enabled')), columns: { leaderId: true } }) : null;
    if (actorId !== step.userId || department?.leaderId !== actorId) throw new HTTPException(403, { message: '部门负责人已变化，请撤回后按最新组织关系重新申请' });
  }
  if (step.nodeKey !== 'approve_manager' && !(await securityCandidates(instance.tenantId, executor)).some(candidate => candidate.id === actorId)) throw new HTTPException(403, { message: '审批人不再具备有效的安全审批角色' });
  await assertAccessSnapshotDuration(request.policySnapshot, request.startsAt, request.expiresAt, instance.tenantId, executor);
  if (request.approvalPlan.mfaRequired) {
    if (!mfa || mfa.actorId !== actorId || mfa.taskId !== task.id || Date.now() - mfa.verifiedAt.getTime() > 120_000) throw new HTTPException(403, { message: '权限审批需要当次 MFA 验证' });
    const factor = await executor.query.userMfaFactors.findFirst({ where: and(eq(userMfaFactors.id, mfa.factorId), eq(userMfaFactors.userId, actorId), eq(userMfaFactors.status, 'enabled')), columns: { id: true } });
    if (!factor) throw new HTTPException(403, { message: 'MFA 因子已停用，请重新验证' });
  }
  await executor.update(identityAccessRequests).set({ approvalEvidence: [...request.approvalEvidence, {
    taskId: task.id, nodeKey: step.nodeKey, actorId, approvedAt: formatDateTime(new Date()), mfaVerifiedAt: mfa ? formatDateTime(mfa.verifiedAt) : null,
  }] }).where(and(eq(identityAccessRequests.id, request.id), exactTenantCondition(identityAccessRequests.tenantId, instance.tenantId)));
}
