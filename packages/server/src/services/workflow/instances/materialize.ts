// ─── 任务行物化与令牌推进（拆分自 workflow-instances.service.ts）───
import { eq, and, inArray } from 'drizzle-orm';
import { workflowDecisionExecutions, workflowInstances, workflowTasks, workflowTokens } from '../../../db/schema';
import { type TaskAction } from '../../../lib/workflow-engine';
import { type AdvanceTrigger, type BranchPath, type PendingDecision } from '../../../lib/workflow-token-engine';
import type { WorkflowResolvedApproveMethod, WorkflowFlowData, WorkflowStarterContext } from '@zenith/shared/workflow';
import { HTTPException } from 'hono/http-exception';
import { createDeptTree, resolveAssigneeIds } from '../workflow-assignee-resolver.service';
import { decide } from '../../platform/rules-runtime.service';
import type { DbExecutor, DbTransaction } from '../../../db/types';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolveActiveDelegate } from '../workflow-delegations.service';
import { resolveAdminUserId } from '../workflow-assignee-resolver.service';
import { notifyWithin } from '../../messaging/notification-outbox.service';
import { applyAssigneeRuntimeStrategies } from './assignees';
import { armTaskAsyncJobs } from './async-jobs';
import { workflowNodeActivations, workflowApprovalSlots } from '../../../db/schema';
import { cancelApprovalActivations, reconcileApprovalActivation } from './approval-state';
import { optionalExactTenantCondition } from '../../../lib/tenant';

import { executeWorkflow, planRuntimeActivation, runtimeTaskIdentity, type RuntimeTrigger } from '../runtime/execute';
import { expandRuntimeTasks, type ExpandedTaskRows, type ExpandedTaskRow } from '../runtime/expand-tasks';

type ExpandTasksContext = { instanceId: number; initiatorId: number; tenantId: number | null; executor: DbExecutor; formData?: Record<string, unknown>; settings?: WorkflowFlowData['settings']; selectedNextApprovers?: Record<string, number[]>; flowData?: WorkflowFlowData };

async function expandTasksToRows(
  tasks: TaskAction[],
  ctx: ExpandTasksContext,
): Promise<ExpandedTaskRows> {
  // 本次物化内所有节点共享一棵惰性部门树：不涉及部门的节点不触发查询，
  // 涉及的多个节点也只拉取一次部门表
  const deptTree = createDeptTree(ctx.executor, ctx.tenantId);

  // 审批代理（离岗委托）：按需懒加载本实例的 definitionId，将待办自动转交给代理人
  let cachedDefinitionId: number | null = null;
  const resolveDefinitionId = async (): Promise<number> => {
    if (cachedDefinitionId == null) {
      const [r] = await ctx.executor
        .select({ definitionId: workflowInstances.definitionId })
        .from(workflowInstances)
        .where(eq(workflowInstances.id, ctx.instanceId))
        .limit(1);
      cachedDefinitionId = r?.definitionId ?? 0;
    }
    return cachedDefinitionId;
  };
  const applyDelegations = async (userIds: number[]): Promise<Array<{ assigneeId: number; delegatedFromId: number | null; delegationMode: 'full' | 'suggest' | null }>> => {
    const definitionId = await resolveDefinitionId();
    const result: Array<{ assigneeId: number; delegatedFromId: number | null; delegationMode: 'full' | 'suggest' | null }> = [];
    const seen = new Set<number>();
    for (const uid of userIds) {
      const delegate = definitionId ? await resolveActiveDelegate(ctx.executor, uid, definitionId) : null;
      const finalId = delegate?.delegateId ?? uid;
      if (seen.has(finalId)) continue;
      seen.add(finalId);
      result.push({ assigneeId: finalId, delegatedFromId: delegate ? uid : null, delegationMode: delegate?.mode ?? null });
    }
    return result;
  };

  // 异常提醒统一走通知中心：与本次物化同事务登记，提交后由补投 cron 派发（事务回滚则不发）
  const notifyNodeException = async (nodeName: string, detail: string, userIds: number[]) => {
    const recipients = [...new Set(userIds)];
    if (recipients.length === 0) return;
    try {
      await notifyWithin(ctx.executor, 'workflow.node.exception', {
        recipients: recipients.map((id) => ({ type: 'user' as const, id })),
        vars: { instanceId: ctx.instanceId, node: nodeName, detail },
        tenantId: ctx.tenantId,
        subjectRefs: [{ type: 'workflow.instance', key: String(ctx.instanceId), role: 'primary' }],
        link: `/workflow/applications?instanceId=${ctx.instanceId}`,
      });
    } catch { /* 通知失败不影响流转 */ }
  };

  return expandRuntimeTasks(tasks, {
    instanceId: ctx.instanceId, initiatorId: ctx.initiatorId, flowData: ctx.flowData,
    ports: {
      resolve: config => resolveAssigneeIds(config, { initiatorId: ctx.initiatorId, tenantId: ctx.tenantId, executor: ctx.executor, formData: ctx.formData, instanceId: ctx.instanceId, selectedNextApprovers: ctx.selectedNextApprovers?.[config.key], deptTree }),
      admin: () => resolveAdminUserId(ctx.tenantId, ctx.executor),
      applyPolicy: (task, ids) => applyAssigneeRuntimeStrategies(task, ids, ctx),
      delegate: applyDelegations, notifyException: notifyNodeException,
      now: () => new Date(), random: Math.random, callbackId: () => randomBytes(16).toString('hex'),
    },
  });
}

