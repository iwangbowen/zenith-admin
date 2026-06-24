/**
 * 工作流 DAG 执行引擎
 *
 * 支持的节点类型：
 * - start / end
 * - approve / handler   —— 人工节点，创建任务等待操作
 * - exclusiveGateway / routeGateway   —— 排他网关，根据条件走一条路径
 * - parallelGateway     —— 并行网关：fork 时创建多个任务，join 时等待全部完成
 * - inclusiveGateway    —— 包容网关：fork 时激活所有匹配条件的分支，join 等同 parallel join
 * - ccNode              —— 抄送节点，非阻塞，自动创建抄送任务后继续推进
 * - delay / trigger —— 当前作为非阻塞自动节点（占位实现），P2 由调度器接管
 * - subProcess —— 创建 subProcess 任务；实际子实例的发起 / 多实例展开 / 汇聚由 workflow-instances.service 接管
 */
import type {
  WorkflowFlowData,
  WorkflowNodeConfig,
  WorkflowEdge,
  WorkflowEdgeCondition,
  WorkflowConditionGroup,
  WorkflowStarterContext,
} from '@zenith/shared';
import dayjs from 'dayjs';

// ─── 图遍历工具 ───────────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  data: WorkflowNodeConfig;
}

/** 构建邻接表 */
function buildAdjacency(flowData: WorkflowFlowData) {
  const nodeMap = new Map<string, FlowNode>();
  for (const n of flowData.nodes) {
    nodeMap.set(n.id, { id: n.id, data: n.data });
  }

  // source -> [{ target, edge }]
  const outEdges = new Map<string, Array<{ target: string; edge: WorkflowEdge }>>();
  // target -> [source]
  const inEdges = new Map<string, string[]>();

  for (const edge of flowData.edges) {
    // 异常边（isException 或指向 catchNode）不参与正常流转，仅由运行时异常路由使用
    const targetNode = nodeMap.get(edge.target);
    if (edge.isException || targetNode?.data.type === 'catchNode') continue;

    const out = outEdges.get(edge.source) ?? [];
    out.push({ target: edge.target, edge });
    outEdges.set(edge.source, out);

    const ins = inEdges.get(edge.target) ?? [];
    ins.push(edge.source);
    inEdges.set(edge.target, ins);
  }

  return { nodeMap, outEdges, inEdges };
}

/** 将条件值解析为 ID 数组（支持数字 / 逗号分隔字符串） */
function parseIdList(value: string | number | boolean): number[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [value] : [];
  if (typeof value === 'string') {
    return value.split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map(Number)
      .filter((n) => Number.isFinite(n));
  }
  return [];
}

/** 求值「发起人维度」条件（source='starter'，field=user|dept|role|post，operator=in|notIn） */
function evaluateStarterCondition(
  condition: WorkflowEdgeCondition,
  starter: WorkflowStarterContext | undefined,
): boolean {
  if (!starter) return false;
  const targetIds = parseIdList(condition.value);
  let actual: number[];
  switch (condition.field) {
    case 'user': actual = [starter.userId]; break;
    case 'dept': actual = starter.deptIds; break;
    case 'role': actual = starter.roleIds; break;
    case 'post': actual = starter.postIds; break;
    default: return false;
  }
  const hit = actual.some((id) => targetIds.includes(id));
  return condition.operator === 'notIn' ? !hit : hit;
}

/** 解析区间值 "a,b" / "a~b" → [min, max] */
function parseRange(value: string | number | boolean): [number, number] | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(/[,~]/).map((s) => Number(s.trim()));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
    return [Math.min(parts[0], parts[1]), Math.max(parts[0], parts[1])];
  }
  return null;
}

