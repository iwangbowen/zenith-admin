// ─── 实例生命周期：创建/撤回/取消/删除/草稿/重新提交（拆分自 workflow-instances.service.ts）───
import { eq, and, desc, inArray } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowInstances, workflowTasks, workflowDefinitions, users, userRoles } from '../../../db/schema';
import { tenantCondition, getCreateTenantId } from '../../../lib/tenant';
import { validateFlowData } from '../../../lib/workflow-engine';
import type { WorkflowFlowData } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../../lib/context';
import { buildStarterContext } from '../workflow-assignee-resolver.service';
import { resolveFormSnapshot } from '../workflow-forms.service';
import type { DbExecutor } from '../../../db/types';
import { generateSerialNo } from '../workflow-serial.service';
import { isPgUniqueViolation } from '../../../lib/db-errors';
import logger from '../../../lib/logger';
import { applyInitiatorSelectedApprovers, hasExecutableEntry, sanitizeFormByStartPerms } from './initiator-select';
import type { SelectedApproverMap } from './initiator-select';
import { assertLaunchMatchesFormType, buildInstanceFormSnapshot, mapInstance, mapTask } from './mapping';
import { advanceAndMaterialize, killInstanceTokens } from './materialize';
import { buildSerialNoContext, emitInstanceEvent, emitNodeEvent, emitTaskEvent, toDefinitionSnapshot } from './shared';
import { bridgeReportFillWorkflowOutcome } from '../../report/report-fill-workflow-bridge.service';

