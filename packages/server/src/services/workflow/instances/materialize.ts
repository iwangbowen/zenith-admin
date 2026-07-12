// ─── 任务行物化与令牌推进（拆分自 workflow-instances.service.ts）───
import { eq, and, or, inArray } from 'drizzle-orm';
import { workflowInstances, workflowTasks, workflowTokens, inAppMessages } from '../../../db/schema';
import { resolveRuntimeApproveMethod, type TaskAction } from '../../../lib/workflow-engine';
import { advanceTokens, type AdvanceTrigger, type BranchPath } from '../../../lib/workflow-token-engine';
import type { WorkflowResolvedApproveMethod, WorkflowFlowData, WorkflowStarterContext } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { resolveAssigneeIds } from '../workflow-assignee-resolver.service';
import { getDecisionOutputs } from '../../platform/rules.service';
import type { DbExecutor } from '../../../db/types';
import { randomBytes, randomUUID } from 'node:crypto';
import { enqueueJob } from '../../../lib/workflow-jobs/engine';
import { computeTimeoutAt } from '../../../lib/workflow-timeout';
import { resolveActiveDelegate } from '../workflow-delegations.service';
import { applyAssigneeRuntimeStrategies, resolveAdminAssigneeId } from './assignees';
import { armTaskAsyncJobs } from './async-jobs';
import { findExceptionCatchNode } from './mapping';

/**
 * 将引擎输出的 TaskAction[] 展开为实际需插入的 workflow_tasks 行。
 * - approve / handler：调用 resolver 展开为多人，依据 approveMethod 写入状态／sequence
 * - ccNode / delay / trigger / subProcess：保持原样
 */
interface ExpandedTaskRows {
  rows: Array<typeof workflowTasks.$inferInsert>;
  autoApprovedNodeKeys: string[];
  autoRejectedNodeKey: string | null;
}

