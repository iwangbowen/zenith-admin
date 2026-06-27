/**
 * 流程仿真服务：复用真实 DAG 引擎做 dry-run，不落库、不外呼、不创建真实实例。
 */
import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { users, workflowDefinitions } from '../db/schema';
import { currentUser } from '../lib/context';
import { advanceFlow, evaluateCondition, evaluateConditionGroups, getInitialTasks, validateFlowData, type AdvanceResult, type TaskAction } from '../lib/workflow-engine';
import { analyzeWorkflowHealth } from '../lib/workflow-health';
import { tenantCondition } from '../lib/tenant';
import { buildStarterContext, resolveAdminUserId, resolveAssigneeIds } from './workflow-assignee-resolver.service';
import type {
  SimulateWorkflowInput,
  WorkflowConditionGroup,
  WorkflowEdge,
  WorkflowEdgeCondition,
  WorkflowFlowData,
  WorkflowHealthCheckInput,
  WorkflowDefinitionHealthReport,
  WorkflowNodeConfig,
  WorkflowSimulationEdgeResult,
  WorkflowSimulationHealthIssue,
  WorkflowSimulationNodeState,
  WorkflowSimulationResult,
  WorkflowSimulationTimelineItem,
  WorkflowStarterContext,
} from '@zenith/shared';

type SimulatedRuntimeStatus = 'pending' | 'waiting' | 'approved' | 'rejected' | 'skipped';
type SimulationDecision = NonNullable<SimulateWorkflowInput['decisions']>[number];

interface SimulatedTask {
  nodeKey: string;
  nodeName: string;
  nodeType: WorkflowNodeConfig['type'];
  assigneeId: number | null;
  status: SimulatedRuntimeStatus;
  nodeConfig: WorkflowNodeConfig;
  reason?: string;
}

interface SimulationContext {
  flowData: WorkflowFlowData;
  formData: Record<string, unknown>;
  initiatorId: number;
  starter: WorkflowStarterContext;
  maxSteps: number;
  timeline: WorkflowSimulationTimelineItem[];
  nodeStates: Record<string, WorkflowSimulationNodeState>;
  completedKeys: Set<string>;
  pendingTasks: SimulatedTask[];
  warnings: string[];
  visitedNodeKeys: Set<string>;
  decisionsByNode: Map<string, SimulationDecision[]>;
  terminalResult?: WorkflowSimulationResult['result'];
}

const BLOCKING_NODE_TYPES = new Set<WorkflowNodeConfig['type']>(['delay', 'trigger', 'subProcess']);

function isWorkflowFlowData(value: unknown): value is WorkflowFlowData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<WorkflowFlowData>;
  return Array.isArray(data.nodes) && Array.isArray(data.edges);
}

async function resolveFlowData(input: SimulateWorkflowInput): Promise<WorkflowFlowData> {
  if (input.flowData) {
    if (!isWorkflowFlowData(input.flowData)) {
      throw new HTTPException(400, { message: '流程数据格式错误' });
    }
    return input.flowData;
  }

  const definitionId = input.definitionId;
  if (!definitionId) {
    throw new HTTPException(400, { message: '请选择流程定义或传入流程数据' });
  }
  const user = currentUser();
  const tc = tenantCondition(workflowDefinitions, user);
  const conds = [eq(workflowDefinitions.id, definitionId)];
  if (tc) conds.push(tc);
  const [def] = await db.select().from(workflowDefinitions).where(and(...conds)).limit(1);
  if (!def) throw new HTTPException(404, { message: '流程定义不存在' });
  const flowData = def.flowData as WorkflowFlowData | null;
  if (!flowData?.nodes?.length) throw new HTTPException(400, { message: '流程未配置，无法仿真' });
  return flowData;
}

async function resolveUserNames(ids: number[]): Promise<Map<number, string>> {
  const uniqueIds = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
  const nameMap = new Map<number, string>();
  if (uniqueIds.length === 0) return nameMap;
  const rows = await db.select({ id: users.id, nickname: users.nickname, username: users.username })
    .from(users)
    .where(inArray(users.id, uniqueIds));
  for (const row of rows) {
    nameMap.set(row.id, row.nickname ?? row.username);
  }
  return nameMap;
}