export async function createInstance(data: { definitionId: number; title: string; formData?: Record<string, unknown> | null; asDraft?: boolean; priority?: import('@zenith/shared').WorkflowInstancePriority; ccUserIds?: number[]; selectedInitiatorApprovers?: SelectedApproverMap; bizType?: string | null; bizId?: string | null }, callerOverride?: { userId: number; username: string; tenantId: number | null; roles?: string[] }) {
  const user = callerOverride
    ? { userId: callerOverride.userId, username: callerOverride.username, roles: callerOverride.roles ?? [], tenantId: callerOverride.tenantId }
    : currentUser();
  const skipScopeCheck = !!callerOverride;
  const [def] = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, data.definitionId), eq(workflowDefinitions.status, 'published'))).limit(1);
  if (!def) throw new HTTPException(404, { message: '流程定义不存在或未发布' });
  const normalizedBizType = data.bizType?.trim() || null;
  const normalizedBizId = data.bizId?.trim() || null;
  const launchData = { ...data, bizType: normalizedBizType, bizId: normalizedBizId };
  assertLaunchMatchesFormType(def, launchData);
  const scopeType = (def.initiatorScopeType ?? 'all') as 'all' | 'users' | 'departments' | 'roles';
  const scopeIds = Array.isArray(def.initiatorScopeIds)
    ? def.initiatorScopeIds.map(Number).filter((v) => Number.isInteger(v) && v > 0)
    : [];
  if (!skipScopeCheck && scopeType !== 'all') {
    let allowed = false;
    if (scopeType === 'users') {
      allowed = scopeIds.includes(user.userId);
    } else if (scopeType === 'departments') {
      const [me] = await db.select({ departmentId: users.departmentId }).from(users).where(eq(users.id, user.userId)).limit(1);
      allowed = me?.departmentId != null && scopeIds.includes(me.departmentId);
    } else if (scopeType === 'roles') {
      const roleRows = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, user.userId));
      allowed = roleRows.some((r) => scopeIds.includes(r.roleId));
    }
    if (!allowed) {
      throw new HTTPException(403, { message: '当前流程不在你的可发起范围内' });
    }
  }
  const baseFlowData = def.flowData as WorkflowFlowData;
  if (!baseFlowData?.nodes?.length) throw new HTTPException(400, { message: '流程定义无效' });
  const flowData = data.asDraft
    ? baseFlowData
    : await applyInitiatorSelectedApprovers(baseFlowData, data.selectedInitiatorApprovers);
  const definitionSnapshot = toDefinitionSnapshot(def, data.asDraft ? undefined : flowData);
  const validation = validateFlowData(flowData);
  if (!validation.valid) throw new HTTPException(400, { message: validation.errors[0] });
  const formData: Record<string, unknown> = sanitizeFormByStartPerms(flowData, data.formData ?? {});
  const resolvedFormSnapshot = await resolveFormSnapshot(def.formId);
  const formSnapshot = buildInstanceFormSnapshot(def, resolvedFormSnapshot);

  const existingBizInstance = await findInstanceByBusinessKey(normalizedBizType, normalizedBizId);
  if (existingBizInstance) return mapInstance(existingBizInstance);

  // 草稿：仅保存表单，不进入流转、不生成业务编号、不触发事件
  if (data.asDraft) {
      const [draft] = await db.insert(workflowInstances).values({
        definitionId: def.id,
        definitionSnapshot,
      title: data.title,
      formData,
      formSnapshot,
      status: 'draft',
      priority: data.priority ?? 'normal',
      currentNodeKey: null,
      initiatorId: user.userId,
      tenantId: getCreateTenantId(user),
      bizType: normalizedBizType,
      bizId: normalizedBizId,
    }).returning();
    return mapInstance(draft);
  }

  const starter = await buildStarterContext(user.userId);
  if (!hasExecutableEntry(flowData, formData, starter)) {
    throw new HTTPException(400, { message: '流程定义中无可执行节点' });
  }
  const serialConfig = flowData.settings?.serialNo;
  const serialCtx = await buildSerialNoContext(serialConfig, formData);
  let txResult: { instance: typeof workflowInstances.$inferSelect; createdTasks: typeof workflowTasks.$inferSelect[] };
  try {
    txResult = await db.transaction(async (tx) => {
      const serialNo = await generateSerialNo(tx, def.id, serialConfig, serialCtx);
      const [createdInstance] = await tx.insert(workflowInstances).values({
        definitionId: def.id,
        definitionSnapshot,
        title: data.title,
        serialNo,
        formData,
        formSnapshot,
        status: 'running',
        priority: data.priority ?? 'normal',
        currentNodeKey: null,
        initiatorId: user.userId,
        tenantId: getCreateTenantId(user),
        bizType: normalizedBizType,
        bizId: normalizedBizId,
      }).returning();
      const materialized = await advanceAndMaterialize({ kind: 'seed' }, {
        instanceId: createdInstance.id,
        initiatorId: user.userId,
        executor: tx,
        flowData,
        formData,
        settings: flowData.settings,
        starter,
        tenantId: createdInstance.tenantId,
      });
      const [updatedInstance] = await tx.update(workflowInstances).set({
        status: materialized.rejected ? 'rejected' : (materialized.finished ? 'approved' : 'running'),
        currentNodeKey: materialized.rejected || materialized.finished ? null : materialized.currentNodeKeys[0] ?? null,
      }).where(eq(workflowInstances.id, createdInstance.id)).returning();
      // 事务性 outbox：发起事件在同一事务内入队，与实例/任务插入原子提交（崩溃不丢）
      await emitInstanceStartEvents(mapInstance(updatedInstance), updatedInstance, materialized.createdTasks, { userId: user.userId, name: user.username }, tx);
      return { instance: updatedInstance, createdTasks: materialized.createdTasks };
    });
  } catch (err) {
    if (normalizedBizType && normalizedBizId && isPgUniqueViolation(err)) {
      const existing = await findInstanceByBusinessKey(normalizedBizType, normalizedBizId);
      if (existing) return mapInstance(existing);
    }
    throw err;
  }
  const { instance } = txResult;
  const instanceDto = mapInstance(instance);
  // 事件与异步作业均已在事务内入队（outbox + 在库作业）
  // 发起时自选抄送：插入 ccNode 任务（best-effort，失败不影响发起结果；接收人通过「抄送我的」查看）
  const ccIds = Array.from(new Set((data.ccUserIds ?? []).filter((v) => Number.isInteger(v) && v > 0)));
  if (ccIds.length > 0) {
    try {
      const [validUsers, existing] = await Promise.all([
        db.select({ id: users.id }).from(users).where(inArray(users.id, ccIds)),
        db.select({ assigneeId: workflowTasks.assigneeId }).from(workflowTasks)
          .where(and(eq(workflowTasks.instanceId, instance.id), eq(workflowTasks.nodeType, 'ccNode'))),
      ]);
      const validSet = new Set(validUsers.map((u) => u.id));
      const existingSet = new Set(existing.map((r) => r.assigneeId).filter((v): v is number => typeof v === 'number'));
      const toAdd = ccIds.filter((uid) => validSet.has(uid) && !existingSet.has(uid));
      if (toAdd.length > 0) {
        await db.insert(workflowTasks).values(toAdd.map((uid) => ({
          instanceId: instance.id,
          nodeKey: '__initiator_cc__',
          nodeName: '发起抄送',
          nodeType: 'ccNode' as const,
          assigneeId: uid,
          status: 'skipped' as const,
          comment: `[发起抄送] 由 ${user.username ?? '系统'} 指定`,
          actionAt: null,
        })));
      }
    } catch (err) {
      logger.error('[workflow] 发起时自选抄送写入失败', { instanceId: instance.id, err });
    }
  }
  return instanceDto;
}