async function expandTasksToRows(
  tasks: TaskAction[],
  ctx: { instanceId: number; initiatorId: number; executor: DbExecutor; formData?: Record<string, unknown>; settings?: WorkflowFlowData['settings']; selectedNextApprovers?: Record<string, number[]>; flowData?: WorkflowFlowData },
): Promise<ExpandedTaskRows> {
  const rows: Array<typeof workflowTasks.$inferInsert> = [];
  const autoApprovedNodeKeys: string[] = [];
  let autoRejectedNodeKey: string | null = null;

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
  const applyDelegations = async (userIds: number[]): Promise<Array<{ assigneeId: number; delegatedFromId: number | null }>> => {
    const definitionId = await resolveDefinitionId();
    const result: Array<{ assigneeId: number; delegatedFromId: number | null }> = [];
    const seen = new Set<number>();
    for (const uid of userIds) {
      const delegate = definitionId ? await resolveActiveDelegate(ctx.executor, uid, definitionId) : null;
      const finalId = delegate ?? uid;
      if (seen.has(finalId)) continue;
      seen.add(finalId);
      result.push({ assigneeId: finalId, delegatedFromId: delegate ? uid : null });
    }
    return result;
  };

  const pushAutoRow = (task: TaskAction, status: 'approved' | 'rejected') => {
    rows.push({
      instanceId: ctx.instanceId,
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: null,
      status,
      actionAt: new Date(),
    });
    if (status === 'approved') autoApprovedNodeKeys.push(task.nodeKey);
    else autoRejectedNodeKey = task.nodeKey;
  };

  for (const t of tasks) {
    if (t.autoStatus) {
      pushAutoRow(t, t.autoStatus);
      continue;
    }

    if (t.nodeType === 'delay') {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: 'delay',
        assigneeId: null,
        status: 'waiting' as const,
      });
      continue;
    }

    if (t.nodeType === 'trigger') {
      const tcfg = t.nodeConfig.triggerConfig;
      const isCallback = tcfg?.triggerType === 'callback';
      const isBlocking = tcfg?.onFailure === 'block';
      const isDataMutation = tcfg?.triggerType === 'updateData' || tcfg?.triggerType === 'deleteData';
      if (isCallback || isBlocking || isDataMutation) {
        rows.push({
          instanceId: ctx.instanceId,
          nodeKey: t.nodeKey,
          nodeName: t.nodeName,
          nodeType: 'trigger',
          assigneeId: null,
          status: 'waiting' as const,
          ...(isCallback ? { externalCallbackId: randomBytes(16).toString('hex') } : {}),
        });
        continue;
      }
      // 非阻塞触发器（continue/retry）：落到下方通用自动节点路径，由订阅者异步执行
    }

    if (t.nodeType === 'subProcess' && t.nodeConfig.subProcessWaitChild !== false) {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: 'subProcess',
        assigneeId: null,
        status: 'waiting' as const,
      });
      continue;
    }

    if (t.nodeType === 'ccNode') {
      // 解析抄送接收人：支持 assigneeType（user/role/dept/formUser 等）+ 变量插值；
      // resolver 内部使用 Set 完成去重，并在未声明 assigneeType 时自动回退 assigneeIds + assigneeId
      const ccUserIds = await resolveAssigneeIds(t.nodeConfig, {
        initiatorId: ctx.initiatorId,
        executor: ctx.executor,
        formData: ctx.formData,
        instanceId: ctx.instanceId,
      });
      for (const uid of ccUserIds) {
        rows.push({
          instanceId: ctx.instanceId,
          nodeKey: t.nodeKey,
          nodeName: t.nodeName,
          nodeType: 'ccNode' as const,
          assigneeId: uid,
          status: 'skipped' as const,
          actionAt: null,
        });
      }
      continue;
    }

    if (t.nodeType !== 'approve' && t.nodeType !== 'handler') {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        assigneeId: t.assigneeId,
        status: (t.nodeType as string) === 'ccNode' ? 'skipped' as const : 'approved' as const,
        actionAt: (t.nodeType as string) === 'ccNode' ? null : new Date(),
      });
      continue;
    }
    // 外部审批：不解析人员，生成一条 waiting + callbackId 任务，由 external-approver 订阅者派发
    const extCfg = t.nodeConfig.externalApproval;
    if (t.nodeType === 'approve' && extCfg?.enabled) {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: 'approve',
        assigneeId: null,
        status: 'waiting' as const,
        externalCallbackId: randomBytes(16).toString('hex'),
      });
      continue;
    }
    const rawMethod = t.nodeConfig.approveMethod;

    const resolvedUserIds = await resolveAssigneeIds(t.nodeConfig, {
      initiatorId: ctx.initiatorId,
      executor: ctx.executor,
      formData: ctx.formData,
      instanceId: ctx.instanceId,
      selectedNextApprovers: ctx.selectedNextApprovers?.[t.nodeKey],
    });

    const userIds = await applyAssigneeRuntimeStrategies(t, resolvedUserIds, ctx);
    if (userIds.length === 0) {
      // T3-2 节点级异常处理：审批人解析为空时，优先按本节点 catchAction 兜底
      const nodeCatch = t.nodeConfig.catchAction;
      if (nodeCatch) {
        if (nodeCatch === 'terminate') {
          pushAutoRow(t, 'rejected');
        } else if (nodeCatch === 'toAdmin') {
          const adminId = await resolveAdminAssigneeId(ctx.executor);
          if (adminId) {
            rows.push({
              instanceId: ctx.instanceId,
              nodeKey: t.nodeKey,
              nodeName: t.nodeName,
              nodeType: t.nodeType,
              assigneeId: adminId,
              status: 'pending' as const,
            });
          } else {
            pushAutoRow(t, 'rejected');
          }
        } else {
          // notify：自动通过本节点并继续 + 通知相关人
          pushAutoRow(t, 'approved');
          const adminId = await resolveAdminAssigneeId(ctx.executor);
          const recipients = t.nodeConfig.catchNotifyUserIds && t.nodeConfig.catchNotifyUserIds.length > 0
            ? t.nodeConfig.catchNotifyUserIds
            : [ctx.initiatorId, adminId].filter((v): v is number => typeof v === 'number');
          if (recipients.length > 0) {
            try {
              await ctx.executor.insert(inAppMessages).values([...new Set(recipients)].map((uid) => ({
                userId: uid,
                title: '流程异常提醒',
                content: `流程节点「${t.nodeName}」审批人解析为空，已按异常处理自动通过`,
                type: 'warning' as const,
                source: 'system' as const,
                tenantId: null,
              })));
            } catch { /* 通知失败不影响流转 */ }
          }
        }
        continue;
      }
      // T3-2 异常捕获（React Flow 异常边）：节点存在指向 catchNode 的异常出边时，按 catchAction 兜底
      const catchCfg = ctx.flowData ? findExceptionCatchNode(ctx.flowData, t.nodeKey) : null;
      if (catchCfg) {
        const action = catchCfg.catchAction ?? 'notify';
        if (action === 'terminate') {
          pushAutoRow(t, 'rejected');
        } else if (action === 'toAdmin') {
          const adminId = await resolveAdminAssigneeId(ctx.executor);
          if (adminId) {
            rows.push({
              instanceId: ctx.instanceId,
              nodeKey: catchCfg.key,
              nodeName: catchCfg.label,
              nodeType: 'catchNode',
              assigneeId: adminId,
              status: 'pending' as const,
            });
          } else {
            pushAutoRow(t, 'rejected');
          }
        } else {
          // notify：记录跳过的异常节点 + 继续后续路径 + 通知相关人
          rows.push({
            instanceId: ctx.instanceId,
            nodeKey: catchCfg.key,
            nodeName: catchCfg.label,
            nodeType: 'catchNode',
            assigneeId: null,
            status: 'skipped' as const,
            actionAt: new Date(),
          });
          autoApprovedNodeKeys.push(catchCfg.key);
          const adminId = await resolveAdminAssigneeId(ctx.executor);
          const recipients = catchCfg.catchNotifyUserIds && catchCfg.catchNotifyUserIds.length > 0
            ? catchCfg.catchNotifyUserIds
            : [ctx.initiatorId, adminId].filter((v): v is number => typeof v === 'number');
          if (recipients.length > 0) {
            try {
              await ctx.executor.insert(inAppMessages).values([...new Set(recipients)].map((uid) => ({
                userId: uid,
                title: '流程异常提醒',
                content: `流程节点「${t.nodeName}」审批人解析为空，已触发异常处理（${catchCfg.label}）`,
                type: 'warning' as const,
                source: 'system' as const,
                tenantId: null,
              })));
            } catch { /* 通知失败不影响流转 */ }
          }
        }
        continue;
      }
      const emptyStrategy = t.nodeConfig.emptyStrategy ?? 'autoApprove';
      let emptyAssignIds: number[] = [];
      if (t.nodeConfig.emptyAssignToIds && t.nodeConfig.emptyAssignToIds.length > 0) {
        emptyAssignIds = t.nodeConfig.emptyAssignToIds;
      } else if (t.nodeConfig.emptyAssignTo) {
        emptyAssignIds = [t.nodeConfig.emptyAssignTo];
      }
      if (emptyStrategy === 'assignTo' && emptyAssignIds.length > 0) {
        const emptyMethod: 'and' | 'or' | null = emptyAssignIds.length > 1 ? 'and' : null;
        emptyAssignIds.forEach((uid) => {
          rows.push({
            instanceId: ctx.instanceId,
            nodeKey: t.nodeKey,
            nodeName: t.nodeName,
            nodeType: t.nodeType,
            assigneeId: uid,
            status: 'pending' as const,
            approveMethod: emptyMethod,
          });
        });
      } else if (emptyStrategy === 'assignToAdmin') {
        const adminId = await resolveAdminAssigneeId(ctx.executor);
        if (adminId) {
          rows.push({
            instanceId: ctx.instanceId,
            nodeKey: t.nodeKey,
            nodeName: t.nodeName,
            nodeType: t.nodeType,
            assigneeId: adminId,
            status: 'pending' as const,
          });
        } else {
          pushAutoRow(t, 'rejected');
        }
      } else if (emptyStrategy === 'reject') {
        pushAutoRow(t, 'rejected');
      } else {
        pushAutoRow(t, 'approved');
      }
      continue;
    }

    let effectiveUserIds = userIds;
    if (rawMethod === 'random' && userIds.length > 1) {
      effectiveUserIds = [userIds[Math.floor(Math.random() * userIds.length)]];
    }
    // 设计态(含 random/auto) → 运行态 4 值的唯一权威转换点
    const method: WorkflowResolvedApproveMethod = resolveRuntimeApproveMethod(rawMethod, userIds.length);
    const ratioPct = method === 'ratio'
      ? Math.min(100, Math.max(1, t.nodeConfig.approveRatio ?? 51))
      : null;
    const assignList = await applyDelegations(effectiveUserIds);
    assignList.forEach(({ assigneeId, delegatedFromId }, idx) => {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        assigneeId,
        delegatedFromId,
        // 顺序会签：只有第一人 pending，其余 waiting
        status: method === 'sequential' && idx > 0 ? 'waiting' as const : 'pending' as const,
        taskOrder: method === 'sequential' ? idx : null,
        approveMethod: assignList.length > 1 ? method : null,
        approveRatio: assignList.length > 1 ? ratioPct : null,
      });
    });
  }
  return { rows, autoApprovedNodeKeys, autoRejectedNodeKey };
}