/**
 * 供 ccNode onlyOnApprove 判定的「已完成审批节点」集合：
 * 仅统计各节点**当前激活轮**中存在 approved 的节点（skipped 不算通过——
 * 驳回连带跳过、撤回作废、取消清场的行都不应让抄送误判"上游已通过"）。
 * 历史轮（重入前）的 approved 同样不参与，与 checkNodeCompletion 口径一致。
 */
async function getCompletedNodeKeys(exec: DbExecutor, instanceId: number): Promise<Set<string>> {
 const rows = await exec.select().from(workflowNodeActivations).where(eq(workflowNodeActivations.instanceId, instanceId)).orderBy(workflowNodeActivations.createdAt);
 const latest = new Map<string, typeof rows[number]>();
 for (const row of rows) latest.set(row.nodeKey, row);
 return new Set(['start', ...[...latest.values()].filter((row) => row.status === 'approved').map((row) => row.nodeKey)]);
}

type WorkflowTokenSnapshot = { id: number; nodeKey: string; branchPath: BranchPath; scopeKey: string | null };

/** 读取实例当前全部 active token（含 parked join token） */
export async function loadLiveTokens(exec: DbExecutor, instanceId: number): Promise<WorkflowTokenSnapshot[]> {
  const rows = await exec.select({ id: workflowTokens.id, nodeKey: workflowTokens.nodeKey, branchPath: workflowTokens.branchPath, scopeKey: workflowTokens.scopeKey })
    .from(workflowTokens)
    .where(and(eq(workflowTokens.instanceId, instanceId), eq(workflowTokens.status, 'active')));
  return rows.map((r) => ({ id: r.id, nodeKey: r.nodeKey, branchPath: (r.branchPath ?? []) as BranchPath, scopeKey: r.scopeKey }));
}

/** 终止实例所有 active token（驳回 / 取消 / 撤销 / 强制跳转前清场） */
export async function killInstanceTokens(exec: DbExecutor, instanceId: number): Promise<void> {
 await cancelApprovalActivations(exec, instanceId);
  await exec.update(workflowTokens)
    .set({ status: 'dead', consumedAt: new Date() })
    .where(and(eq(workflowTokens.instanceId, instanceId), eq(workflowTokens.status, 'active')));
}

/**
 * 到达决策网关后同步求值并持久化。
 * - 先按 decisionId 查重，保证崩溃重试不重复调用规则；
 * - 输出并入 formData 后再 resume，出边条件只读已提交上下文。
 */