/** 实例进入流转后统一触发事件 + 调度延迟/子流程（createInstance 与草稿提交共用） */
/** 入队"发起"相关事件（传 executor 在事务内原子入队 outbox；不传则提交后 best-effort 入队） */
export async function emitInstanceStartEvents(
  instanceDto: ReturnType<typeof mapInstance>,
  instance: typeof workflowInstances.$inferSelect,
  createdTasks: typeof workflowTasks.$inferSelect[],
  actor: { userId: number; name: string },
  executor?: DbExecutor,
): Promise<void> {
  await emitInstanceEvent('instance.created', instanceDto, actor, executor);
  for (const t of createdTasks) {
    const meta = { definitionId: instance.definitionId, tenantId: instance.tenantId, actor };
    await emitNodeEvent('node.entered', { instanceId: instance.id, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType }, executor);
    await emitTaskEvent('task.created', mapTask(t), meta, executor);
    if (t.assigneeId && t.status === 'pending') await emitTaskEvent('task.assigned', mapTask(t), meta, executor);
    if (t.status === 'approved') await emitTaskEvent('task.approved', mapTask(t), meta, executor);
    if (t.status === 'rejected') await emitTaskEvent('task.rejected', mapTask(t), meta, executor);
  }
  if (instance.status === 'approved') await emitInstanceEvent('instance.approved', instanceDto, actor, executor);
  if (instance.status === 'rejected') await emitInstanceEvent('instance.rejected', instanceDto, actor, executor);
}

async function findInstanceByBusinessKey(
  bizType: string | null,
  bizId: string | null,
): Promise<typeof workflowInstances.$inferSelect | null> {
  if (!bizType || !bizId) return null;
  const [existing] = await db.select().from(workflowInstances)
    .where(and(eq(workflowInstances.bizType, bizType), eq(workflowInstances.bizId, bizId)))
    .orderBy(desc(workflowInstances.id))
    .limit(1);
  return existing ?? null;
}