function appendTimeline(
  ctx: SimulationContext,
  item: Omit<WorkflowSimulationTimelineItem, 'step'>,
): void {
  ctx.timeline.push({ step: ctx.timeline.length + 1, ...item });
}

function markNode(
  ctx: SimulationContext,
  nodeKey: string,
  state: WorkflowSimulationNodeState,
): void {
  ctx.nodeStates[nodeKey] = state;
}

async function expandTaskAction(
  task: TaskAction,
  ctx: SimulationContext,
): Promise<SimulatedTask[]> {
  if (task.autoStatus) {
    return [{
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: null,
      status: task.autoStatus,
      nodeConfig: task.nodeConfig,
      reason: task.autoStatus === 'approved' ? '节点配置为自动通过' : '节点配置为自动拒绝',
    }];
  }

  if (task.nodeType === 'delay') {
    return [{
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: null,
      status: 'waiting',
      nodeConfig: task.nodeConfig,
      reason: '延迟器在仿真中按模拟等待处理',
    }];
  }

  if (task.nodeType === 'trigger') {
    const triggerType = task.nodeConfig.triggerConfig?.triggerType ?? 'webhook';
    return [{
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: null,
      status: 'waiting',
      nodeConfig: task.nodeConfig,
      reason: `触发器(${triggerType})在仿真中不发起外呼`,
    }];
  }

  if (task.nodeType === 'subProcess') {
    return [{
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: null,
      status: 'waiting',
      nodeConfig: task.nodeConfig,
      reason: '子流程在仿真中不创建真实子实例',
    }];
  }

  if (task.nodeType === 'ccNode') {
    const assigneeIds = await resolveAssigneeIds(task.nodeConfig, {
      initiatorId: ctx.initiatorId,
      formData: ctx.formData,
    });
    return assigneeIds.map((id) => ({
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: id,
      status: 'skipped',
      nodeConfig: task.nodeConfig,
      reason: '抄送节点不阻塞流程',
    }));
  }

  if (task.nodeType !== 'approve' && task.nodeType !== 'handler') {
    return [{
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: task.assigneeId,
      status: 'approved',
      nodeConfig: task.nodeConfig,
    }];
  }

  const assigneeIds = await resolveAssigneeIds(task.nodeConfig, {
    initiatorId: ctx.initiatorId,
    formData: ctx.formData,
  });
  if (assigneeIds.length > 0) {
    return assigneeIds.map((id) => ({
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: id,
      status: 'pending',
      nodeConfig: task.nodeConfig,
    }));
  }

  const emptyStrategy = task.nodeConfig.emptyStrategy ?? 'autoApprove';
  const emptyAssignToIds = task.nodeConfig.emptyAssignToIds?.length
    ? task.nodeConfig.emptyAssignToIds
    : (task.nodeConfig.emptyAssignTo ? [task.nodeConfig.emptyAssignTo] : []);
  if (emptyStrategy === 'assignTo' && emptyAssignToIds.length > 0) {
    return emptyAssignToIds.map((id) => ({
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: id,
      status: 'pending',
      nodeConfig: task.nodeConfig,
      reason: '审批人为空，按配置转交指定人员',
    }));
  }
  if (emptyStrategy === 'assignToAdmin') {
    const adminId = await resolveAdminUserId();
    if (adminId) {
      return [{
        nodeKey: task.nodeKey,
        nodeName: task.nodeName,
        nodeType: task.nodeType,
        assigneeId: adminId,
        status: 'pending',
        nodeConfig: task.nodeConfig,
        reason: '审批人为空，按配置转交管理员',
      }];
    }
    return [{
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: null,
      status: 'rejected',
      nodeConfig: task.nodeConfig,
      reason: '审批人为空且未找到管理员，仿真按拒绝处理',
    }];
  }
  if (emptyStrategy === 'reject') {
    return [{
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: null,
      status: 'rejected',
      nodeConfig: task.nodeConfig,
      reason: '审批人为空，按配置自动拒绝',
    }];
  }
  return [{
    nodeKey: task.nodeKey,
    nodeName: task.nodeName,
    nodeType: task.nodeType,
    assigneeId: null,
    status: 'approved',
    nodeConfig: task.nodeConfig,
    reason: '审批人为空，按配置自动通过',
  }];
}

