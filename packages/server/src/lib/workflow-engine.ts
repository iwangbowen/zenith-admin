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
 * - delay / trigger / subProcess —— 当前作为非阻塞自动节点（占位实现），P2 由调度器接管
 */
import type {
  WorkflowFlowData,
  WorkflowNodeConfig,
  WorkflowEdge,
  WorkflowEdgeCondition,
  WorkflowConditionGroup,
} from '@zenith/shared';

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
    const out = outEdges.get(edge.source) ?? [];
    out.push({ target: edge.target, edge });
    outEdges.set(edge.source, out);

    const ins = inEdges.get(edge.target) ?? [];
    ins.push(edge.source);
    inEdges.set(edge.target, ins);
  }

  return { nodeMap, outEdges, inEdges };
}

/** 求值条件表达式 */
export function evaluateCondition(
  condition: WorkflowEdgeCondition,
  formData: Record<string, unknown>,
): boolean {
  const fieldValue = formData[condition.field];
  const target = condition.value;

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
    case 'in': {
      if (typeof target === 'string') {
        const arr = target.split(',').map(s => s.trim());
        return arr.includes(String(fv ?? ''));
      }
      return false;
    }
    case 'contains':
      return typeof fv === 'string' && fv.includes(String(target));
    default:
      return false;
  }
}

export function evaluateConditionGroup(
  group: WorkflowConditionGroup,
  formData: Record<string, unknown>,
): boolean {
  if (group.rules.length === 0) return false;
  if (group.type === 'or') {
    return group.rules.some((rule) => evaluateCondition(rule, formData));
  }
  return group.rules.every((rule) => evaluateCondition(rule, formData));
}

export function evaluateConditionGroups(
  groups: WorkflowConditionGroup[],
  formData: Record<string, unknown>,
): boolean {
  if (groups.length === 0) return false;
  return groups.some((group) => evaluateConditionGroup(group, formData));
}

function edgeHasCondition(edge: WorkflowEdge): boolean {
  return !!edge.condition || !!edge.conditions?.length;
}

function edgeMatchesCondition(edge: WorkflowEdge, formData: Record<string, unknown>): boolean {
  if (edge.conditions?.length) return evaluateConditionGroups(edge.conditions, formData);
  if (edge.condition) return evaluateCondition(edge.condition, formData);
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
          if (edgeMatchesCondition(edge, formData)) { chosen = target; break; }
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
          if (edgeMatchesCondition(edge, formData)) { queue.push(target); matched++; }
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
          if (edgeMatchesCondition(edge, formData)) {
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
              if (edgeMatchesCondition(edge, formData)) {
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
          ? computeReachableNodeIds(flowData, formData)
          : null;
        const allCompleted = inSources.every(srcId => {
          if (reachable && !reachable.has(srcId)) return true; // 未激活分支，视为已完成
          const srcNode = nodeMap.get(srcId);
          return srcNode ? completedNodeKeys.has(srcNode.data.key) : true;
        });

        if (allCompleted) {
          for (const { target } of outs) enqueueNext(target, queue);
        }
        // 否则不推进，等待其他分支完成
      }
    } else if (nodeType === 'ccNode') {
      // 抄送节点：创建抄送任务（自动完成），继续推进
      if (node.data.assigneeIds?.length) {
        for (const ccId of node.data.assigneeIds) {
          tasksToCreate.push({
            nodeKey: node.data.key,
            nodeName: node.data.label,
            nodeType: 'ccNode',
            assigneeId: ccId,
            nodeConfig: node.data,
          });
        }
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
): AdvanceResult {
  const startNode = flowData.nodes.find(n => n.data.type === 'start');
  if (!startNode) {
    return { finished: false, rejected: false, tasksToCreate: [], currentNodeKeys: [] };
  }
  return advanceFlow(flowData, startNode.data.key, formData, new Set(['start']));
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

  // 检查排他/路由网关出边是否配置了条件
  const { nodeMap, outEdges } = buildAdjacency(flowData);
  for (const node of flowData.nodes) {
    if (node.data.type === 'exclusiveGateway' || node.data.type === 'routeGateway') {
      const outs = outEdges.get(node.id) ?? [];
      if (outs.length < 2) {
        errors.push(`排他/路由网关"${node.data.label}"至少需要2条出边`);
      }
      const hasCondition = outs.some(o => edgeHasCondition(o.edge));
      if (!hasCondition && outs.length > 1) {
        errors.push(`排他/路由网关"${node.data.label}"的出边需要配置条件`);
      }
      const hasDefault = outs.some(o => isDefaultEdge(o.edge, nodeMap.get(o.target)));
      if (!hasDefault && outs.length > 1) {
        errors.push(`排他/路由网关"${node.data.label}"需要保留一个默认分支`);
      }
    }
    if (node.data.type === 'parallelGateway' || node.data.type === 'inclusiveGateway') {
      const outs = outEdges.get(node.id) ?? [];
      if (outs.length === 0) {
        errors.push(`并行/包容网关"${node.data.label}"缺少出边`);
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
