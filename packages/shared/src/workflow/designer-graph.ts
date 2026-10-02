import type { WorkflowConditionGroup, WorkflowEdge, WorkflowFlowData, WorkflowNodeConfig } from './types';

type GraphNode = WorkflowFlowData['nodes'][number];

/** An editing projection. It is never persisted alongside the authoritative graph. */
export type WorkflowDesignerNodeType = 'initiator' | 'approver' | 'handler' | 'cc' | 'delay' | 'trigger' | 'subProcess'
  | 'conditionBranch' | 'parallelBranch' | 'inclusiveBranch' | 'routeBranch';

export interface WorkflowDesignerBranch {
  id: string;
  name: string;
  priority?: number;
  conditions?: WorkflowConditionGroup[];
  caseValue?: string;
  isDefault?: boolean;
  children?: WorkflowDesignerNode;
  /** Original edge identity and metadata, including an empty branch's edge. */
  graphEdge?: WorkflowEdge;
  graphDisplayName?: string;
}

export interface WorkflowDesignerNode {
  id: string;
  key?: string;
  type: WorkflowDesignerNodeType;
  name: string;
  props: Record<string, unknown>;
  children?: WorkflowDesignerNode;
  branches?: WorkflowDesignerBranch[];
  graphNode?: GraphNode;
  /** null means that branches merge directly at children (or the end node). */
  graphJoin?: GraphNode | null;
}

export interface WorkflowDesignerProcess {
  initiator: WorkflowDesignerNode;
  graphEnd?: GraphNode;
  graphEdges?: WorkflowEdge[];
  graphNodeOrder?: string[];
  settings?: WorkflowFlowData['settings'];
}

export type WorkflowGraphProjection =
  | { kind: 'tree'; process: WorkflowDesignerProcess }
  | { kind: 'graph'; reason: string };