async function materializeResult(result: AdvanceResult, ctx: SimulationContext): Promise<void> {
  if (result.currentNodeKeys.length > 0) {
    for (const key of result.currentNodeKeys) markNode(ctx, key, { status: 'active' });
  }

  for (const taskAction of result.tasksToCreate) {
    const tasks = await expandTaskAction(taskAction, ctx);
    ctx.pendingTasks.push(...tasks);
    const hasRejected = tasks.some((task) => task.status === 'rejected');
    const hasWaiting = tasks.some((task) => task.status === 'waiting' || task.status === 'pending');
    if (hasRejected) {
      markNode(ctx, taskAction.nodeKey, { status: 'error', message: tasks.find((task) => task.status === 'rejected')?.reason });
    } else if (hasWaiting) {
      markNode(ctx, taskAction.nodeKey, { status: 'active', message: tasks[0]?.reason });
    } else {
      markNode(ctx, taskAction.nodeKey, { status: 'done', message: tasks[0]?.reason });
    }
  }
}

function getNodeByKey(flowData: WorkflowFlowData, nodeKey: string): WorkflowNodeConfig | null {
  return flowData.nodes.find((node) => node.data.key === nodeKey)?.data ?? null;
}

function edgeHasCondition(edge: WorkflowEdge): boolean {
  return !!edge.condition || !!edge.conditions?.length;
}

function isDefaultEdge(edge: WorkflowEdge, targetNode?: WorkflowNodeConfig): boolean {
  return !!edge.isDefault || !!targetNode?.isDefault || !edgeHasCondition(edge);
}

const CONDITION_OPERATOR_LABEL: Record<WorkflowEdgeCondition['operator'], string> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  in: '属于',
  notIn: '不属于',
  contains: '包含',
  isEmpty: '为空',
  isNotEmpty: '不为空',
  between: '介于',
  withinDays: '距今 N 天内',
  beforeDays: '早于 N 天前',
};