/**
 * 供 ccNode onlyOnApprove 判定的「已完成审批节点」集合：
 * 仅统计各节点**当前激活轮**中存在 approved 的节点（skipped 不算通过——
 * 驳回连带跳过、撤回作废、取消清场的行都不应让抄送误判"上游已通过"）。
 * 历史轮（重入前）的 approved 同样不参与，与 checkNodeCompletion 口径一致。
 */
async function getCompletedNodeKeys(exec: DbExecutor, instanceId: number): Promise<Set<string>> {
  const rows = await exec.select({ id: workflowTasks.id, nodeKey: workflowTasks.nodeKey, status: workflowTasks.status, activationId: workflowTasks.activationId })
    .from(workflowTasks)
    .where(eq(workflowTasks.instanceId, instanceId));
  const byNode = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = byNode.get(row.nodeKey);
    if (group) group.push(row);
    else byNode.set(row.nodeKey, [row]);
  }
  const keys = new Set<string>();
  for (const [nodeKey, group] of byNode) {
    const current = filterCurrentActivation(group);
    if (current.some((t) => t.status === 'approved')) keys.add(nodeKey);
  }
  keys.add('start');
  return keys;
}

type WorkflowTokenSnapshot = { id: number; nodeKey: string; branchPath: BranchPath };

