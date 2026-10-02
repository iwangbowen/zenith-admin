// ─── 任务行物化与令牌推进（拆分自 workflow-instances.service.ts）───
import { eq, and, or, inArray } from 'drizzle-orm';
import { buildWhere } from '../../../lib/where-helpers';
import { workflowInstances, workflowTasks, workflowTokens } from '../../../db/schema';
import { resolveRuntimeApproveMethod, type TaskAction } from '../../../lib/workflow-engine';
import { advanceTokens, type AdvanceTrigger, type BranchPath } from '../../../lib/workflow-token-engine';
import type { WorkflowResolvedApproveMethod, WorkflowFlowData, WorkflowStarterContext } from '@zenith/shared/workflow';
import { isGatedTrigger } from '@zenith/shared/workflow';
import { HTTPException } from 'hono/http-exception';
import { createDeptTree, resolveAssigneeIds } from '../workflow-assignee-resolver.service';
import { decide } from '../../platform/rules-runtime.service';
import type { DbExecutor } from '../../../db/types';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolveActiveDelegate } from '../workflow-delegations.service';
import { resolveAdminUserId } from '../workflow-assignee-resolver.service';
import { notifyWithin } from '../../messaging/notification-outbox.service';
import { applyAssigneeRuntimeStrategies } from './assignees';
import { armTaskAsyncJobs } from './async-jobs';
import { findExceptionCatchNode } from './mapping';
import { workflowNodeActivations, workflowApprovalSlots } from '../../../db/schema';
import { cancelApprovalActivations, reconcileApprovalActivation } from './approval-state';

/**
 * 将引擎输出的 TaskAction[] 展开为实际需插入的 workflow_tasks 行。
 * - approve / handler：调用 resolver 展开为多人，依据 approveMethod 写入状态／sequence
 * - ccNode / delay / trigger / subProcess：保持原样
 * activationId 不在展开阶段赋值——插入前由 advanceAndMaterialize 按节点统一分配激活轮次
 */
type ExpandedTaskRow = Omit<typeof workflowTasks.$inferInsert, 'activationId' | 'taskKind'> & { taskKind?: typeof workflowTasks.$inferInsert['taskKind']; taskOrder?: number | null; approveMethod?: WorkflowResolvedApproveMethod | null; approveRatio?: number | null };

interface ExpandedTaskRows {
  rows: ExpandedTaskRow[];
  autoApprovedNodeKeys: string[];
  autoRejectedNodeKey: string | null;
}

type ExpandTasksContext = { instanceId: number; initiatorId: number; executor: DbExecutor; formData?: Record<string, unknown>; settings?: WorkflowFlowData['settings']; selectedNextApprovers?: Record<string, number[]>; flowData?: WorkflowFlowData };

async function pushAdminFallbackOrReject(args: {
  rows: ExpandedTaskRow[];
  task: TaskAction;
  ctx: ExpandTasksContext;
  /** 落到管理员名下的原因（写入任务 comment，让处理人知道为什么轮到自己） */
  comment: string;
  rejectReason: string;
}): Promise<boolean> {
  const adminId = await resolveAdminUserId(args.ctx.executor);
  if (adminId) {
    args.rows.push({
      instanceId: args.ctx.instanceId,
      nodeKey: args.task.nodeKey,
      nodeName: args.task.nodeName,
      nodeType: args.task.nodeType,
      assigneeId: adminId,
      status: 'pending' as const,
      // 兜底任务必须自带留痕：否则详情里只有一个管理员名字，看不出为何没有真实审批人
      comment: `[审批人兜底] ${args.comment}，已转交系统管理员处理`,
    });
    return true;
  }
  args.rows.push({
    instanceId: args.ctx.instanceId,
    nodeKey: args.task.nodeKey,
    nodeName: args.task.nodeName,
    nodeType: args.task.nodeType,
    assigneeId: null,
    status: 'rejected' as const,
    comment: args.rejectReason,
    actionAt: new Date(),
  });
  return false;
}

