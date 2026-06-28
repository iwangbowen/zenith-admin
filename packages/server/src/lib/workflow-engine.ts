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
export function buildAdjacency(flowData: WorkflowFlowData) {
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

function isPrimitiveConditionValue(value: unknown): value is string | number | boolean | null | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value == null;
}

function parseTargetList(target: string | number | boolean): string[] {
  return typeof target === 'string'
    ? target.split(',').map((s) => s.trim()).filter(Boolean)
    : [String(target)];
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

  if (condition.operator === 'isEmpty' || condition.operator === 'isNotEmpty') {
    const empty = fieldValue == null
      || fieldValue === ''
      || (Array.isArray(fieldValue) && fieldValue.length === 0)
      || (typeof fieldValue === 'object' && fieldValue !== null && !Array.isArray(fieldValue) && Object.keys(fieldValue).length === 0);
    return condition.operator === 'isEmpty' ? empty : !empty;
  }

  if (Array.isArray(fieldValue)) {
    const values = fieldValue.filter(isPrimitiveConditionValue).map((v) => String(v ?? ''));
    if (condition.operator === 'contains') return values.includes(String(target));
    if (condition.operator === 'in' || condition.operator === 'notIn') {
      const targets = parseTargetList(target);
      const hit = values.some((value) => targets.includes(value));
      return condition.operator === 'notIn' ? !hit : hit;
    }
    return false;
  }

  if (!isPrimitiveConditionValue(fieldValue)) return false;
  const fv = fieldValue;

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
      const arr = parseTargetList(target);
      const inList = arr.includes(String(fv ?? ''));
      return condition.operator === 'notIn' ? !inList : inList;
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

export function edgeHasCondition(edge: WorkflowEdge): boolean {
  return !!edge.condition || !!edge.conditions?.length;
}

export function edgeMatchesCondition(
  edge: WorkflowEdge,
  formData: Record<string, unknown>,
  starter?: WorkflowStarterContext,
): boolean {
  if (edge.conditions?.length) return evaluateConditionGroups(edge.conditions, formData, starter);
  if (edge.condition) return evaluateCondition(edge.condition, formData, starter);
  return false;
}

export function isDefaultEdge(edge: WorkflowEdge, targetNode?: FlowNode): boolean {
  return !!edge.isDefault || !!targetNode?.data.isDefault || !edgeHasCondition(edge);
}

// ─── 引擎核心 ─────────────────────────────────────────────────────────────────

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
 * 计算某节点的全部上游祖先节点 key（沿正常入边反向 BFS；不含自身、不含异常边）。
 * 用于「退回上一步」等需要"仅在当前路径的上游中选择目标"的场景。
 */
export function getAncestorNodeKeys(flowData: WorkflowFlowData, nodeKey: string): Set<string> {
  const { nodeMap, inEdges } = buildAdjacency(flowData);
  const startNode = flowData.nodes.find((n) => n.data.key === nodeKey);
  const ancestors = new Set<string>();
  if (!startNode) return ancestors;
  const queue: string[] = [...(inEdges.get(startNode.id) ?? [])];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const node = nodeMap.get(id);
    if (node) ancestors.add(node.data.key);
    for (const p of inEdges.get(id) ?? []) queue.push(p);
  }
  return ancestors;
}

/**
 * 「退回上一步」目标选择：在按时间倒序排列的已审批 approve/handler 节点 key 中，
 * 优先选当前节点的最近上游祖先（避免并行流程里误选到另一条分支上最近审批的节点）；
 * 若无任何祖先匹配则回退为最近审批节点（兼容线性流程旧行为）。
 */
export function findReturnPrevTarget(
  flowData: WorkflowFlowData,
  currentNodeKey: string,
  approvedApproveNodeKeysByRecency: string[],
): string | null {
  if (approvedApproveNodeKeysByRecency.length === 0) return null;
  const ancestors = getAncestorNodeKeys(flowData, currentNodeKey);
  const ancestorMatch = approvedApproveNodeKeysByRecency.find((k) => ancestors.has(k));
  return ancestorMatch ?? approvedApproveNodeKeysByRecency[0];
}

/**
 * 校验流程定义的有效性
 */