export async function withdrawInstance(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.initiatorId !== user.userId) throw new HTTPException(403, { message: '只有发起人可以撤回' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '只能撤回进行中的申请' });
  const snapshot = inst.definitionSnapshot;
  if (snapshot?.flowData?.settings?.allowWithdraw === false) {
    throw new HTTPException(400, { message: '该流程不允许发起人撤回' });
  }
  const { row: updated, cancelledTasks } = await db.transaction(async (tx) => {
    // 实例行级锁 + 锁内重校验：避免与并发审批推进竞态（撤回时流程正被推进，导致状态互相覆盖或残留任务）
    const [locked] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(eq(workflowInstances.id, id)).for('update').limit(1);
    if (!locked || locked.status !== 'running') {
      throw new HTTPException(409, { message: '流程实例状态已变化，请刷新后重试' });
    }
    const cancelled = await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
      .where(and(eq(workflowTasks.instanceId, id), inArray(workflowTasks.status, ['pending', 'waiting'])))
      .returning();
    await killInstanceTokens(tx, id);
    const [row] = await tx.update(workflowInstances).set({ status: 'withdrawn' }).where(and(...conditions)).returning();
    await bridgeReportFillWorkflowOutcome(tx, {
      workflowInstanceId: id,
      outcome: 'withdrawn',
      actorId: user.userId,
    });
    return { row, cancelledTasks: cancelled };
  });
  const instanceDto = mapInstance(updated);
  const actor = { userId: user.userId, name: user.username };
  for (const t of cancelledTasks) {
    emitTaskEvent('task.skipped', mapTask(t), { definitionId: updated.definitionId, tenantId: updated.tenantId, actor });
  }
  emitInstanceEvent('instance.withdrawn', instanceDto, actor);
  return instanceDto;
}

export async function cancelInstance(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.status !== 'running' && inst.status !== 'suspended') throw new HTTPException(400, { message: '只能取消进行中或已挂起的流程' });
  const { row: updated, cancelledTasks } = await db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(and(...conditions)).for('update').limit(1);
    if (!locked || (locked.status !== 'running' && locked.status !== 'suspended')) {
      throw new HTTPException(400, { message: '只能取消进行中或已挂起的流程' });
    }
    const cancelled = await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
      .where(and(eq(workflowTasks.instanceId, id), inArray(workflowTasks.status, ['pending', 'waiting'])))
      .returning();
    await killInstanceTokens(tx, id);
    const [row] = await tx.update(workflowInstances).set({ status: 'cancelled', currentNodeKey: null, suspendedAt: null, suspendReason: null }).where(and(...conditions)).returning();
    await bridgeReportFillWorkflowOutcome(tx, {
      workflowInstanceId: id,
      outcome: 'cancelled',
      actorId: user.userId,
    });
    return { row, cancelledTasks: cancelled };
  });
  const instanceDto = mapInstance(updated);
  const actor = { userId: user.userId, name: user.username };
  for (const t of cancelledTasks) {
    emitTaskEvent('task.skipped', mapTask(t), { definitionId: updated.definitionId, tenantId: updated.tenantId, actor });
  }
  return instanceDto;
}

export async function deleteInstance(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.status === 'running' || inst.status === 'draft') {
    throw new HTTPException(400, { message: '请先取消进行中的流程再删除' });
  }
  await db.delete(workflowInstances).where(and(...conditions));
}

async function loadOwnDraft(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conds = [eq(workflowInstances.id, id)];
  if (tc) conds.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conds)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.initiatorId !== user.userId) throw new HTTPException(403, { message: '只能操作自己的草稿' });
  return inst;
}

export async function updateInstanceDraft(id: number, input: { title?: string; formData?: Record<string, unknown> | null; priority?: import('@zenith/shared').WorkflowInstancePriority }) {
  const inst = await loadOwnDraft(id);
  if (inst.status !== 'draft') throw new HTTPException(400, { message: '仅草稿可编辑' });
  const patch: Partial<typeof workflowInstances.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.formData !== undefined) patch.formData = input.formData ?? {};
  if (input.priority !== undefined) patch.priority = input.priority;
  const [row] = await db.update(workflowInstances).set(patch).where(eq(workflowInstances.id, id)).returning();
  return mapInstance(row);
}