async function expandTasksToRows(
  tasks: TaskAction[],
  ctx: ExpandTasksContext,
): Promise<ExpandedTaskRows> {
  const rows: ExpandedTaskRow[] = [];
  const autoApprovedNodeKeys: string[] = [];
  let autoRejectedNodeKey: string | null = null;

  // 本次物化内所有节点共享一棵惰性部门树：不涉及部门的节点不触发查询，
  // 涉及的多个节点也只拉取一次部门表
  const deptTree = createDeptTree(ctx.executor);

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
  let cachedTenantId: number | null | undefined;
  const notifyNodeException = async (nodeName: string, detail: string, userIds: number[]) => {
    const recipients = [...new Set(userIds)];
    if (recipients.length === 0) return;
    try {
      if (cachedTenantId === undefined) {
        const [r] = await ctx.executor
          .select({ tenantId: workflowInstances.tenantId })
          .from(workflowInstances)
          .where(eq(workflowInstances.id, ctx.instanceId))
          .limit(1);
        cachedTenantId = r?.tenantId ?? null;
      }
      await notifyWithin(ctx.executor, 'workflow.node.exception', {
        recipients: recipients.map((id) => ({ type: 'user' as const, id })),
        vars: { instanceId: ctx.instanceId, node: nodeName, detail },
        tenantId: cachedTenantId,
        subjectRefs: [{ type: 'workflow.instance', key: String(ctx.instanceId), role: 'primary' }],
        link: `/workflow/applications?instanceId=${ctx.instanceId}`,
      });
    } catch { /* 通知失败不影响流转 */ }
  };

  const pushAutoRow = (task: TaskAction, status: 'approved' | 'rejected', reason?: string) => {
    rows.push({
      instanceId: ctx.instanceId,
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: null,
      status,
      comment: reason ?? null,
      actionAt: new Date(),
    });
    if (status === 'approved') autoApprovedNodeKeys.push(task.nodeKey);
    else autoRejectedNodeKey = task.nodeKey;
  };

  for (const t of tasks) {
    if (t.autoStatus) {
      pushAutoRow(t, t.autoStatus, t.autoStatus === 'approved' ? '节点配置为自动通过' : '节点配置为自动拒绝');
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
      // 门控判定必须与 token-engine / trigger-dispatch 一致（isGatedTrigger）
      if (isGatedTrigger(tcfg)) {
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
        deptTree,
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
      deptTree,
    });

    const userIds = await applyAssigneeRuntimeStrategies(t, resolvedUserIds, ctx);
    if (userIds.ids.length === 0) {
      // 审批人为空的可解释性留痕：同人跳过 / 去重跳过 / 解析为空，写入自动任务 comment
      const emptyReason = userIds.emptiedBy === 'sameInitiator'
        ? '审批人与发起人为同一人，已按规则自动跳过'
        : userIds.emptiedBy === 'dedup'
          ? '审批人与前序节点重复，已按去重规则自动跳过'
          : '审批人解析为空';
      // T3-2 节点级异常处理：审批人解析为空时，优先按本节点 catchAction 兜底
      const nodeCatch = t.nodeConfig.catchAction;
      if (nodeCatch) {
        if (nodeCatch === 'terminate') {
          pushAutoRow(t, 'rejected', `${emptyReason}，按异常策略终止流程`);
        } else if (nodeCatch === 'toAdmin') {
          if (!await pushAdminFallbackOrReject({ rows, task: t, ctx, comment: `${emptyReason}（节点异常策略：转交管理员）`, rejectReason: `${emptyReason}，且无可用管理员接管，自动拒绝` })) autoRejectedNodeKey = t.nodeKey;
        } else {
          // notify：自动通过本节点并继续 + 通知相关人
          pushAutoRow(t, 'approved', `${emptyReason}，按异常策略自动通过`);
          const adminId = await resolveAdminUserId(ctx.executor);
          const recipients = t.nodeConfig.catchNotifyUserIds && t.nodeConfig.catchNotifyUserIds.length > 0
            ? t.nodeConfig.catchNotifyUserIds
            : [ctx.initiatorId, adminId].filter((v): v is number => typeof v === 'number');
          await notifyNodeException(t.nodeName, '审批人解析为空，已按异常处理自动通过', recipients);
        }
        continue;
      }
      // T3-2 异常捕获（React Flow 异常边）：节点存在指向 catchNode 的异常出边时，按 catchAction 兜底
      const catchCfg = ctx.flowData ? findExceptionCatchNode(ctx.flowData, t.nodeKey) : null;
      if (catchCfg) {
        const action = catchCfg.catchAction ?? 'notify';
        if (action === 'terminate') {
          pushAutoRow(t, 'rejected', `${emptyReason}，按异常捕获策略终止流程`);
        } else if (action === 'toAdmin') {
          const adminId = await resolveAdminUserId(ctx.executor);
          if (adminId) {
            rows.push({
              instanceId: ctx.instanceId,
              nodeKey: catchCfg.key,
              nodeName: catchCfg.label,
              nodeType: 'catchNode',
              assigneeId: adminId,
              status: 'pending' as const,
              comment: `[审批人兜底] ${emptyReason}，已触发异常捕获（${catchCfg.label}）并转交系统管理员处理`,
            });
          } else {
            pushAutoRow(t, 'rejected', `${emptyReason}，且无可用管理员接管，自动拒绝`);
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
            comment: `${emptyReason}，已触发异常捕获（${catchCfg.label}）`,
            actionAt: new Date(),
          });
          autoApprovedNodeKeys.push(catchCfg.key);
          const adminId = await resolveAdminUserId(ctx.executor);
          const recipients = catchCfg.catchNotifyUserIds && catchCfg.catchNotifyUserIds.length > 0
            ? catchCfg.catchNotifyUserIds
            : [ctx.initiatorId, adminId].filter((v): v is number => typeof v === 'number');
          await notifyNodeException(t.nodeName, `审批人解析为空，已触发异常处理（${catchCfg.label}）`, recipients);
        }
        continue;
      }
      const emptyStrategy = t.nodeConfig.emptyStrategy ?? 'autoApprove';
      const emptyAssignIds = t.nodeConfig.emptyAssignToIds ?? [];
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
            comment: `[审批人兜底] ${emptyReason}，已按空审批人策略转交指定成员处理`,
          });
        });
      } else if (emptyStrategy === 'assignToAdmin') {
        if (!await pushAdminFallbackOrReject({ rows, task: t, ctx, comment: `${emptyReason}（空审批人策略：转交管理员）`, rejectReason: `${emptyReason}，且无可用管理员接管，自动拒绝` })) autoRejectedNodeKey = t.nodeKey;
      } else if (emptyStrategy === 'reject') {
        pushAutoRow(t, 'rejected', `${emptyReason}，按空审批人策略自动拒绝`);
      } else {
        pushAutoRow(t, 'approved', userIds.emptiedBy ? `${emptyReason}，节点自动通过` : `${emptyReason}，按空审批人策略自动通过`);
      }
      continue;
    }

    let effectiveUserIds = userIds.ids;
    if (rawMethod === 'random' && userIds.ids.length > 1) {
      effectiveUserIds = [userIds.ids[Math.floor(Math.random() * userIds.ids.length)]];
    }
    // 运行时策略部分剔除的具名留痕：多人节点中被"同发起人/去重"排除的人落 skipped 行
    // （signType='excluded' 不参与节点完成判定与 ratio 分母，仅时间线可见性）
    for (const ex of userIds.excluded) {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        assigneeId: ex.userId,
        status: 'skipped' as const,
        taskKind: 'excluded' as const,
        actionAt: new Date(),
        comment: ex.reason === 'sameInitiator'
          ? '与发起人为同一人，已按规则自动跳过'
          : '与前序审批人重复，已按去重规则自动跳过',
      });
    }
    // 设计态(含 random/auto) → 运行态 4 值的唯一权威转换点
    const method: WorkflowResolvedApproveMethod = resolveRuntimeApproveMethod(rawMethod, userIds.ids.length);
    const ratioPct = method === 'ratio'
      ? Math.min(100, Math.max(1, t.nodeConfig.approveRatio ?? 51))
      : null;
    const assignList = await applyDelegations(effectiveUserIds);
    assignList.forEach(({ assigneeId, delegatedFromId, delegationMode }, idx) => {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        assigneeId,
        delegatedFromId,
        delegationMode,
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
 const rows = await exec.select().from(workflowNodeActivations).where(eq(workflowNodeActivations.instanceId, instanceId)).orderBy(workflowNodeActivations.createdAt);
 const latest = new Map<string, typeof rows[number]>();
 for (const row of rows) latest.set(row.nodeKey, row);
 return new Set(['start', ...[...latest.values()].filter((row) => row.status === 'approved').map((row) => row.nodeKey)]);
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
 await cancelApprovalActivations(exec, instanceId);
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
 * Token 驱动的推进 + 落库。
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

  // 决策资产→网关注入：routeGateway 配 decisionRuleKey 时按 decisionRefKind（缺省决策表）求值，
  // 输出并入 formData 供出边条件选支
  const decisionNodes = (ctx.flowData.nodes ?? []).filter((n) => n.data.type === 'routeGateway' && n.data.decisionRuleKey);
  for (const n of decisionNodes) {
    const decision = await decide(
      { kind: n.data.decisionRefKind ?? 'table', key: n.data.decisionRuleKey! },
      { form: ctx.formData, starter: ctx.starter },
      { caller: 'workflow.gateway', bizRef: `workflow:${ctx.instanceId}#${n.data.key}` },
    );
    Object.assign(ctx.formData, decision.outputs);
  }

  // 解析初始引擎触发（并按需先行消费 token）
  const engineTriggers: AdvanceTrigger[] = [];
  if (trigger.kind === 'seed') {
    engineTriggers.push({ type: 'seed' });
  } else if (trigger.kind === 'advanceNode') {
    const live = await loadLiveTokens(exec, ctx.instanceId);
    const tk = live.find((t) => t.nodeKey === trigger.nodeKey);
    if (!tk) throw new HTTPException(500, { message: `节点「${trigger.nodeKey}」缺少执行 Token，实例 token 状态异常` });
    await exec.update(workflowNodeActivations).set({ status: 'approved', settledAt: new Date() }).where(eq(workflowNodeActivations.tokenId, tk.id));
 engineTriggers.push({ type: 'advance', tokenId: tk.id, nodeKey: tk.nodeKey, branchPath: tk.branchPath });
  } else {
    if (trigger.consumeNodeKey) {
      const live = await loadLiveTokens(exec, ctx.instanceId);
      const tk = live.find((t) => t.nodeKey === trigger.consumeNodeKey);
      if (tk) {
        await exec.update(workflowNodeActivations).set({ status: 'approved', settledAt: new Date() }).where(eq(workflowNodeActivations.tokenId, tk.id));
        await exec.update(workflowTokens).set({ status: 'consumed', consumedAt: new Date() }).where(eq(workflowTokens.id, tk.id));
      }
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

    const expanded = res.tasksToCreate.length > 0 ? await expandTasksToRows(res.tasksToCreate, ctx) : { rows: [], autoApprovedNodeKeys: [], autoRejectedNodeKey: undefined };
    const autoSet = new Set(expanded.autoApprovedNodeKeys);
    const tokenByNode = new Map<string, number>();
    for (const spec of res.ops.create) {
      if (autoSet.has(spec.nodeKey)) engineTriggers.push({ type: 'continue', nodeKey: spec.nodeKey, branchPath: spec.branchPath, parentTokenId: spec.parentTokenId });
      else {
        const [token] = await exec.insert(workflowTokens).values({ instanceId: ctx.instanceId, nodeKey: spec.nodeKey, status: 'active', branchPath: spec.branchPath, parentTokenId: spec.parentTokenId, scopeKey: ctx.scopeKey ?? null, tenantId: ctx.tenantId ?? null }).returning();
        tokenByNode.set(spec.nodeKey, token.id);
      }
    }
    const rowsByNode = new Map<string, ExpandedTaskRow[]>();
    for (const row of expanded.rows) { const bucket = rowsByNode.get(row.nodeKey) ?? []; bucket.push(row); rowsByNode.set(row.nodeKey, bucket); }
    for (const [nodeKey, rows] of rowsByNode) {
      const activationId = randomUUID();
      const basis = rows.filter((row) => (row.nodeType === 'approve' || row.nodeType === 'handler') && row.taskKind !== 'excluded');
      const method = basis.find((row) => row.approveMethod)?.approveMethod ?? (basis.length > 0 ? 'and' : null);
      const ratio = method === 'ratio' ? basis.find((row) => row.approveRatio != null)?.approveRatio ?? 51 : null;
      const required = method === 'or' ? Math.min(1, basis.length) : method === 'ratio' ? Math.ceil(basis.length * ratio! / 100) : basis.length;
      await exec.insert(workflowNodeActivations).values({ id: activationId, instanceId: ctx.instanceId, tokenId: tokenByNode.get(nodeKey) ?? null, nodeKey, nodeName: rows[0].nodeName, status: tokenByNode.has(nodeKey) ? 'active' : 'approved', approveMethod: method, approveRatio: ratio, baseTotal: basis.length, baseRequired: required, tenantId: ctx.tenantId ?? null });
      for (const expandedRow of rows) {
        const { taskOrder, approveMethod: _method, approveRatio: _ratio, taskKind: specifiedKind, ...row } = expandedRow;
        const kind = specifiedKind ?? (row.nodeType === 'ccNode' ? 'cc' : row.nodeType === 'approve' || row.nodeType === 'handler' ? 'approval' : 'system');
        let slotId: number | null = null;
        if (kind === 'approval') {
          const [slot] = await exec.insert(workflowApprovalSlots).values({ activationId, origin: 'base', originalAssigneeId: row.delegatedFromId ?? row.assigneeId ?? null, currentAssigneeId: row.assigneeId ?? null, status: row.status === 'approved' ? 'approved' : row.status === 'rejected' ? 'rejected' : 'pending', order: taskOrder ?? null, tenantId: ctx.tenantId ?? null }).returning(); slotId = slot.id;
        }
        const taskKind = kind === 'approval' && row.delegationMode === 'suggest' ? 'suggestion' : kind;
        const waitReason = row.status !== 'waiting' ? null : row.externalCallbackId ? 'external' : method === 'sequential' && kind === 'approval' ? 'sequence' : row.nodeType === 'subProcess' ? 'subprocess' : row.nodeType === 'delay' ? 'delay' : row.nodeType === 'trigger' ? 'trigger' : null;
        const [task] = await exec.insert(workflowTasks).values({ ...row, activationId, slotId, taskKind, waitReason, activatedAt: row.status === 'pending' ? new Date() : null }).returning();
        if (slotId != null) await exec.update(workflowApprovalSlots).set({ currentTaskId: task.id }).where(eq(workflowApprovalSlots.id, slotId));
        createdTasks.push(task); await armTaskAsyncJobs(task, { id: ctx.instanceId, flowData: ctx.flowData, formData: ctx.formData, tenantId: ctx.tenantId ?? null }, exec);
      }
    }
    const autoRejected = !!expanded.autoRejectedNodeKey;

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
        .set({ status: 'skipped', actionAt: new Date(), comment: '[自动拒绝] 流程被自动拒绝终止，本待办作废' })
        .where(inArray(workflowTasks.id, orphanIds));
    }
    await killInstanceTokens(exec, ctx.instanceId);
    const remaining = createdTasks.filter((t) => t.status !== 'pending' && t.status !== 'waiting');
    return { createdTasks: remaining, finished: false, rejected: true, currentNodeKeys: [] };
  }
  return { createdTasks, finished, rejected: false, currentNodeKeys };
}

/** 完成判定仅使用对应 token 的显式节点进入身份。 */
export async function checkNodeCompletion(tx: DbExecutor, instanceId: number, nodeKey: string, flowData?: WorkflowFlowData, activationId?: string): Promise<{ completed: boolean; failed: boolean; method: WorkflowResolvedApproveMethod | null }> {
 const [inst] = await tx.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId)).limit(1);
 if (!inst) throw new HTTPException(409, { message: '流程实例不存在' });
 const id = activationId ?? (await tx.select({ id: workflowNodeActivations.id }).from(workflowNodeActivations).innerJoin(workflowTokens, eq(workflowNodeActivations.tokenId, workflowTokens.id)).where(and(eq(workflowNodeActivations.instanceId, instanceId), eq(workflowNodeActivations.nodeKey, nodeKey), eq(workflowTokens.status, 'active'))).limit(1))[0]?.id;
 if (!id) throw new HTTPException(409, { message: '节点缺少显式激活轮次' });
 return reconcileApprovalActivation(tx, inst, id, { userId: 0, name: 'system:approval' }, flowData);
}