/** 数值比较（供聚合结果复用） */
function compareNumber(fv: number, operator: WorkflowEdgeCondition['operator'], target: string | number | boolean): boolean {
  const t = Number(target);
  switch (operator) {
    case 'eq': return fv === t;
    case 'neq': return fv !== t;
    case 'gt': return fv > t;
    case 'gte': return fv >= t;
    case 'lt': return fv < t;
    case 'lte': return fv <= t;
    case 'between': { const r = parseRange(target); return r ? fv >= r[0] && fv <= r[1] : false; }
    default: return false;
  }
}

/** 求值条件表达式 */
export function evaluateCondition(
  condition: WorkflowEdgeCondition,
  formData: Record<string, unknown>,
  starter?: WorkflowStarterContext,
): boolean {
  // 发起人维度条件：与表单数据无关，按发起人上下文求值
  if (condition.source === 'starter') {
    return evaluateStarterCondition(condition, starter);
  }

  const fieldValue = formData[condition.field];
  const target = condition.value;

  // 明细子表聚合：对数组型字段按 aggregateField 列聚合后比较
  if (condition.aggregate) {
    const arr = Array.isArray(fieldValue) ? fieldValue : [];
    let agg: number;
    if (condition.aggregate === 'count') {
      agg = arr.length;
    } else {
      const nums = arr
        .map((row) => Number(condition.aggregateField ? (row as Record<string, unknown>)?.[condition.aggregateField] : row))
        .filter((n) => Number.isFinite(n));
      const sum = nums.reduce((a, b) => a + b, 0);
      agg = condition.aggregate === 'sum' ? sum : (nums.length ? sum / nums.length : 0);
    }
    return compareNumber(agg, condition.operator, target);
  }

  // 相对日期：withinDays 距今 N 天内；beforeDays 早于 N 天前
  if (condition.operator === 'withinDays' || condition.operator === 'beforeDays') {
    if (fieldValue == null || fieldValue === '') return false;
    const d = dayjs(fieldValue as string);
    if (!d.isValid()) return false;
    const days = Number(target);
    if (!Number.isFinite(days)) return false;
    const diff = dayjs().diff(d, 'day'); // 正数 = field 在过去
    return condition.operator === 'withinDays' ? Math.abs(diff) <= days : diff > days;
  }

  // Normalize to primitive for safe comparison
  let fv: string | number | boolean | null;
  if (typeof fieldValue === 'string' || typeof fieldValue === 'number' || typeof fieldValue === 'boolean') {
    fv = fieldValue;
  } else if (fieldValue == null) {
    fv = null;
  } else {
    fv = JSON.stringify(fieldValue);
  }

  switch (condition.operator) {
    case 'eq':
      return fv === target || String(fv ?? '') === String(target);
    case 'neq':
      return fv !== target && String(fv ?? '') !== String(target);
    case 'gt':
      return Number(fv) > Number(target);
    case 'gte':
      return Number(fv) >= Number(target);
    case 'lt':
      return Number(fv) < Number(target);
    case 'lte':
      return Number(fv) <= Number(target);
    case 'between': {
      const r = parseRange(target);
      return r ? Number(fv) >= r[0] && Number(fv) <= r[1] : false;
    }
    case 'in':
    case 'notIn': {
      // target 可能是逗号分隔字符串，也可能是单个数字/布尔（如从下拉条件直接存数值）
      const arr = typeof target === 'string'
        ? target.split(',').map((s) => s.trim())
        : [String(target)];
      const inList = arr.includes(String(fv ?? ''));
      return condition.operator === 'notIn' ? !inList : inList;
    }
    case 'contains':
      return typeof fv === 'string' && fv.includes(String(target));
    case 'isEmpty':
    case 'isNotEmpty': {
      const empty = fieldValue == null
        || fieldValue === ''
        || (Array.isArray(fieldValue) && fieldValue.length === 0);
      return condition.operator === 'isEmpty' ? empty : !empty;
    }
    default:
      return false;
  }
}