export function validateFlowData(flowData: WorkflowFlowData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!flowData || typeof flowData !== 'object') {
    return { valid: false, errors: ['流程数据格式错误'] };
  }
  if (!Array.isArray(flowData.nodes)) {
    errors.push('流程节点数据格式错误');
  }
  if (!Array.isArray(flowData.edges)) {
    errors.push('流程连线数据格式错误');
  }
  if (errors.length > 0) return { valid: false, errors };

  const validNodeTypes = new Set<WorkflowNodeConfig['type']>([
    'start',
    'approve',
    'handler',
    'end',
    'exclusiveGateway',
    'parallelGateway',
    'inclusiveGateway',
    'routeGateway',
    'ccNode',
    'delay',
    'trigger',
    'subProcess',
    'catchNode',
  ]);

  const nodeIdSet = new Set<string>();
  const nodeKeySet = new Set<string>();
  const nodeMapById = new Map<string, FlowNode>();

  for (const node of flowData.nodes) {
    const nodeId = typeof node.id === 'string' ? node.id.trim() : '';
    const nodeKey = typeof node.data?.key === 'string' ? node.data.key.trim() : '';
    const nodeLabel = typeof node.data?.label === 'string' ? node.data.label.trim() : '';
    const display = nodeLabel || nodeKey || nodeId || '未命名节点';

    if (!nodeId) {
      errors.push(`节点"${display}"缺少节点 ID`);
    } else if (nodeIdSet.has(nodeId)) {
      errors.push(`节点 ID"${nodeId}"重复`);
    } else {
      nodeIdSet.add(nodeId);
      nodeMapById.set(nodeId, { id: nodeId, data: node.data });
    }

    if (!nodeKey) {
      errors.push(`节点"${display}"缺少节点标识`);
    } else if (nodeKeySet.has(nodeKey)) {
      errors.push(`节点标识"${nodeKey}"重复`);
    } else {
      nodeKeySet.add(nodeKey);
    }

    if (!nodeLabel) {
      errors.push(`节点"${nodeKey || nodeId || '未命名节点'}"缺少节点名称`);
    }

    if (!validNodeTypes.has(node.data?.type)) {
      errors.push(`节点"${display}"类型无效`);
    }
  }

  const edgeIdSet = new Set<string>();
  const normalInEdges = new Map<string, WorkflowEdge[]>();
  const normalOutEdges = new Map<string, WorkflowEdge[]>();
  const exceptionInEdges = new Map<string, WorkflowEdge[]>();

  for (const edge of flowData.edges) {
    const edgeId = typeof edge.id === 'string' ? edge.id.trim() : '';
    const source = typeof edge.source === 'string' ? edge.source.trim() : '';
    const target = typeof edge.target === 'string' ? edge.target.trim() : '';
    const display = edgeId || `${source || '?'} -> ${target || '?'}`;

    if (!edgeId) {
      errors.push(`连线"${display}"缺少连线 ID`);
    } else if (edgeIdSet.has(edgeId)) {
      errors.push(`连线 ID"${edgeId}"重复`);
    } else {
      edgeIdSet.add(edgeId);
    }

    const sourceNode = source ? nodeMapById.get(source) : undefined;
    const targetNode = target ? nodeMapById.get(target) : undefined;
    if (!source) {
      errors.push(`连线"${display}"缺少起点`);
    } else if (!sourceNode) {
      errors.push(`连线"${display}"的起点节点不存在`);
    }
    if (!target) {
      errors.push(`连线"${display}"缺少终点`);
    } else if (!targetNode) {
      errors.push(`连线"${display}"的终点节点不存在`);
    }

    if (!sourceNode || !targetNode) continue;

    const isExceptionEdge = !!edge.isException || targetNode.data.type === 'catchNode';
    if (isExceptionEdge) {
      const ins = exceptionInEdges.get(targetNode.id) ?? [];
      ins.push(edge);
      exceptionInEdges.set(targetNode.id, ins);
      continue;
    }

    const outs = normalOutEdges.get(sourceNode.id) ?? [];
    outs.push(edge);
    normalOutEdges.set(sourceNode.id, outs);
    const ins = normalInEdges.get(targetNode.id) ?? [];
    ins.push(edge);
    normalInEdges.set(targetNode.id, ins);
  }

  const startNodes = flowData.nodes.filter(n => n.data.type === 'start');
  if (startNodes.length === 0) errors.push('流程缺少开始节点');
  if (startNodes.length > 1) errors.push('流程只能有一个开始节点');

  const endNodes = flowData.nodes.filter(n => n.data.type === 'end');
  if (endNodes.length === 0) errors.push('流程缺少结束节点');

  const approveNodes = flowData.nodes.filter(n => n.data.type === 'approve' || n.data.type === 'handler');
  if (approveNodes.length === 0) errors.push('流程至少需要一个审批/办理节点');

  // 检查条件型网关（排他/路由/包容）出边的条件与默认分支配置
  const { nodeMap, outEdges, inEdges } = buildAdjacency(flowData);
  for (const node of flowData.nodes) {
    const gwType = node.data.type;
    const normalIn = normalInEdges.get(node.id) ?? [];
    const normalOut = normalOutEdges.get(node.id) ?? [];
    const exceptionIn = exceptionInEdges.get(node.id) ?? [];
    const isGateway = gwType === 'exclusiveGateway'
      || gwType === 'routeGateway'
      || gwType === 'inclusiveGateway'
      || gwType === 'parallelGateway';

    if (gwType === 'start') {
      if (normalIn.length > 0) errors.push(`开始节点"${node.data.label}"不应有入边`);
      if (normalOut.length === 0) errors.push(`开始节点"${node.data.label}"缺少出边`);
    } else if (gwType === 'end') {
      if (normalIn.length === 0) errors.push(`结束节点"${node.data.label}"缺少入边`);
      if (normalOut.length > 0) errors.push(`结束节点"${node.data.label}"不应有出边`);
    } else if (gwType === 'catchNode') {
      if (exceptionIn.length === 0) errors.push(`异常捕获节点"${node.data.label}"缺少异常入边`);
      const catchAction = node.data.catchAction ?? 'notify';
      if (catchAction !== 'terminate' && normalOut.length === 0) {
        errors.push(`异常捕获节点"${node.data.label}"缺少恢复出边`);
      }
    } else {
      if (normalIn.length === 0) errors.push(`节点"${node.data.label}"缺少入边`);
      if (!isGateway && normalOut.length === 0) errors.push(`节点"${node.data.label}"缺少出边`);
    }

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

  // 检查所有节点是否可达；catchNode 从异常边触达，其后恢复路径按正常出边继续。
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
    const exceptionVisited = new Set<string>();
    const exceptionQueue = flowData.nodes
      .filter((node) => node.data.type === 'catchNode' && (exceptionInEdges.get(node.id)?.length ?? 0) > 0)
      .map((node) => node.id);
    while (exceptionQueue.length > 0) {
      const id = exceptionQueue.shift();
      if (!id || exceptionVisited.has(id)) continue;
      exceptionVisited.add(id);
      const outs = normalOutEdges.get(id) ?? [];
      for (const edge of outs) {
        exceptionQueue.push(edge.target.trim());
      }
    }
    for (const node of flowData.nodes) {
      if (!visited.has(node.id) && !exceptionVisited.has(node.id)) {
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