function valueText(value: unknown): string {
  if (value === undefined) return '未填写';
  if (value === null) return '空';
  if (Array.isArray(value)) return value.map(valueText).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function describeCondition(condition: WorkflowEdgeCondition): string {
  const source = condition.source === 'starter' ? '发起人' : '表单';
  const aggregate = condition.aggregate
    ? `.${condition.aggregate}${condition.aggregateField ? `(${condition.aggregateField})` : ''}`
    : '';
  const operator = CONDITION_OPERATOR_LABEL[condition.operator] ?? condition.operator;
  if (condition.operator === 'isEmpty' || condition.operator === 'isNotEmpty') {
    return `${source}.${condition.field}${aggregate} ${operator}`;
  }
  return `${source}.${condition.field}${aggregate} ${operator} ${valueText(condition.value)}`;
}

function describeConditionGroups(groups: WorkflowConditionGroup[]): string {
  return groups.map((group) => {
    const joiner = group.type === 'or' ? ' 或 ' : ' 且 ';
    return group.rules.map(describeCondition).join(joiner);
  }).join('；');
}

function actualConditionValue(
  condition: WorkflowEdgeCondition,
  formData: Record<string, unknown>,
  starter: WorkflowStarterContext,
): unknown {
  if (condition.source === 'starter') {
    if (condition.field === 'user') return starter.userId;
    if (condition.field === 'dept') return starter.deptIds;
    if (condition.field === 'role') return starter.roleIds;
    if (condition.field === 'post') return starter.postIds;
    return undefined;
  }

  const raw = formData[condition.field];
  if (!condition.aggregate) return raw;
  const rows = Array.isArray(raw) ? raw : [];
  if (condition.aggregate === 'count') return rows.length;
  const nums = rows
    .map((row) => Number(condition.aggregateField ? (row as Record<string, unknown>)?.[condition.aggregateField] : row))
    .filter((num) => Number.isFinite(num));
  const sum = nums.reduce((total, num) => total + num, 0);
  return condition.aggregate === 'sum' ? sum : (nums.length > 0 ? sum / nums.length : 0);
}

function firstCondition(edge: WorkflowEdge): WorkflowEdgeCondition | null {
  return edge.condition ?? edge.conditions?.find((group) => group.rules.length > 0)?.rules[0] ?? null;
}

function evaluateEdgeCondition(
  edge: WorkflowEdge,
  formData: Record<string, unknown>,
  starter: WorkflowStarterContext,
): boolean | null {
  if (edge.conditions?.length) return evaluateConditionGroups(edge.conditions, formData, starter);
  if (edge.condition) return evaluateCondition(edge.condition, formData, starter);
  return null;
}

function buildEdgeResults(
  flowData: WorkflowFlowData,
  visitedNodeKeys: Set<string>,
  formData: Record<string, unknown>,
  starter: WorkflowStarterContext,
): WorkflowSimulationEdgeResult[] {
  const nodeById = new Map(flowData.nodes.map((node) => [node.id, node.data]));
  return flowData.edges
    .filter((edge) => {
      const target = nodeById.get(edge.target);
      return !edge.isException && target?.type !== 'catchNode';
    })
    .map((edge) => {
      const sourceNode = nodeById.get(edge.source);
      const targetNode = nodeById.get(edge.target);
      const taken = !!sourceNode?.key && !!targetNode?.key
        && visitedNodeKeys.has(sourceNode.key)
        && visitedNodeKeys.has(targetNode.key);
      const conditionMatched = evaluateEdgeCondition(edge, formData, starter);
      const conditionSummary = edge.conditions?.length
        ? describeConditionGroups(edge.conditions)
        : edge.condition
          ? describeCondition(edge.condition)
          : null;
      const first = firstCondition(edge);
      const actualValue = first ? valueText(actualConditionValue(first, formData, starter)) : null;
      const defaultEdge = isDefaultEdge(edge, targetNode);
      const reason = conditionMatched !== null
        ? `${conditionMatched ? '条件命中' : '条件未命中'}${conditionSummary ? `：${conditionSummary}` : ''}`
        : defaultEdge
          ? (taken ? '默认分支被采用' : '默认分支未采用')
          : (taken ? '仿真路径经过此连线' : '仿真未经过此连线');
      return {
        edgeId: edge.id,
        source: edge.source,
        target: edge.target,
        sourceKey: sourceNode?.key,
        targetKey: targetNode?.key,
        label: edge.label ?? null,
        taken,
        reason,
        conditionMatched,
        conditionSummary,
        actualValue,
      };
    });
}

function buildDecisionMap(decisions: SimulateWorkflowInput['decisions']): Map<string, SimulationDecision[]> {
  const map = new Map<string, SimulationDecision[]>();
  for (const decision of decisions ?? []) {
    const list = map.get(decision.nodeKey) ?? [];
    list.push(decision);
    map.set(decision.nodeKey, list);
  }
  return map;
}

function findDecision(task: SimulatedTask, ctx: SimulationContext): SimulationDecision | null {
  const decisions = ctx.decisionsByNode.get(task.nodeKey) ?? [];
  return decisions.find((decision) => !decision.assigneeId || decision.assigneeId === task.assigneeId) ?? null;
}

function attachNextNodeKeys(ctx: SimulationContext, result: AdvanceResult | null): void {
  if (!result || ctx.timeline.length === 0) return;
  const keys = [
    ...result.currentNodeKeys,
    ...result.tasksToCreate.map((task) => task.nodeKey),
  ];
  if (result.finished) {
    const endKeys = ctx.flowData.nodes
      .filter((node) => node.data.type === 'end')
      .map((node) => node.data.key);
    keys.push(...endKeys);
  }
  const nextNodeKeys = [...new Set(keys.filter(Boolean))];
  if (nextNodeKeys.length === 0) return;
  ctx.timeline[ctx.timeline.length - 1] = {
    ...ctx.timeline[ctx.timeline.length - 1],
    nextNodeKeys,
  };
}

function appendFlowHealthIssue(
  issues: WorkflowSimulationHealthIssue[],
  issue: WorkflowSimulationHealthIssue,
): void {
  issues.push(issue);
}

function buildHealthIssues(flowData: WorkflowFlowData, validationErrors: string[] = []): WorkflowSimulationHealthIssue[] {
  const issues: WorkflowSimulationHealthIssue[] = validationErrors.map((message) => ({
    level: 'error',
    scope: 'flow',
    message,
    suggestion: '请先修复流程结构错误后再启动仿真',
  }));
  const nodeById = new Map(flowData.nodes.map((node) => [node.id, node.data]));
  const inCount = new Map<string, number>();
  const outCount = new Map<string, number>();
  for (const edge of flowData.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      appendFlowHealthIssue(issues, {
        level: 'error',
        scope: 'edge',
        edgeId: edge.id,
        message: '连线引用了不存在的节点',
        suggestion: '删除异常连线或重新连接到有效节点',
      });
      continue;
    }
    outCount.set(edge.source, (outCount.get(edge.source) ?? 0) + 1);
    inCount.set(edge.target, (inCount.get(edge.target) ?? 0) + 1);
  }

  const startNodes = flowData.nodes.filter((node) => node.data.type === 'start');
  const endNodes = flowData.nodes.filter((node) => node.data.type === 'end');
  if (startNodes.length === 0) {
    appendFlowHealthIssue(issues, {
      level: 'error',
      scope: 'flow',
      message: '流程缺少发起节点',
      suggestion: '请保留一个发起人节点作为流程入口',
    });
  }
  if (endNodes.length === 0) {
    appendFlowHealthIssue(issues, {
      level: 'warning',
      scope: 'flow',
      message: '流程缺少结束节点',
      suggestion: '建议补充结束节点，便于判断流程是否自然完成',
    });
  }

  for (const node of flowData.nodes) {
    const data = node.data;
    if (data.type !== 'start' && (inCount.get(node.id) ?? 0) === 0) {
      appendFlowHealthIssue(issues, {
        level: data.type === 'end' ? 'warning' : 'error',
        scope: 'node',
        nodeKey: data.key,
        message: `${data.label || data.key} 没有上游连线`,
        suggestion: '请确认该节点是否应接入主流程',
      });
    }
    if (data.type !== 'end' && (outCount.get(node.id) ?? 0) === 0) {
      appendFlowHealthIssue(issues, {
        level: data.type === 'start' ? 'error' : 'warning',
        scope: 'node',
        nodeKey: data.key,
        message: `${data.label || data.key} 没有下游连线`,
        suggestion: '请为该节点连接下一步，或确认它是有意阻塞的节点',
      });
    }
    if ((data.type === 'approve' || data.type === 'handler') && !data.assigneeType && data.approvalType !== 'autoApprove' && data.approvalType !== 'autoReject') {
      appendFlowHealthIssue(issues, {
        level: 'warning',
        scope: 'node',
        nodeKey: data.key,
        message: `${data.label || data.key} 未配置处理人策略`,
        suggestion: '建议配置处理人，或明确设置为空审批人处理策略',
      });
    }
    if ((data.type === 'exclusiveGateway' || data.type === 'routeGateway' || data.type === 'inclusiveGateway') && (outCount.get(node.id) ?? 0) > 1) {
      const outs = flowData.edges.filter((edge) => edge.source === node.id);
      const hasDefault = outs.some((edge) => isDefaultEdge(edge, nodeById.get(edge.target)));
      if (!hasDefault) {
        appendFlowHealthIssue(issues, {
          level: 'warning',
          scope: 'node',
          nodeKey: data.key,
          message: `${data.label || data.key} 缺少默认分支`,
          suggestion: '建议保留一个默认分支，避免测试数据不命中任何条件时流程停住',
        });
      }
    }
  }

  return issues;
}