export function evaluateConditionGroup(
  group: WorkflowConditionGroup,
  formData: Record<string, unknown>,
  starter?: WorkflowStarterContext,
): boolean {
  if (group.rules.length === 0) return false;
  if (group.type === 'or') {
    return group.rules.some((rule) => evaluateCondition(rule, formData, starter));
  }
  return group.rules.every((rule) => evaluateCondition(rule, formData, starter));
}

export function evaluateConditionGroups(
  groups: WorkflowConditionGroup[],
  formData: Record<string, unknown>,
  starter?: WorkflowStarterContext,
): boolean {
  if (groups.length === 0) return false;
  return groups.some((group) => evaluateConditionGroup(group, formData, starter));
}

function edgeHasCondition(edge: WorkflowEdge): boolean {
  return !!edge.condition || !!edge.conditions?.length;
}

function edgeMatchesCondition(
  edge: WorkflowEdge,
  formData: Record<string, unknown>,
  starter?: WorkflowStarterContext,
): boolean {
  if (edge.conditions?.length) return evaluateConditionGroups(edge.conditions, formData, starter);
  if (edge.condition) return evaluateCondition(edge.condition, formData, starter);
  return false;
}

function isDefaultEdge(edge: WorkflowEdge, targetNode?: FlowNode): boolean {
  return !!edge.isDefault || !!targetNode?.data.isDefault || !edgeHasCondition(edge);
}

// ─── 引擎核心 ─────────────────────────────────────────────────────────────────

/**
 * 计算从 start 出发、在给定 formData 下"实际可达"的节点 ID 集合。
 * 用于包容网关 join 判断：未被激活的分支节点视为不可达，从而 join 不需要等待它们。
 */
function computeReachableNodeIds(
  flowData: WorkflowFlowData,
  formData: Record<string, unknown>,
  starter?: WorkflowStarterContext,
): Set<string> {
  const { nodeMap, outEdges } = buildAdjacency(flowData);
  const startNode = flowData.nodes.find(n => n.data.type === 'start');
  const reachable = new Set<string>();
  if (!startNode) return reachable;

  const queue: string[] = [startNode.id];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || reachable.has(id)) continue;
    reachable.add(id);
    const node = nodeMap.get(id);
    if (!node) continue;
    const t = node.data.type;
    if (t === 'end') continue;
    const outs = outEdges.get(id) ?? [];
    if (outs.length === 0) continue;

    if (t === 'exclusiveGateway' || t === 'routeGateway') {
      let chosen: string | null = null;
      let fallback: string | null = null;
      for (const { target, edge } of outs) {
        const tgtNode = nodeMap.get(target);
        if (!tgtNode) continue;
        if (edgeHasCondition(edge)) {
          if (edgeMatchesCondition(edge, formData, starter)) { chosen = target; break; }
        } else if (isDefaultEdge(edge, tgtNode) || !fallback) {
          fallback = target;
        }
      }
      const next = chosen ?? fallback;
      if (next) queue.push(next);
    } else if (t === 'inclusiveGateway') {
      let matched = 0;
      let fallback: string | null = null;
      for (const { target, edge } of outs) {
        const tgtNode = nodeMap.get(target);
        if (!tgtNode) continue;
        if (edgeHasCondition(edge)) {
          if (edgeMatchesCondition(edge, formData, starter)) { queue.push(target); matched++; }
        } else if (isDefaultEdge(edge, tgtNode) || !fallback) {
          fallback = target;
        }
      }
      if (matched === 0 && fallback) queue.push(fallback);
    } else {
      for (const { target } of outs) queue.push(target);
    }
  }
  return reachable;
}

/** 描述引擎推进后需要创建的任务 */
export interface TaskAction {
  nodeKey: string;
  nodeName: string;
  nodeType: WorkflowNodeConfig['type'];
  assigneeId: number | null;
  /** 节点完整配置，供上层解析 assigneeType / approveMethod 等 */
  nodeConfig: WorkflowNodeConfig;
  /** 自动审批/拒绝节点的系统决策，调用方据此落库并继续推进或终止 */
  autoStatus?: 'approved' | 'rejected';
}