const GRAPH_TO_EDITOR: Partial<Record<WorkflowNodeConfig['type'], WorkflowDesignerNodeType>> = {
  start: 'initiator', approve: 'approver', handler: 'handler', ccNode: 'cc', delay: 'delay', trigger: 'trigger', subProcess: 'subProcess',
  exclusiveGateway: 'conditionBranch', parallelGateway: 'parallelBranch', inclusiveGateway: 'inclusiveBranch', routeGateway: 'routeBranch',
};
const EDITOR_TO_GRAPH: Record<WorkflowDesignerNodeType, WorkflowNodeConfig['type']> = {
  initiator: 'start', approver: 'approve', handler: 'handler', cc: 'ccNode', delay: 'delay', trigger: 'trigger', subProcess: 'subProcess',
  conditionBranch: 'exclusiveGateway', parallelBranch: 'parallelGateway', inclusiveBranch: 'inclusiveGateway', routeBranch: 'routeGateway',
};
const GATEWAYS = new Set(['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'routeGateway']);

class ProjectionUnavailable extends Error {}

function editorNode(node: GraphNode): WorkflowDesignerNode {
  const type = GRAPH_TO_EDITOR[node.data.type];
  if (!type) throw new ProjectionUnavailable(`节点「${node.data.label}」需要图模式编辑`);
  const { key, type: _type, label, ...props } = node.data;
  return { id: node.id, key, type, name: label, props: structuredClone(props), graphNode: structuredClone(node) };
}

/**
 * Recognizes a structured editing projection without restricting the graph contract.
 * Cycles, exception edges, shared branch interiors and unsupported joins remain valid
 * graph-mode definitions. They are never converted into an empty or partial tree.
 */
export function projectWorkflowGraph(graph: WorkflowFlowData): WorkflowGraphProjection {
  try {
    if (graph.edges.some((edge) => edge.isException) || graph.nodes.some((node) => node.data.type === 'catchNode')) {
      return { kind: 'graph', reason: '此流程包含异常路径，请使用流程图或 JSON 编辑' };
    }
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    if (nodes.size !== graph.nodes.length || new Set(graph.nodes.map((node) => node.data.key)).size !== nodes.size) {
      throw new ProjectionUnavailable('节点 ID 或业务标识重复，无法生成树投影');
    }
    const starts = graph.nodes.filter((node) => node.data.type === 'start');
    const ends = graph.nodes.filter((node) => node.data.type === 'end');
    if (starts.length !== 1 || ends.length !== 1) throw new ProjectionUnavailable('树投影需要一个开始节点和一个结束节点');
    const start = starts[0];
    const end = ends[0];
    const outgoing = new Map<string, WorkflowEdge[]>();
    const indegrees = new Map(graph.nodes.map((node) => [node.id, 0]));
    for (const edge of graph.edges) {
      if (!nodes.has(edge.source) || !nodes.has(edge.target)) throw new ProjectionUnavailable('连线引用了不存在的节点');
      const edges = outgoing.get(edge.source) ?? [];
      edges.push(edge);
      outgoing.set(edge.source, edges);
      indegrees.set(edge.target, (indegrees.get(edge.target) ?? 0) + 1);
    }
    if ((outgoing.get(start.id)?.length ?? 0) !== 1 || outgoing.has(end.id)) {
      throw new ProjectionUnavailable('开始或结束节点结构需要图模式编辑');
    }
    // Topological sorting applies only to projection eligibility. A cyclic graph is not invalidated.
    const ready = graph.nodes.filter((node) => indegrees.get(node.id) === 0).map((node) => node.id);
    const order: string[] = [];
    for (let index = 0; index < ready.length; index++) {
      const id = ready[index];
      order.push(id);
      for (const edge of outgoing.get(id) ?? []) {
        const degree = (indegrees.get(edge.target) ?? 0) - 1;
        indegrees.set(edge.target, degree);
        if (degree === 0) ready.push(edge.target);
      }
    }
    if (order.length !== nodes.size) return { kind: 'graph', reason: '此流程包含回边或循环，请使用流程图或 JSON 编辑' };

    const postdominators = new Map<string, Set<string>>();
    for (const id of [...order].reverse()) {
      const successors = (outgoing.get(id) ?? []).map((edge) => edge.target);
      if (!successors.length) {
        if (id !== end.id) throw new ProjectionUnavailable('存在未连接结束节点的路径');
        postdominators.set(id, new Set([id]));
        continue;
      }
      const first = postdominators.get(successors[0])!;
      const common = [...first].filter((candidate) => successors.every((next) => postdominators.get(next)?.has(candidate)));
      postdominators.set(id, new Set([id, ...common]));
    }
    const orderIndex = new Map(order.map((id, index) => [id, index]));
    const consumed = new Set([start.id, end.id]);
    const parseChain = (firstId: string, stopId: string): WorkflowDesignerNode | undefined => {
      let id = firstId;
      let head: WorkflowDesignerNode | undefined;
      let tail: WorkflowDesignerNode | undefined;
      while (id !== stopId) {
        if (id === end.id || consumed.has(id)) throw new ProjectionUnavailable('分支存在交叉或共享内部节点，请使用图模式编辑');
        consumed.add(id);
        const source = nodes.get(id)!;
        const edges = outgoing.get(id) ?? [];
        const projected = editorNode(source);
        if (!head) head = projected;
        if (tail) tail.children = projected;
        tail = projected;
        if (edges.length > 1) {
          if (!GATEWAYS.has(source.data.type)) throw new ProjectionUnavailable('非网关节点具有多个出口，请使用图模式编辑');
          const candidates = [...(postdominators.get(id) ?? [])].filter((candidate) => candidate !== id);
          candidates.sort((a, b) => orderIndex.get(a)! - orderIndex.get(b)!);
          const joinId = candidates[0];
          if (!joinId || !postdominators.get(id)?.has(stopId)) throw new ProjectionUnavailable('分支无法在同一边界汇聚');
          let routeField: string | undefined;
          if (source.data.type === 'routeGateway') {
            for (const edge of edges) {
              if (edge.isDefault) continue;
              const groups = edge.conditions ?? (edge.condition ? [{ type: 'and' as const, rules: [edge.condition] }] : []);
              const rule = groups[0]?.rules[0];
              if (groups.length !== 1 || groups[0].rules.length !== 1 || rule?.operator !== 'eq' || rule.source === 'starter' || rule.aggregate) {
                throw new ProjectionUnavailable('路由网关包含复杂条件，请使用流程图或 JSON 编辑');
              }
              if (routeField && routeField !== rule.field) throw new ProjectionUnavailable('路由网关使用多个判定字段，请使用图模式编辑');
              routeField = rule.field;
            }
            if (routeField) projected.props.routeFieldKey = routeField;
          }
          projected.branches = edges.map((edge, index) => ({
            id: edge.id,
            name: edge.label ?? `分支 ${index + 1}`,
            graphDisplayName: edge.label ?? `分支 ${index + 1}`,
            ...(routeField && !edge.isDefault ? { caseValue: String((edge.conditions?.[0]?.rules[0] ?? edge.condition)?.value) } : {}),
            priority: index,
            isDefault: edge.isDefault ?? false,
            conditions: edge.conditions ? structuredClone(edge.conditions) : edge.condition ? [{ type: 'and', rules: [structuredClone(edge.condition)] }] : undefined,
            children: parseChain(edge.target, joinId),
            graphEdge: structuredClone(edge),
          }));
          const join = nodes.get(joinId)!;
          const joinOuts = outgoing.get(joinId) ?? [];
          if (join.data.type === source.data.type && joinOuts.length === 1) {
            if (consumed.has(joinId)) throw new ProjectionUnavailable('汇聚节点被多个分支区域共享');
            consumed.add(joinId);
            projected.graphJoin = structuredClone(join);
            id = joinOuts[0].target;
          } else {
            projected.graphJoin = null;
            id = joinId;
          }
        } else {
          if (GATEWAYS.has(source.data.type)) throw new ProjectionUnavailable('非结构化网关需要图模式编辑');
          if (edges.length !== 1) throw new ProjectionUnavailable('节点缺少后续路径');
          id = edges[0].target;
        }
      }
      return head;
    };
    const initiator = editorNode(start);
    initiator.children = parseChain(outgoing.get(start.id)![0].target, end.id);
    if (consumed.size !== nodes.size) throw new ProjectionUnavailable('存在未包含在结构化流程中的节点');
    return { kind: 'tree', process: {
      initiator,
      graphEnd: structuredClone(end),
      graphEdges: structuredClone(graph.edges),
      graphNodeOrder: graph.nodes.map((node) => node.id),
      settings: graph.settings ? structuredClone(graph.settings) : undefined,
    } };
  } catch (error) {
    if (error instanceof ProjectionUnavailable) return { kind: 'graph', reason: error.message };
    throw error;
  }
}

function parseObject(value: unknown, label: string): unknown {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return undefined;
  try { return JSON.parse(value); } catch { throw new Error(`${label}必须是有效的 JSON`); }
}

/** Convert editor-only controls into canonical node properties. */
function compileProps(node: WorkflowDesignerNode): Record<string, unknown> {
  const props = structuredClone(node.props);
  if (node.type === 'trigger' && 'triggerType' in props) {
    const fields = ['triggerType', 'connectorId', 'webhookUrl', 'httpMethod', 'headers', 'bodyTemplate', 'fieldKeys', 'fieldValues', 'onFailure', 'maxRetries', 'timeoutMs', 'callbackSignMode', 'callbackSecret'];
    const trigger: Record<string, unknown> = { ...(props.triggerConfig as Record<string, unknown> | undefined) };
    for (const field of fields) {
      if (props[field] !== undefined) trigger[field] = field === 'headers' || field === 'fieldValues' ? parseObject(props[field], field) : props[field];
      delete props[field];
    }
    props.triggerConfig = trigger;
  }
  for (const field of ['subProcessFieldMapping', 'subProcessOutputMapping']) {
    if (field in props) props[field] = parseObject(props[field], field);
  }
  if (node.type === 'approver' && 'externalApprovalEnabled' in props) {
    if (props.externalApprovalEnabled) props.externalApproval = {
      enabled: true, url: props.externalApprovalUrl ?? '', secret: props.externalApprovalSecret ?? '',
      signMode: props.externalApprovalSignMode ?? 'hmacSha256', timeoutMs: props.externalApprovalTimeoutMs ?? 10000,
      fallbackStrategy: props.externalApprovalFallback ?? 'manual',
    };
    else delete props.externalApproval;
    for (const field of ['externalApprovalEnabled', 'externalApprovalUrl', 'externalApprovalSecret', 'externalApprovalSignMode', 'externalApprovalTimeoutMs', 'externalApprovalFallback']) delete props[field];
  }
  delete props.routeFieldKey;
  return props;
}

/** Compile an ephemeral tree projection back into the sole persisted graph. */
export function compileWorkflowTree(process: WorkflowDesignerProcess): WorkflowFlowData {
  const nodes: GraphNode[] = [];
  const edges: WorkflowEdge[] = [];
  const usedNodes = new Set<string>();
  const originalEdges = process.graphEdges ?? [];
  const idOf = (node: WorkflowDesignerNode) => node.graphNode?.id ?? (node.type === 'initiator' ? 'node-start' : `node-${node.id}`);
  const addNode = (node: WorkflowDesignerNode): string => {
    const id = idOf(node);
    if (usedNodes.has(id)) throw new Error(`节点 ID「${id}」重复`);
    usedNodes.add(id);
    nodes.push({
      id, type: node.graphNode?.type ?? 'workflowNode', position: structuredClone(node.graphNode?.position ?? { x: 0, y: 0 }),
      data: { ...compileProps(node), key: node.key ?? node.id, type: EDITOR_TO_GRAPH[node.type], label: node.name } as WorkflowNodeConfig,
    });
    return id;
  };
  const connect = (source: string, target: string, branch?: WorkflowDesignerBranch, parent?: WorkflowDesignerNode): void => {
    const previous = branch?.graphEdge ?? originalEdges.find((edge) => edge.source === source && edge.target === target);
    const edge: WorkflowEdge = previous ? { ...structuredClone(previous), source, target } : { id: `e-${source}-${target}${branch ? `-${branch.id}` : ''}`, source, target };
    if (branch) {
      if (previous?.label !== undefined || branch.name !== branch.graphDisplayName) edge.label = branch.name;
      if (branch.isDefault || previous?.isDefault !== undefined) edge.isDefault = !!branch.isDefault;
      let groups = branch.conditions;
      if (parent?.type === 'routeBranch' && !branch.isDefault && branch.caseValue !== undefined) {
        const field = parent.props.routeFieldKey;
        if (typeof field !== 'string' || !field) throw new Error('路由分支缺少路由字段');
        const originalRule = previous?.conditions?.[0]?.rules[0] ?? previous?.condition;
        const value = originalRule?.field === field && String(originalRule.value) === branch.caseValue ? originalRule.value : branch.caseValue;
        groups = [{ type: 'and', rules: [{ field, operator: 'eq', value }] }];
      }
      if (groups?.length) {
        if (previous?.condition && !previous.conditions && groups.length === 1 && groups[0].rules.length === 1) {
          edge.condition = structuredClone(groups[0].rules[0]);
        } else {
          edge.conditions = structuredClone(groups);
          delete edge.condition;
        }
      } else {
        delete edge.conditions;
        delete edge.condition;
      }
    }
    edges.push(edge);
  };
  const startId = addNode(process.initiator);
  const end = process.graphEnd ? structuredClone(process.graphEnd) : {
    id: 'node-end', type: 'workflowNode', position: { x: 0, y: 0 }, data: { key: 'end', type: 'end' as const, label: '结束' },
  };
  const compileChain = (node: WorkflowDesignerNode | undefined, previous: string | null, terminalId: string, branch?: WorkflowDesignerBranch, parent?: WorkflowDesignerNode): string => {
    if (!node) return previous ?? terminalId;
    const id = addNode(node);
    if (previous !== null) connect(previous, id, branch, parent);
    if (node.branches?.length) {
      const join = node.graphJoin === null ? null : node.graphJoin ? structuredClone(node.graphJoin) : {
        id: `gw-join-${node.id}`, type: 'workflowNode', position: { x: 0, y: 0 },
        data: { key: `join-${node.id}`, type: EDITOR_TO_GRAPH[node.type], label: `${node.name}（汇聚）` },
      };
      const joinId = join?.id ?? (node.children ? idOf(node.children) : terminalId);
      if (join) {
        if (usedNodes.has(join.id)) throw new Error(`汇聚节点 ID「${join.id}」重复`);
        usedNodes.add(join.id);
        nodes.push(join);
      }
      for (const childBranch of node.branches) {
        if (!childBranch.children) connect(id, joinId, childBranch, node);
        else {
          const tail = compileChain(childBranch.children, id, joinId, childBranch, node);
          if (tail !== joinId) connect(tail, joinId);
        }
      }
      if (join) return compileChain(node.children, joinId, terminalId);
      return node.children ? compileChain(node.children, null, terminalId) : terminalId;
    }
    return compileChain(node.children, id, terminalId);
  };
  const tail = compileChain(process.initiator.children, startId, end.id);
  if (tail !== end.id) connect(tail, end.id);
  if (usedNodes.has(end.id)) throw new Error(`结束节点 ID「${end.id}」重复`);
  nodes.push(end);
  const originalOrder = new Map((process.graphNodeOrder ?? []).map((id, index) => [id, index]));
  if (originalOrder.size) nodes.sort((a, b) => (originalOrder.get(a.id) ?? originalOrder.size) - (originalOrder.get(b.id) ?? originalOrder.size));
  return { nodes, edges, ...(process.settings ? { settings: structuredClone(process.settings) } : {}) };
}