async function resolvePendingDecisions(
  exec: DbExecutor,
  ctx: { instanceId: number; flowData: WorkflowFlowData; formData: Record<string, unknown>; starter?: WorkflowStarterContext; tenantId?: number | null },
  pending: PendingDecision[],
): Promise<AdvanceTrigger[]> {
  if (pending.length === 0) return [];
  const triggers: AdvanceTrigger[] = [];
  for (const item of pending) {
    const [existing] = await exec.select({ outputs: workflowDecisionExecutions.outputs })
      .from(workflowDecisionExecutions)
      .where(eq(workflowDecisionExecutions.decisionId, item.decisionId))
      .limit(1);
    let outputs: Record<string, unknown>;
    if (existing) {
      outputs = (existing.outputs ?? {}) as Record<string, unknown>;
    } else {
      const node = ctx.flowData.nodes.find((n) => n.data.key === item.nodeKey);
      if (!node?.data.decisionRuleKey) continue;
      const decision = await decide(
        { kind: node.data.decisionRefKind ?? 'table', key: node.data.decisionRuleKey },
        { form: ctx.formData, starter: ctx.starter },
        { caller: 'workflow.gateway', bizRef: `workflow:${ctx.instanceId}#${item.nodeKey}` },
      );
      outputs = decision.outputs;
      await exec.insert(workflowDecisionExecutions).values({
        instanceId: ctx.instanceId,
        decisionId: item.decisionId,
        nodeKey: item.nodeKey,
        branchPath: item.branchPath,
        parentTokenId: item.parentTokenId,
        refKind: decision.ref.kind,
        ruleKey: decision.ref.key,
        ruleVersion: decision.ref.version,
        matched: decision.matched,
        reason: decision.reason ?? null,
        usedFallback: decision.usedFallback ?? null,
        inputs: { form: ctx.formData, starter: ctx.starter },
        outputs,
        tenantId: ctx.tenantId ?? null,
      });
    }
    Object.assign(ctx.formData, outputs);
    triggers.push({
      type: 'resumeDecision', decisionId: item.decisionId, nodeKey: item.nodeKey,
      branchPath: item.branchPath, parentTokenId: item.parentTokenId,
    });
  }
  if (triggers.length > 0) {
    await exec.update(workflowInstances).set({ formData: ctx.formData }).where(eq(workflowInstances.id, ctx.instanceId));
  }
  return triggers;
}

/** 推进的触发方式（service 语义层，内部翻译为引擎触发并管理 token 落库） */
export type MaterializeTrigger = RuntimeTrigger;

/**
 * Token 驱动的推进 + 落库。
 * 以 workflow_tokens 为活动路径/网关汇聚的权威来源：消费完成 token → 产出新 token + 建任务行。
 * 多人审批完成判定（checkNodeCompletion）与任务展开（expandTasksToRows）保持不变。
 */