async function completeTask(task: SimulatedTask, ctx: SimulationContext): Promise<AdvanceResult | null> {
  const nameMap = task.assigneeId ? await resolveUserNames([task.assigneeId]) : new Map<number, string>();
  const assignees = task.assigneeId
    ? [{ id: task.assigneeId, name: nameMap.get(task.assigneeId) ?? `用户#${task.assigneeId}` }]
    : [];
  const decision = findDecision(task, ctx);
  if (decision?.formPatch) Object.assign(ctx.formData, decision.formPatch);

  ctx.visitedNodeKeys.add(task.nodeKey);

  if (task.status === 'rejected') {
    appendTimeline(ctx, {
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      status: 'rejected',
      assignees,
      decision: 'auto',
      reason: task.reason ?? '节点自动拒绝',
      detail: '节点配置或空审批人策略触发了自动拒绝',
    });
    markNode(ctx, task.nodeKey, { status: 'error', message: task.reason });
    ctx.terminalResult = 'rejected';
    return null;
  }

  if (task.status === 'approved' || task.status === 'skipped') {
    appendTimeline(ctx, {
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      status: task.status === 'approved' ? 'autoApproved' : 'skipped',
      assignees,
      decision: 'auto',
      reason: task.reason,
      detail: task.status === 'approved' ? '无需人工操作，仿真自动继续推进' : '该节点不阻塞流程，仿真自动跳过',
    });
    ctx.completedKeys.add(task.nodeKey);
    markNode(ctx, task.nodeKey, { status: 'done', message: task.reason });
    return advanceFlow(ctx.flowData, task.nodeKey, ctx.formData, ctx.completedKeys, ctx.starter);
  }

  if (decision?.action === 'reject') {
    const reason = decision.reason ?? '仿真手动拒绝';
    appendTimeline(ctx, {
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      status: 'rejected',
      assignees,
      decision: 'reject',
      reason,
      detail: '按当前仿真用例的预设动作终止流程',
    });
    markNode(ctx, task.nodeKey, { status: 'error', message: reason });
    ctx.terminalResult = 'rejected';
    return null;
  }

  if (decision?.action === 'wait') {
    const reason = decision.reason ?? '仿真手动暂停在此节点';
    appendTimeline(ctx, {
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      status: 'waiting',
      assignees,
      decision: 'wait',
      reason,
      detail: '仿真按用户选择停在当前节点，便于观察待办状态',
    });
    markNode(ctx, task.nodeKey, { status: 'active', message: reason });
    ctx.terminalResult = 'waiting';
    return null;
  }

  if (decision?.action === 'skip') {
    const reason = decision.reason ?? '仿真手动跳过';
    appendTimeline(ctx, {
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      status: 'skipped',
      assignees,
      decision: 'skip',
      reason,
      detail: '按当前仿真用例跳过该节点并继续推进',
    });
    ctx.completedKeys.add(task.nodeKey);
    markNode(ctx, task.nodeKey, { status: 'skipped', message: reason });
    return advanceFlow(ctx.flowData, task.nodeKey, ctx.formData, ctx.completedKeys, ctx.starter);
  }

  if (BLOCKING_NODE_TYPES.has(task.nodeType)) {
    appendTimeline(ctx, {
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      status: 'waiting',
      assignees,
      reason: `${task.reason}，仿真已模拟继续`,
      detail: '当前仿真启用了模拟继续，不会真实等待、不触发外呼、也不会创建子流程',
    });
    ctx.completedKeys.add(task.nodeKey);
    markNode(ctx, task.nodeKey, { status: 'done', message: '仿真模拟继续' });
    return advanceFlow(ctx.flowData, task.nodeKey, ctx.formData, ctx.completedKeys, ctx.starter);
  }

  const manualApprove = decision?.action === 'approve';
  appendTimeline(ctx, {
    nodeKey: task.nodeKey,
    nodeName: task.nodeName,
    nodeType: task.nodeType,
    status: 'approved',
    assignees,
    decision: 'approve',
    reason: manualApprove ? (decision.reason ?? '仿真手动通过') : '仿真默认通过',
    detail: manualApprove ? '按当前仿真用例的预设动作继续推进' : '未预设动作，仿真默认通过当前人工节点',
  });
  ctx.completedKeys.add(task.nodeKey);
  markNode(ctx, task.nodeKey, { status: 'done' });
  return advanceFlow(ctx.flowData, task.nodeKey, ctx.formData, ctx.completedKeys, ctx.starter);
}