/** 读取实例当前全部 active token（含 parked join token） */
export async function loadLiveTokens(exec: DbExecutor, instanceId: number): Promise<WorkflowTokenSnapshot[]> {
  const rows = await exec.select({ id: workflowTokens.id, nodeKey: workflowTokens.nodeKey, branchPath: workflowTokens.branchPath })
    .from(workflowTokens)
    .where(and(eq(workflowTokens.instanceId, instanceId), eq(workflowTokens.status, 'active')));
  return rows.map((r) => ({ id: r.id, nodeKey: r.nodeKey, branchPath: (r.branchPath ?? []) as BranchPath }));
}

/** 终止实例所有 active token（驳回 / 取消 / 撤销 / 强制跳转前清场） */
export async function killInstanceTokens(exec: DbExecutor, instanceId: number): Promise<void> {
  await exec.update(workflowTokens)
    .set({ status: 'dead', consumedAt: new Date() })
    .where(and(eq(workflowTokens.instanceId, instanceId), eq(workflowTokens.status, 'active')));
}

/** 推进的触发方式（service 语义层，内部翻译为引擎触发并管理 token 落库） */
export type MaterializeTrigger =
  /** 实例发起 / 重新发起：从 start 播种 */
  | { kind: 'seed' }
  /** 某节点已完成：消费该节点的 active token，从其出边推进（含网关/汇聚） */
  | { kind: 'advanceNode'; nodeKey: string }
  /** 直接进入某节点（强制跳转 / 退回 / 异常捕获）：可选先消费某节点 token */
  | { kind: 'enterNode'; nodeKey: string; consumeNodeKey?: string };