/** 引擎推进结果 */
export interface AdvanceResult {
  /** 流程是否结束 */
  finished: boolean;
  /** 流程是否被自动拒绝 */
  rejected?: boolean;
  /** 需要创建的新任务 */
  tasksToCreate: TaskAction[];
  /** 流程当前所在节点（可能有多个，如并行网关 fork 后） */
  currentNodeKeys: string[];
}

/**
 * 从指定节点推进流程
 *
 * @param flowData  流程定义的图数据
 * @param currentNodeKey 当前完成的节点 key
 * @param formData  表单数据（用于条件判断）
 * @param completedNodeKeys 已完成的所有节点 key（用于并行网关 join 判断）
 */
export function advanceFlow(
  flowData: WorkflowFlowData,
  currentNodeKey: string,
  formData: Record<string, unknown> = {},
  completedNodeKeys: Set<string> = new Set(),
  starter?: WorkflowStarterContext,
): AdvanceResult {
  const { nodeMap, outEdges, inEdges } = buildAdjacency(flowData);

  // 找到当前节点对应的 flowNode ID
  const currentFlowNode = flowData.nodes.find(n => n.data.key === currentNodeKey);
  if (!currentFlowNode) {
    return { finished: false, rejected: false, tasksToCreate: [], currentNodeKeys: [] };
  }

  const tasksToCreate: TaskAction[] = [];
  const currentNodeKeys: string[] = [];
  let finished = false;
  let rejected = false;

  // 统一推进到下一个节点：根据节点类型决定 创建任务 / 标记结束 / 继续入队
  function enqueueNext(targetId: string, queue: string[]): void {
    const nextNode = nodeMap.get(targetId);
    if (!nextNode) return;
    const t = nextNode.data.type;
    if (t === 'approve' || t === 'handler') {
      if (nextNode.data.approvalType === 'autoReject') {
        tasksToCreate.push({
          nodeKey: nextNode.data.key,
          nodeName: nextNode.data.label,
          nodeType: t,
          assigneeId: null,
          nodeConfig: nextNode.data,
          autoStatus: 'rejected',
        });
        rejected = true;
        return;
      }
      if (nextNode.data.approvalType === 'autoApprove' || nextNode.data.approveMethod === 'auto') {
        tasksToCreate.push({
          nodeKey: nextNode.data.key,
          nodeName: nextNode.data.label,
          nodeType: t,
          assigneeId: null,
          nodeConfig: nextNode.data,
          autoStatus: 'approved',
        });
        return;
      }
      tasksToCreate.push({
        nodeKey: nextNode.data.key,
        nodeName: nextNode.data.label,
        nodeType: t,
        assigneeId: nextNode.data.assigneeId ?? null,
        nodeConfig: nextNode.data,
      });
      currentNodeKeys.push(nextNode.data.key);
    } else if (t === 'end') {
      finished = true;
    } else {
      // start / 各类网关 / ccNode / delay / trigger / subProcess —— 继续 BFS
      queue.push(targetId);
    }
  }

  // BFS 向前推进
  const queue: string[] = [currentFlowNode.id];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    if (rejected) break;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const nodeType = node.data.type;

    if (nodeType === 'end') {
      finished = true;
      continue;
    }

    // 获取出边
    const outs = outEdges.get(nodeId) ?? [];
    if (outs.length === 0) continue;

    if (nodeType === 'exclusiveGateway' || nodeType === 'routeGateway') {
      // 排他/路由网关：找第一个满足条件的出边，或 default 出边
      let chosenTarget: string | null = null;
      let defaultTarget: string | null = null;

      for (const { target, edge } of outs) {
        const targetNode = nodeMap.get(target);
        if (!targetNode) continue;

        if (edgeHasCondition(edge)) {
          if (edgeMatchesCondition(edge, formData, starter)) {
            chosenTarget = target;
            break;
          }
        }
        if (isDefaultEdge(edge, targetNode) && !defaultTarget) defaultTarget = target;
      }

      const nextId = chosenTarget ?? defaultTarget;
      if (nextId) enqueueNext(nextId, queue);
    } else if (nodeType === 'parallelGateway' || nodeType === 'inclusiveGateway') {
      // 并行/包容网关：判断是 fork 还是 join
      const inCount = (inEdges.get(nodeId) ?? []).length;
      const outCount = outs.length;
      const isFork = outCount > 1 || (outCount === 1 && inCount <= 1);

      if (isFork) {
        if (nodeType === 'inclusiveGateway') {
          // 包容网关 fork：激活所有匹配条件的分支；若都不匹配则走 default
          let matched = 0;
          let defaultTarget: string | null = null;
          for (const { target, edge } of outs) {
            const targetNode = nodeMap.get(target);
            if (!targetNode) continue;
            if (edgeHasCondition(edge)) {
              if (edgeMatchesCondition(edge, formData, starter)) {
                enqueueNext(target, queue);
                matched++;
              }
            } else if (isDefaultEdge(edge, targetNode) || !defaultTarget) {
              defaultTarget = target;
            }
          }
          if (matched === 0 && defaultTarget) enqueueNext(defaultTarget, queue);
        } else {
          // 并行 fork：所有出边都激活
          for (const { target } of outs) enqueueNext(target, queue);
        }
      } else {
        // Join：检查所有入边对应的节点是否都已完成
        // 包容网关 join：仅等待"实际被 fork 激活"的入边（基于 formData 重算可达性）。
        const inSources = inEdges.get(nodeId) ?? [];
        const reachable = nodeType === 'inclusiveGateway'
          ? computeReachableNodeIds(flowData, formData, starter)
          : null;
        // 空分支：fork 直连 join（该分支无任何节点），其入边来自配对 fork，无需等待
        const joinKey = node.data.key;
        const pairedForkKey = joinKey.startsWith('join-') ? `fork-${joinKey.slice('join-'.length)}` : null;
        const allCompleted = inSources.every(srcId => {
          if (reachable && !reachable.has(srcId)) return true; // 未激活分支，视为已完成
          const srcNode = nodeMap.get(srcId);
          if (!srcNode) return true;
          if (pairedForkKey && srcNode.data.key === pairedForkKey) return true; // 空分支直连，无需等待
          return completedNodeKeys.has(srcNode.data.key);
        });

        if (allCompleted) {
          for (const { target } of outs) enqueueNext(target, queue);
        }
        // 否则不推进，等待其他分支完成
      }
    } else if (nodeType === 'ccNode') {
      // 抄送节点：创建抄送任务（自动完成），继续推进
      // 当 onlyOnApprove=true 时，仅当存在已完成的上游 approve/handler 节点时才创建抄送任务
      let shouldCreate = true;
      if (node.data.onlyOnApprove) {
        const visited = new Set<string>();
        const stack: string[] = [...(inEdges.get(node.id) ?? [])];
        let foundApprovedUpstream = false;
        while (stack.length > 0) {
          const srcId = stack.pop();
          if (!srcId || visited.has(srcId)) continue;
          visited.add(srcId);
          const srcNode = nodeMap.get(srcId);
          if (!srcNode) continue;
          const srcType = srcNode.data.type;
          if ((srcType === 'approve' || srcType === 'handler') && completedNodeKeys.has(srcNode.data.key)) {
            foundApprovedUpstream = true;
            break;
          }
          if (srcType !== 'approve' && srcType !== 'handler') {
            // 透过网关/抄送等节点继续向上追溯
            const parents = inEdges.get(srcId) ?? [];
            for (const p of parents) stack.push(p);
          }
        }
        shouldCreate = foundApprovedUpstream;
      }
      if (shouldCreate) {
        // 仅生成单个 TaskAction，实际的接收人解析（含变量插值、去重）由 expandTasksToRows 通过 resolveAssigneeIds 完成
        tasksToCreate.push({
          nodeKey: node.data.key,
          nodeName: node.data.label,
          nodeType: 'ccNode',
          assigneeId: null,
          nodeConfig: node.data,
        });
      }
      for (const { target } of outs) enqueueNext(target, queue);
    } else if (nodeType === 'delay') {
      // 延迟节点：创建 waiting 任务，由调度器在 wakeAt 时唤醒；本次 BFS 在此停止
      tasksToCreate.push({
        nodeKey: node.data.key,
        nodeName: node.data.label,
        nodeType: 'delay',
        assigneeId: null,
        nodeConfig: node.data,
      });
    } else if (nodeType === 'trigger') {
      // 触发器节点：callback 类型需等待外部回调，其他类型立即推进
      const isCallback = node.data.triggerConfig?.triggerType === 'callback';
      tasksToCreate.push({
        nodeKey: node.data.key,
        nodeName: node.data.label,
        nodeType: 'trigger',
        assigneeId: null,
        nodeConfig: node.data,
      });
      if (!isCallback) {
        for (const { target } of outs) enqueueNext(target, queue);
      }
    } else if (nodeType === 'subProcess') {
      // 子流程节点：waitChild=true（默认）则等待子实例完成，否则即时推进
      const waitChild = node.data.subProcessWaitChild !== false;
      tasksToCreate.push({
        nodeKey: node.data.key,
        nodeName: node.data.label,
        nodeType: 'subProcess',
        assigneeId: null,
        nodeConfig: node.data,
      });
      if (!waitChild) {
        for (const { target } of outs) enqueueNext(target, queue);
      }
    } else {
      // start / approve / handler — 已完成的节点，向后推进
      for (const { target } of outs) enqueueNext(target, queue);
    }
  }

  return { finished, rejected, tasksToCreate, currentNodeKeys };
}