export async function advanceAndMaterialize(
  trigger: MaterializeTrigger,
  ctx: { instanceId: number; initiatorId: number; executor: DbExecutor; flowData: WorkflowFlowData; formData: Record<string, unknown>; settings?: WorkflowFlowData['settings']; selectedNextApprovers?: Record<string, number[]>; starter?: WorkflowStarterContext; tenantId?: number | null; scopeKey?: string | null },
): Promise<{ createdTasks: typeof workflowTasks.$inferSelect[]; finished: boolean; rejected: boolean; currentNodeKeys: string[] }> {
  const exec = ctx.executor;
  return executeWorkflow(trigger, ctx, {
    loadTokens: () => loadLiveTokens(exec, ctx.instanceId),
    completedKeys: () => getCompletedNodeKeys(exec, ctx.instanceId),
    completeToken: async tokenId => {
      await exec.update(workflowNodeActivations).set({ status: 'approved', settledAt: new Date() }).where(eq(workflowNodeActivations.tokenId, tokenId));
    },
    consumeTokens: async ids => {
      await exec.update(workflowTokens).set({ status: 'consumed', consumedAt: new Date() }).where(and(eq(workflowTokens.instanceId, ctx.instanceId), inArray(workflowTokens.id, ids), optionalExactTenantCondition(workflowTokens.tenantId, ctx.tenantId)));
    },
    createToken: async spec => {
      const [token] = await exec.insert(workflowTokens).values({ instanceId: ctx.instanceId, nodeKey: spec.nodeKey, status: 'active', branchPath: spec.branchPath, parentTokenId: spec.parentTokenId, scopeKey: ctx.scopeKey ?? null, tenantId: ctx.tenantId ?? null }).returning();
      return token.id;
    },
    expand: tasks => expandTasksToRows(tasks, { ...ctx, tenantId: ctx.tenantId ?? null }),
    materialize: async (taskRows, tokens) => {
      const createdTasks: typeof workflowTasks.$inferSelect[] = [];
      const rowsByNode = new Map<string, ExpandedTaskRow[]>();
      for (const row of taskRows) { const bucket = rowsByNode.get(row.nodeKey) ?? []; bucket.push(row); rowsByNode.set(row.nodeKey, bucket); }
      for (const [nodeKey, rows] of rowsByNode) {
        const activationId = randomUUID();
        const nodeConfig = ctx.flowData.nodes.find(node => node.data.key === nodeKey)?.data;
        const { method, ratio, required, baseTotal, kind: activationKind, includeInEfficiencyStats } = planRuntimeActivation(rows, nodeConfig);
        await exec.insert(workflowNodeActivations).values({ id: activationId, instanceId: ctx.instanceId, tokenId: tokens.get(nodeKey) ?? null, nodeKey, nodeName: rows[0].nodeName, kind: activationKind, status: tokens.has(nodeKey) ? 'active' : 'approved', approveMethod: method, approveRatio: ratio, baseTotal, baseRequired: required, includeInEfficiencyStats, tenantId: ctx.tenantId ?? null });
        for (const expandedRow of rows) {
          const { taskOrder, approveMethod: _method, approveRatio: _ratio, taskKind: specifiedKind, ...row } = expandedRow;
          const { kind, taskKind, waitReason } = runtimeTaskIdentity({ ...row, taskKind: specifiedKind }, method);
          let slotId: number | null = null;
          if (kind === 'approval') {
            const [slot] = await exec.insert(workflowApprovalSlots).values({ activationId, origin: 'base', originalAssigneeId: row.delegatedFromId ?? row.assigneeId ?? null, currentAssigneeId: row.assigneeId ?? null, status: row.status === 'approved' ? 'approved' : row.status === 'rejected' ? 'rejected' : 'pending', order: taskOrder ?? null, tenantId: ctx.tenantId ?? null }).returning(); slotId = slot.id;
          }
          const [task] = await exec.insert(workflowTasks).values({ ...row, activationId, slotId, taskKind, waitReason, activatedAt: row.status === 'pending' ? new Date() : null }).returning();
          if (slotId != null) await exec.update(workflowApprovalSlots).set({ currentTaskId: task.id }).where(eq(workflowApprovalSlots.id, slotId));
          createdTasks.push(task); await armTaskAsyncJobs(task, { id: ctx.instanceId, flowData: ctx.flowData, formData: ctx.formData, tenantId: ctx.tenantId ?? null }, exec);
        }
      }
      return createdTasks;
    },
    resolveDecisions: pending => resolvePendingDecisions(exec, ctx, pending),
    reject: async createdTasks => {
      const orphanIds = createdTasks
        .filter((t) => t.status === 'pending' || t.status === 'waiting')
        .map((t) => t.id);
      if (orphanIds.length > 0) {
        await exec.update(workflowTasks)
          .set({ status: 'skipped', actionAt: new Date(), comment: '[自动拒绝] 流程被自动拒绝终止，本待办作废' })
          .where(inArray(workflowTasks.id, orphanIds));
      }
      await killInstanceTokens(exec, ctx.instanceId);
      const remaining = createdTasks.filter((t) => t.status !== 'pending' && t.status !== 'waiting');
      return remaining;
    },
  });
}

/** 调用方传入已授权并锁定的实例；完成判定只使用对应 token 的显式进入身份。 */
export async function checkNodeCompletion(tx: DbTransaction, inst: typeof workflowInstances.$inferSelect, nodeKey: string, flowData?: WorkflowFlowData, activationId?: string): Promise<{ completed: boolean; failed: boolean; method: WorkflowResolvedApproveMethod | null }> {
 const id = activationId ?? (await tx.select({ id: workflowNodeActivations.id }).from(workflowNodeActivations).innerJoin(workflowTokens, eq(workflowNodeActivations.tokenId, workflowTokens.id)).where(and(eq(workflowNodeActivations.instanceId, inst.id), eq(workflowNodeActivations.nodeKey, nodeKey), eq(workflowTokens.status, 'active'))).limit(1))[0]?.id;
 if (!id) throw new HTTPException(409, { message: '节点缺少显式激活轮次' });
 return reconcileApprovalActivation(tx, inst, id, { userId: 0, name: 'system:approval' }, flowData);
}