/**
 * Token 驱动的推进 + 落库（取代旧 materializeAdvanceResult）。
 * 以 workflow_tokens 为活动路径/网关汇聚的权威来源：消费完成 token → 产出新 token + 建任务行。
 * 多人审批完成判定（checkNodeCompletion）与任务展开（expandTasksToRows）保持不变。
 */
export async function advanceAndMaterialize(
  trigger: MaterializeTrigger,
  ctx: { instanceId: number; initiatorId: number; executor: DbExecutor; flowData: WorkflowFlowData; formData: Record<string, unknown>; settings?: WorkflowFlowData['settings']; selectedNextApprovers?: Record<string, number[]>; starter?: WorkflowStarterContext; tenantId?: number | null; scopeKey?: string | null },
): Promise<{ createdTasks: typeof workflowTasks.$inferSelect[]; finished: boolean; rejected: boolean; currentNodeKeys: string[] }> {
  const exec = ctx.executor;
  const createdTasks: typeof workflowTasks.$inferSelect[] = [];
  let finished = false;
  let rejected = false;
  let currentNodeKeys: string[] = [];

  // 决策表→网关注入：routeGateway 配 decisionRuleKey 时，求值并把输出并入 formData，供出边条件选支
  const decisionNodes = (ctx.flowData.nodes ?? []).filter((n) => n.data.type === 'routeGateway' && n.data.decisionRuleKey);
  for (const n of decisionNodes) {
    const outputs = await getDecisionOutputs(n.data.decisionRuleKey!, { form: ctx.formData, starter: ctx.starter }, { instanceId: ctx.instanceId, nodeKey: n.data.key, source: 'runtime' });
    Object.assign(ctx.formData, outputs);
  }

  // 解析初始引擎触发（并按需先行消费 token）
  const engineTriggers: AdvanceTrigger[] = [];
  if (trigger.kind === 'seed') {
    engineTriggers.push({ type: 'seed' });
  } else if (trigger.kind === 'advanceNode') {
    const live = await loadLiveTokens(exec, ctx.instanceId);
    const tk = live.find((t) => t.nodeKey === trigger.nodeKey);
    if (!tk) throw new HTTPException(500, { message: `节点「${trigger.nodeKey}」缺少执行 Token，实例 token 状态异常` });
    engineTriggers.push({ type: 'advance', tokenId: tk.id, nodeKey: tk.nodeKey, branchPath: tk.branchPath });
  } else {
    if (trigger.consumeNodeKey) {
      const live = await loadLiveTokens(exec, ctx.instanceId);
      const tk = live.find((t) => t.nodeKey === trigger.consumeNodeKey);
      if (tk) await exec.update(workflowTokens).set({ status: 'consumed', consumedAt: new Date() }).where(eq(workflowTokens.id, tk.id));
    }
    engineTriggers.push({ type: 'enter', nodeKey: trigger.nodeKey, branchPath: [] });
  }

  while (engineTriggers.length > 0 && !rejected) {
    const et = engineTriggers.shift();
    if (!et) break;
    const liveTokens = await loadLiveTokens(exec, ctx.instanceId);
    const completedNodeKeys = await getCompletedNodeKeys(exec, ctx.instanceId);
    const res = advanceTokens({
      flowData: ctx.flowData,
      formData: ctx.formData,
      starter: ctx.starter,
      liveTokens,
      trigger: et,
      completedNodeKeys,
    });

    // 1) 消费 token（推进越过 / join 汇聚消费）
    if (res.ops.consume.length > 0) {
      await exec.update(workflowTokens).set({ status: 'consumed', consumedAt: new Date() })
        .where(and(eq(workflowTokens.instanceId, ctx.instanceId), inArray(workflowTokens.id, res.ops.consume)));
    }

    // 2) 展开并落库任务行（人员解析 / 委托 / 加签 / cc / 外部审批 / delay / trigger / subProcess）
    let autoApprovedNodeKeys: string[] = [];
    let autoRejected = false;
    if (res.tasksToCreate.length > 0) {
      const expanded = await expandTasksToRows(res.tasksToCreate, ctx);
      if (expanded.rows.length > 0) {
        // 节点激活轮次：同一次进入节点创建的一批任务共享一个 activationId；
        // 重入（驳回回退/退回重审后再次到达）生成新值，完成判定只统计当前轮，
        // 避免历史 rejected 任务卡死 and 判定 / 污染 ratio 分母
        const activationByNode = new Map<string, string>();
        const rowsWithActivation = expanded.rows.map((row) => {
          let activation = activationByNode.get(row.nodeKey);
          if (!activation) {
            activation = randomUUID();
            activationByNode.set(row.nodeKey, activation);
          }
          return { ...row, activationId: activation };
        });
        const inserted = await exec.insert(workflowTasks).values(rowsWithActivation).returning();
        createdTasks.push(...inserted);
        // 事务内装配异步作业（延时/超时/触发器/外部派发/子流程发起），与任务行同生共死，避免提交后进程崩溃丢作业
        for (const t of inserted) {
          await armTaskAsyncJobs(t, { id: ctx.instanceId, flowData: ctx.flowData, formData: ctx.formData, tenantId: ctx.tenantId ?? null }, exec);
        }
      }
      autoApprovedNodeKeys = expanded.autoApprovedNodeKeys;
      autoRejected = !!expanded.autoRejectedNodeKey;
    }

    // 3) 落库新建 token；expand 已自动通过的 frontier 不落 token，改为续接推进
    const autoSet = new Set(autoApprovedNodeKeys);
    for (const spec of res.ops.create) {
      if (autoSet.has(spec.nodeKey)) {
        engineTriggers.push({ type: 'continue', nodeKey: spec.nodeKey, branchPath: spec.branchPath, parentTokenId: spec.parentTokenId });
      } else {
        await exec.insert(workflowTokens).values({
          instanceId: ctx.instanceId,
          nodeKey: spec.nodeKey,
          status: 'active',
          branchPath: spec.branchPath,
          parentTokenId: spec.parentTokenId,
          scopeKey: ctx.scopeKey ?? null,
          tenantId: ctx.tenantId ?? null,
        });
      }
    }

    if (res.finished) finished = true;
    if (res.rejected || autoRejected) rejected = true;
    if (res.activeNodeKeys.length > 0) currentNodeKeys = res.activeNodeKeys;
  }

  if (rejected) {
    // 自动拒绝终止：清理残留待办 + 终止全部 token，保证 rejected 实例无残留
    const orphanIds = createdTasks
      .filter((t) => t.status === 'pending' || t.status === 'waiting')
      .map((t) => t.id);
    if (orphanIds.length > 0) {
      await exec.update(workflowTasks)
        .set({ status: 'skipped', actionAt: new Date() })
        .where(inArray(workflowTasks.id, orphanIds));
    }
    await killInstanceTokens(exec, ctx.instanceId);
    const remaining = createdTasks.filter((t) => t.status !== 'pending' && t.status !== 'waiting');
    return { createdTasks: remaining, finished: false, rejected: true, currentNodeKeys: [] };
  }
  return { createdTasks, finished, rejected: false, currentNodeKeys };
}