/**
 * 获取流程的第一批待执行节点（从 start 往后推进）
 */
export function getInitialTasks(
  flowData: WorkflowFlowData,
  formData: Record<string, unknown> = {},
  starter?: WorkflowStarterContext,
): AdvanceResult {
  const startNode = flowData.nodes.find(n => n.data.type === 'start');
  if (!startNode) {
    return { finished: false, rejected: false, tasksToCreate: [], currentNodeKeys: [] };
  }
  return advanceFlow(flowData, startNode.data.key, formData, new Set(['start']), starter);
}

/**
 * 校验流程定义的有效性
 */
export function validateFlowData(flowData: WorkflowFlowData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const startNodes = flowData.nodes.filter(n => n.data.type === 'start');
  if (startNodes.length === 0) errors.push('流程缺少开始节点');
  if (startNodes.length > 1) errors.push('流程只能有一个开始节点');

  const endNodes = flowData.nodes.filter(n => n.data.type === 'end');
  if (endNodes.length === 0) errors.push('流程缺少结束节点');

  const approveNodes = flowData.nodes.filter(n => n.data.type === 'approve' || n.data.type === 'handler');
  if (approveNodes.length === 0) errors.push('流程至少需要一个审批/办理节点');

  const keys = new Set<string>();
  for (const node of flowData.nodes) {
    if (keys.has(node.data.key)) {
      errors.push(`节点标识"${node.data.key}"重复`);
    }
    keys.add(node.data.key);
  }

  // 检查条件型网关（排他/路由/包容）出边的条件与默认分支配置
  const { nodeMap, outEdges, inEdges } = buildAdjacency(flowData);
  for (const node of flowData.nodes) {
    const gwType = node.data.type;
    if (gwType === 'exclusiveGateway' || gwType === 'routeGateway' || gwType === 'inclusiveGateway') {
      const outs = outEdges.get(node.id) ?? [];
      const ins = inEdges.get(node.id) ?? [];
      // 合流型（多入单出）：作为 merge/join 使用，无需条件/默认分支
      const isMerge = outs.length <= 1 && ins.length >= 2;
      if (isMerge) {
        if (outs.length === 0) {
          errors.push(`网关"${node.data.label}"缺少出边`);
        }
        continue;
      }
      // 分流型（单入多出）：必须 ≥2 出边、有条件、且至多保留一个"无条件（默认）分支"
      if (outs.length < 2) {
        errors.push(`网关"${node.data.label}"至少需要2条出边`);
      }
      if (outs.length > 1) {
        const hasCondition = outs.some(o => edgeHasCondition(o.edge));
        if (!hasCondition) {
          errors.push(`网关"${node.data.label}"的出边需要配置条件`);
        }
        // isDefaultEdge 对"显式默认"与"未配置条件"的分支均为 true；
        // 正常情况下应恰好保留一个默认分支，出现多个即存在未配置条件的分支。
        const defaultLike = outs.filter(o => isDefaultEdge(o.edge, nodeMap.get(o.target)));
        if (defaultLike.length === 0) {
          errors.push(`网关"${node.data.label}"需要保留一个默认分支`);
        } else if (defaultLike.length > 1) {
          errors.push(`网关"${node.data.label}"存在未配置条件的分支，请补全条件（最多保留一个默认分支）`);
        }
      }
    }
    if (gwType === 'parallelGateway') {
      const outs = outEdges.get(node.id) ?? [];
      if (outs.length === 0) {
        errors.push(`并行网关"${node.data.label}"缺少出边`);
      }
    }
    if (gwType === 'subProcess') {
      if (!node.data.subProcessId) {
        errors.push(`子流程"${node.data.label}"未选择要调用的流程定义`);
      }
      if (node.data.subProcessMode === 'multi' && !node.data.subProcessMultiSource) {
        errors.push(`子流程"${node.data.label}"为多实例模式但未指定循环数据源字段`);
      }
    }
    if (gwType === 'delay') {
      if (node.data.delayType === 'toDate') {
        if (!node.data.targetDate) {
          errors.push(`延时节点"${node.data.label}"未指定目标日期字段`);
        }
      } else if (!(typeof node.data.delayValue === 'number' && node.data.delayValue > 0)) {
        errors.push(`延时节点"${node.data.label}"未设置有效的延时时长`);
      }
    }
    if (gwType === 'ccNode') {
      const hasAssignee = node.data.assigneeType
        || (Array.isArray(node.data.assigneeIds) && node.data.assigneeIds.length > 0)
        || typeof node.data.assigneeId === 'number';
      if (!hasAssignee) {
        errors.push(`抄送节点"${node.data.label}"未配置抄送人`);
      }
    }
  }

  // 检查所有节点是否可达
  if (startNodes.length === 1) {
    const visited = new Set<string>();
    const queue = [startNodes[0].id];
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const outs = outEdges.get(id) ?? [];
      for (const { target } of outs) {
        queue.push(target);
      }
    }
    for (const node of flowData.nodes) {
      if (!visited.has(node.id)) {
        errors.push(`节点"${node.data.label}"不可达`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── 兼容旧版线性流程的工具函数 ──────────────────────────────────────────────

/** 按拓扑顺序遍历节点（线性流程后向兼容） */
export function getNodeOrder(flowData: WorkflowFlowData): WorkflowNodeConfig[] {
  const nodeMap = new Map(flowData.nodes.map(n => [n.id, n]));
  const adjacency = new Map<string, string>();
  for (const edge of flowData.edges) {
    adjacency.set(edge.source, edge.target);
  }

  const startNode = flowData.nodes.find(n => n.data.type === 'start');
  if (!startNode) return [];

  const result: WorkflowNodeConfig[] = [];
  let currentId: string | undefined = startNode.id;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodeMap.get(currentId);
    if (!node) break;
    result.push(node.data);
    currentId = adjacency.get(currentId);
  }

  return result;
}
