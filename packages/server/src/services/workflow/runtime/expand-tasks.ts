import type { WorkflowNodeConfig, WorkflowFlowData, WorkflowResolvedApproveMethod } from '@zenith/shared/workflow';
import { isGatedTrigger } from '@zenith/shared/workflow';
import type { workflowTasks } from '../../../db/schema';
import { resolveRuntimeApproveMethod, type TaskAction } from '../../../lib/workflow-engine';
import type { AssigneeRuntimeResult } from './assignee-policy';

export type ExpandedTaskRow = Omit<typeof workflowTasks.$inferInsert, 'activationId' | 'taskKind'> & { taskKind?: typeof workflowTasks.$inferInsert['taskKind']; taskOrder?: number | null; approveMethod?: WorkflowResolvedApproveMethod | null; approveRatio?: number | null };

export interface ExpandedTaskRows {
  rows: ExpandedTaskRow[];
  autoApprovedNodeKeys: string[];
  autoRejectedNodeKey: string | null;
}

export interface TaskExpansionPorts {
  resolve(config: WorkflowNodeConfig): Promise<number[]>;
  admin(): Promise<number | null>;
  applyPolicy(task: TaskAction, ids: number[]): Promise<AssigneeRuntimeResult>;
  delegate(ids: number[]): Promise<Array<{ assigneeId: number; delegatedFromId: number | null; delegationMode: 'full' | 'suggest' | null }>>;
  notifyException(nodeName: string, detail: string, userIds: number[]): Promise<void>;
  now(): Date;
  random(): number;
  callbackId(): string;
}
export interface TaskExpansionContext {
  instanceId: number;
  initiatorId: number;
  flowData?: WorkflowFlowData;
  ports: TaskExpansionPorts;
}
export function findRuntimeExceptionNode(flow: WorkflowFlowData, key: string): WorkflowNodeConfig | null {
  const source = flow.nodes.find(node => node.data.key === key);
  for (const edge of flow.edges) {
    if (edge.source !== source?.id) continue;
    const target = flow.nodes.find(node => node.id === edge.target);
    if (target && (edge.isException || target.data.type === 'catchNode')) return target.data;
  }
  return null;
}

async function pushAdminFallbackOrReject(args: {
  rows: ExpandedTaskRow[];
  task: TaskAction;
  ctx: TaskExpansionContext;
  /** 落到管理员名下的原因（写入任务 comment，让处理人知道为什么轮到自己） */
  comment: string;
  rejectReason: string;
}): Promise<boolean> {
  const adminId = await args.ctx.ports.admin();
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
    actionAt: args.ctx.ports.now(),
  });
  return false;
}

/** Task expansion rules shared by persistent and memory execution. */
export async function expandRuntimeTasks(tasks: TaskAction[], ctx: TaskExpansionContext): Promise<ExpandedTaskRows> {
  const rows: ExpandedTaskRow[] = [];
  const autoApprovedNodeKeys: string[] = [];
  let autoRejectedNodeKey: string | null = null;
  const pushAutoRow = (task: TaskAction, status: 'approved' | 'rejected', reason?: string) => {
    rows.push({
      instanceId: ctx.instanceId,
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: null,
      status,
      comment: reason ?? null,
      actionAt: ctx.ports.now(),
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
          ...(isCallback ? { externalCallbackId: ctx.ports.callbackId() } : {}),
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
      const ccUserIds = await ctx.ports.resolve(t.nodeConfig);
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
        actionAt: (t.nodeType as string) === 'ccNode' ? null : ctx.ports.now(),
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
        externalCallbackId: ctx.ports.callbackId(),
      });
      continue;
    }
    const rawMethod = t.nodeConfig.approveMethod;

    const resolvedUserIds = await ctx.ports.resolve(t.nodeConfig);

    const userIds = await ctx.ports.applyPolicy(t, resolvedUserIds);
    if (userIds.outcome === 'policySkipped') {
      const reason = userIds.emptiedBy === 'sameInitiator'
        ? '审批人与发起人为同一人，已按规则自动跳过'
        : '审批人与前序节点重复，已按去重规则自动跳过';
      pushAutoRow(t, 'approved', reason);
      continue;
    }
    if (userIds.ids.length === 0) {
      // 解析/替换后确实无人：进入节点异常、异常边或空审批人策略
      const emptyReason = userIds.emptiedBy === 'sameInitiator'
        ? '审批人与发起人为同一人，且未找到可替换的上级/负责人'
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
          const adminId = await ctx.ports.admin();
          const recipients = t.nodeConfig.catchNotifyUserIds && t.nodeConfig.catchNotifyUserIds.length > 0
            ? t.nodeConfig.catchNotifyUserIds
            : [ctx.initiatorId, adminId].filter((v): v is number => typeof v === 'number');
          await ctx.ports.notifyException(t.nodeName, '审批人解析为空，已按异常处理自动通过', recipients);
        }
        continue;
      }
      // T3-2 异常捕获（React Flow 异常边）：节点存在指向 catchNode 的异常出边时，按 catchAction 兜底
      const catchCfg = ctx.flowData ? findRuntimeExceptionNode(ctx.flowData, t.nodeKey) : null;
      if (catchCfg) {
        const action = catchCfg.catchAction ?? 'notify';
        if (action === 'terminate') {
          pushAutoRow(t, 'rejected', `${emptyReason}，按异常捕获策略终止流程`);
        } else if (action === 'toAdmin') {
          const adminId = await ctx.ports.admin();
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
            actionAt: ctx.ports.now(),
          });
          autoApprovedNodeKeys.push(catchCfg.key);
          const adminId = await ctx.ports.admin();
          const recipients = catchCfg.catchNotifyUserIds && catchCfg.catchNotifyUserIds.length > 0
            ? catchCfg.catchNotifyUserIds
            : [ctx.initiatorId, adminId].filter((v): v is number => typeof v === 'number');
          await ctx.ports.notifyException(t.nodeName, `审批人解析为空，已触发异常处理（${catchCfg.label}）`, recipients);
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
      effectiveUserIds = [userIds.ids[Math.floor(ctx.ports.random() * userIds.ids.length)]];
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
        actionAt: ctx.ports.now(),
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
    const assignList = await ctx.ports.delegate(effectiveUserIds);
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
        approveMethod: method,
        approveRatio: ratioPct,
      });
    });
  }
  return { rows, autoApprovedNodeKeys, autoRejectedNodeKey };
}