/**
 * 过滤出节点"当前激活轮"的任务：以最新任务行的 activationId 为当前轮标识。
 * 重入节点（驳回回退/退回重审后再次到达）会生成新 activationId，历史轮的
 * rejected/skipped 任务不再参与完成判定与 ratio 分母。
 * 兼容历史数据：最新行无 activationId 时回退全量（保持旧行为）。
 */
export function filterCurrentActivation<T extends { id: number; activationId: string | null }>(rows: T[]): T[] {
  if (rows.length === 0) return rows;
  const latest = rows.reduce((a, b) => (b.id > a.id ? b : a));
  if (!latest.activationId) return rows;
  return rows.filter((t) => t.activationId === latest.activationId);
}

/**
 * 检查同一 (instanceId, nodeKey) 下的全部任务是否已达成完成条件。
 * - and （会签）：所有人 approved 才完成
 * - or  （或签）：任一人 approved 即完成，其余 pending 任务自动 skipped
 * - sequential（顺序会签）：逐个转换 waiting -> pending，全部 approved 后完成
 */
export async function checkNodeCompletion(
  tx: DbExecutor,
  instanceId: number,
  nodeKey: string,
  flowData?: WorkflowFlowData,
): Promise<{ completed: boolean; method: WorkflowResolvedApproveMethod | null }> {
  const allRows = await tx.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.nodeKey, nodeKey)));
  if (allRows.length === 0) return { completed: true, method: null };
  const siblings = filterCurrentActivation(allRows);
  const method = siblings.find((t) => t.approveMethod)?.approveMethod ?? null;

  // before-加签恢复：如果同节点存在挂起原任务（status=waiting且非顺序会签）且所有 [加签-前] 任务都已处理，则将原任务升回 pending，让节点能够继续流转。
  const beforeSuspended = siblings.filter((t) => t.status === 'waiting' && t.taskOrder == null);
  if (beforeSuspended.length > 0) {
    const beforeSignTasks = siblings.filter((t) => t.comment?.startsWith('[加签-前]'));
    const allBeforeResolved = beforeSignTasks.length > 0
      && beforeSignTasks.every((t) => t.status === 'approved' || t.status === 'skipped');
    if (allBeforeResolved) {
      const restoredIds = beforeSuspended.map((t) => t.id);
      await tx.update(workflowTasks).set({ status: 'pending' })
        .where(inArray(workflowTasks.id, restoredIds));
      for (const t of beforeSuspended) {
        siblings[siblings.findIndex((s) => s.id === t.id)] = { ...t, status: 'pending' };
      }
    } else {
      // 原任务仍需等待加签人完成，节点不可能完成
      return { completed: false, method };
    }
  }

  if (!method || method === 'and') {
    const allDone = siblings.every((t) => t.status === 'approved' || t.status === 'skipped');
    return { completed: allDone, method };
  }
  if (method === 'or') {
    const anyApproved = siblings.some((t) => t.status === 'approved');
    if (anyApproved) {
      // 其余 pending 任务跳过
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
        .where(and(
          eq(workflowTasks.instanceId, instanceId),
          eq(workflowTasks.nodeKey, nodeKey),
          eq(workflowTasks.status, 'pending'),
        ));
      return { completed: true, method };
    }
    return { completed: false, method };
  }
  if (method === 'sequential') {
    const allApproved = siblings.every((t) => t.status === 'approved');
    if (allApproved) return { completed: true, method };
    // 将下一个 waiting 按 taskOrder 提升为 pending
    const nextWaiting = siblings
      .filter((t) => t.status === 'waiting')
      .sort((a, b) => (a.taskOrder ?? 0) - (b.taskOrder ?? 0))[0];
    if (nextWaiting) {
      const nextTimeoutCfg = flowData?.nodes.find((n) => n.data.key === nodeKey)?.data.timeout;
      const nextTimeoutAt = computeTimeoutAt(nextTimeoutCfg);
      await tx.update(workflowTasks).set({ status: 'pending' })
        .where(eq(workflowTasks.id, nextWaiting.id));
      if (nextTimeoutAt) {
        await enqueueJob({ jobType: 'task_timeout', taskId: nextWaiting.id, instanceId, nodeKey, payload: { taskId: nextWaiting.id }, runAt: nextTimeoutAt, maxAttempts: 3, idempotencyKey: `task_timeout:${nextWaiting.id}` }, tx);
      }
    }
    return { completed: false, method };
  }
  if (method === 'ratio') {
    const total = siblings.length;
    const ratioPct = siblings.find((t) => t.approveRatio)?.approveRatio ?? 51;
    const required = Math.ceil(total * ratioPct / 100);
    const approvedCount = siblings.filter((t) => t.status === 'approved').length;
    if (approvedCount >= required) {
      // 剩余 pending/waiting 任务跳过
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
        .where(and(
          eq(workflowTasks.instanceId, instanceId),
          eq(workflowTasks.nodeKey, nodeKey),
          or(eq(workflowTasks.status, 'pending'), eq(workflowTasks.status, 'waiting')),
        ));
      return { completed: true, method };
    }
    return { completed: false, method };
  }
  return { completed: false, method };
}