/**
 * 发布前健康体检：纯静态分析流程定义，输出健康评分 + 分维度检查 + 分支覆盖。
 */
export async function checkDefinitionHealth(input: WorkflowHealthCheckInput): Promise<WorkflowDefinitionHealthReport> {
  const flowData = await resolveFlowData(input as SimulateWorkflowInput);
  return analyzeWorkflowHealth(flowData);
}

export async function simulateWorkflow(input: SimulateWorkflowInput): Promise<WorkflowSimulationResult> {
  const flowData = await resolveFlowData(input);
  const requestUser = currentUser();
  const initiatorId = input.starterUserId ?? requestUser.userId;
  const starter = await buildStarterContext(initiatorId);
  const maxSteps = input.options?.maxSteps ?? 100;
  const formData = { ...(input.formData ?? {}) };
  const validation = validateFlowData(flowData);
  const warnings: string[] = [];
  const healthIssues = buildHealthIssues(flowData, validation.errors);
  if (!validation.valid) {
    return {
      valid: false,
      warnings: validation.errors,
      result: 'invalid',
      timeline: [],
      edgeResults: buildEdgeResults(flowData, new Set(), formData, starter),
      nodeStates: {},
      healthIssues,
      pathSignature: [],
    };
  }

  const startNodeKey = flowData.nodes.find((node) => node.data.type === 'start')?.data.key ?? 'start';
  const ctx: SimulationContext = {
    flowData,
    formData,
    initiatorId,
    starter,
    maxSteps,
    timeline: [],
    nodeStates: {},
    completedKeys: new Set(['start', startNodeKey]),
    pendingTasks: [],
    warnings,
    visitedNodeKeys: new Set(['start', startNodeKey]),
    decisionsByNode: buildDecisionMap(input.decisions),
  };

  const starterNameMap = await resolveUserNames([initiatorId]);
  appendTimeline(ctx, {
    nodeKey: startNodeKey,
    nodeName: '发起',
    nodeType: 'start',
    status: 'entered',
    assignees: [{ id: initiatorId, name: starterNameMap.get(initiatorId) ?? `用户#${initiatorId}` }],
    reason: '仿真开始',
  });
  markNode(ctx, startNodeKey, { status: 'done' });

  let result: WorkflowSimulationResult['result'] = 'waiting';
  let advanceResults: AdvanceResult[] = [getInitialTasks(flowData, formData, starter)];

  for (let step = 0; step < maxSteps; step++) {
    if (advanceResults.length > 0) {
      const next = advanceResults.shift();
      if (!next) continue;
      if (next.finished) {
        result = 'finished';
      }
      await materializeResult(next, ctx);
      attachNextNodeKeys(ctx, next);
      if (next.rejected) result = 'rejected';
      if ((next.finished || next.rejected) && ctx.pendingTasks.length === 0 && advanceResults.length === 0) break;
      continue;
    }

    const task = ctx.pendingTasks.shift();
    if (!task) {
      if (result !== 'finished') result = 'blocked';
      break;
    }

    const nodeConfig = getNodeByKey(flowData, task.nodeKey);
    if (nodeConfig) ctx.visitedNodeKeys.add(nodeConfig.key);
    const completion = await completeTask(task, ctx);
    attachNextNodeKeys(ctx, completion);
    if (ctx.terminalResult) {
      result = ctx.terminalResult;
      break;
    }
    if (completion) advanceResults.push(completion);
  }

  if (ctx.timeline.length >= maxSteps && result !== 'finished' && result !== 'rejected') {
    result = 'stepLimit';
    ctx.warnings.push(`仿真超过最大步数 ${maxSteps}，已停止`);
  }

  for (const node of flowData.nodes) {
    if (!ctx.nodeStates[node.data.key]) {
      ctx.nodeStates[node.data.key] = { status: 'skipped' };
    }
  }

  return {
    valid: true,
    warnings: ctx.warnings,
    result,
    timeline: ctx.timeline,
    edgeResults: buildEdgeResults(flowData, ctx.visitedNodeKeys, ctx.formData, ctx.starter),
    nodeStates: ctx.nodeStates,
    healthIssues,
    pathSignature: ctx.timeline.map((item) => item.nodeKey),
  };
}