export async function submitDraftInstance(id: number, input: { selectedInitiatorApprovers?: SelectedApproverMap } = {}) {
  const user = currentUser();
  const inst = await loadOwnDraft(id);
  if (inst.status !== 'draft') throw new HTTPException(400, { message: '仅草稿可提交' });
  const [def] = await db.select().from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.id, inst.definitionId), eq(workflowDefinitions.status, 'published'))).limit(1);
  if (!def) throw new HTTPException(400, { message: '流程定义不存在或已停用，无法提交' });
  const baseFlowData = def.flowData as WorkflowFlowData;
  if (!baseFlowData?.nodes?.length) throw new HTTPException(400, { message: '流程定义无效' });
  const flowData = await applyInitiatorSelectedApprovers(baseFlowData, input.selectedInitiatorApprovers);
  const definitionSnapshot = toDefinitionSnapshot(def, flowData);
  const validation = validateFlowData(flowData);
  if (!validation.valid) throw new HTTPException(400, { message: validation.errors[0] });
  const formData = sanitizeFormByStartPerms(flowData, (inst.formData ?? {}) as Record<string, unknown>);
  assertLaunchMatchesFormType(def, { bizType: inst.bizType, bizId: inst.bizId });
  const resolvedFormSnapshot = await resolveFormSnapshot(def.formId);
  const formSnapshot = buildInstanceFormSnapshot(def, resolvedFormSnapshot);
  const starter = await buildStarterContext(user.userId);
  if (!hasExecutableEntry(flowData, formData, starter)) {
    throw new HTTPException(400, { message: '流程定义中无可执行节点' });
  }
  const serialConfig = flowData.settings?.serialNo;
  const serialCtx = await buildSerialNoContext(serialConfig, formData);
  const instance = await db.transaction(async (tx) => {
    const serialNo = await generateSerialNo(tx, def.id, serialConfig, serialCtx);
    await tx.update(workflowInstances).set({
      definitionSnapshot,
      formSnapshot,
      serialNo,
      status: 'running',
      currentNodeKey: null,
    }).where(eq(workflowInstances.id, id));
    const materialized = await advanceAndMaterialize({ kind: 'seed' }, {
      instanceId: id,
      initiatorId: user.userId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
      starter,
      tenantId: inst.tenantId,
    });
    const [updatedInstance] = await tx.update(workflowInstances).set({
      status: materialized.rejected ? 'rejected' : (materialized.finished ? 'approved' : 'running'),
      currentNodeKey: materialized.rejected || materialized.finished ? null : materialized.currentNodeKeys[0] ?? null,
    }).where(eq(workflowInstances.id, id)).returning();
    await emitInstanceStartEvents(mapInstance(updatedInstance), updatedInstance, materialized.createdTasks, { userId: user.userId, name: user.username }, tx);
    return updatedInstance;
  });
  return mapInstance(instance);
}

/** 重新提交：将已驳回/已撤回的实例克隆为一份新草稿，供发起人编辑后再次提交 */
export async function resubmitInstance(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conds = [eq(workflowInstances.id, id)];
  if (tc) conds.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conds)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.initiatorId !== user.userId) throw new HTTPException(403, { message: '只有发起人可以重新提交' });
  if (inst.status !== 'rejected' && inst.status !== 'withdrawn') {
    throw new HTTPException(400, { message: '只有已驳回或已撤回的申请可重新提交' });
  }
  const resubmitSettings = inst.definitionSnapshot?.flowData?.settings;
  if (resubmitSettings?.allowResubmit === false) {
    throw new HTTPException(400, { message: '该流程不允许重新提交' });
  }
  if (inst.bizType && inst.bizId) {
    throw new HTTPException(400, { message: '业务系统主导流程请在对应业务模块中重新提交' });
  }
  return createInstance({
    definitionId: inst.definitionId,
    title: inst.title,
    formData: (inst.formData ?? {}) as Record<string, unknown>,
    asDraft: true,
  });
}
