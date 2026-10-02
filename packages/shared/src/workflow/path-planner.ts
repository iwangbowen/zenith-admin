import { computeWorkflowDerivedValues } from './form-derived-values';
import { workflowEdgeConditionState, workflowEdgeHasCondition, type WorkflowConditionResult, type WorkflowConditionStateContext, type WorkflowConditionStatus } from './conditions';
import type { WorkflowEdge, WorkflowFlowData, WorkflowFormField, WorkflowNodeConfig, WorkflowStarterContext } from './types';

export type WorkflowPathNode = {
  nodeId: string;
  nodeKey: string;
  nodeName: string;
  nodeType: WorkflowNodeConfig['type'];
  status: WorkflowConditionStatus;
  reason: string;
};
export type WorkflowPathEdge = WorkflowConditionResult & { edgeId: string; source: string; target: string };
export type WorkflowPathBranch = WorkflowPathEdge & { gatewayKey: string; label: string | null; priority: number; isDefault: boolean };
export type WorkflowPathPlan = {
  nodes: WorkflowPathNode[];
  edges: WorkflowPathEdge[];
  branches: WorkflowPathBranch[];
  /** A copy only when explicitly deriving a draft. A submitted snapshot is never changed in place. */
  formData: Readonly<Record<string, unknown>>;
  truncated: boolean;
};
export type WorkflowPathPlanOptions = {
  formData?: Readonly<Record<string, unknown>>;
  formFields?: WorkflowFormField[];
  starter?: WorkflowStarterContext;
  now?: string | number | Date;
  /** Omit for a launch preview; pass the actual frontier for a remaining-path prediction. */
  activeNodeKeys?: readonly string[];
  completedNodeKeys?: readonly string[];
  unknownFields?: Readonly<Record<string, string>>;
  /** Launch/draft callers may recompute derived inputs; historical/snapshot callers leave this false. */
  recomputeDerivedValues?: boolean;
};

type UnknownFields = Record<string, string>;
type FlowNode = WorkflowFlowData['nodes'][number];
type FieldMeta = { fields: Map<string, WorkflowFormField>; dependencies: Map<string, string[]>; labels: Record<string, string>; required: Set<string> };
const rootKey = (key: string) => key.split(/[.[]/, 1)[0];
const empty = (value: unknown) => value == null || value === '' || (Array.isArray(value) && !value.length);
const statesRank: Record<WorkflowConditionStatus, number> = { excluded: 0, unknown: 1, matched: 2 };

function fieldMetadata(fields: WorkflowFormField[]): FieldMeta {
  const metadata: FieldMeta = { fields: new Map(), dependencies: new Map(), labels: {}, required: new Set() };
  const walk = (items: WorkflowFormField[], prefix = '') => {
    for (const field of items) {
      const key = prefix + field.key;
      metadata.fields.set(key, field); metadata.labels[key] = field.label;
      if (field.required) metadata.required.add(key);
      if (field.formula?.trim() && (field.type === 'formula' || prefix !== '')) {
        metadata.dependencies.set(key, [...field.formula.matchAll(/\{([^}]+)\}/g)].map(match => prefix + match[1].trim()));
      } else if (field.daysFromKey) metadata.dependencies.set(key, [prefix + field.daysFromKey]);
      if (field.type === 'row') for (const column of field.columns ?? []) walk(column.fields, prefix);
      else if (field.type === 'tabs' || field.type === 'steps') for (const pane of field.panes ?? []) walk(pane.fields, prefix);
      else if (field.type === 'group') walk(field.children ?? [], prefix);
      else if (field.type === 'detail') walk(field.children ?? [], key + '.');
    }
  };
  walk(fields); return metadata;
}

function valuesAtPath(values: Readonly<Record<string, unknown>>, key: string): unknown[] {
  let current: unknown[] = [values];
  for (const part of key.split('.')) {
    current = current.flatMap(value => Array.isArray(value)
      ? value.map(row => row && typeof row === 'object' ? (row as Record<string, unknown>)[part] : undefined)
      : [value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined]);
  }
  return current;
}

function mergeUnknown(target: UnknownFields, source: Readonly<UnknownFields>): void {
  for (const [key, reason] of Object.entries(source)) if (!(key in target)) target[key] = reason;
}

function expandDependencies(unknown: UnknownFields, metadata: FieldMeta): UnknownFields {
  const out = { ...unknown };
  for (let pass = 0; pass <= metadata.dependencies.size; pass++) {
    let changed = false;
    for (const [field, refs] of metadata.dependencies) {
      if (out[field]) continue;
      const cause = refs.find(ref => out[ref] || out[rootKey(ref)]);
      if (cause) { out[field] = `「${metadata.labels[field] ?? field}」依赖尚不确定的「${metadata.labels[cause] ?? metadata.labels[rootKey(cause)] ?? cause}」`; changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

function missingInputs(values: Readonly<Record<string, unknown>>, metadata: FieldMeta): UnknownFields {
  const unknown: UnknownFields = {};
  for (const key of metadata.required) {
    const field = metadata.fields.get(key);
    // A child of an optional, empty detail is not a missing required root input.
    if (key.includes('.') && !Array.isArray(values[rootKey(key)])) continue;
    const found = valuesAtPath(values, key);
    if (found.some(empty) || (!key.includes('.') && !found.length)) unknown[key] = `「${field?.label ?? key}」尚未填写`;
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (key: string) => {
    if (visited.has(key)) return;
    if (visiting.has(key)) { unknown[key] = `「${metadata.labels[key] ?? key}」的计算依赖存在循环`; return; }
    visiting.add(key);
    const field = metadata.fields.get(key);
    for (const ref of metadata.dependencies.get(key) ?? []) {
      visit(ref);
      const source = valuesAtPath(values, ref);
      if (unknown[ref] || unknown[rootKey(ref)] || !source.length || source.some(empty)) {
        unknown[key] = `「${field?.label ?? key}」依赖未填写或尚不确定的「${metadata.labels[ref] ?? metadata.labels[rootKey(ref)] ?? ref}」`;
      }
      if (field?.daysFromKey && source.some(value => !Array.isArray(value) || value.length !== 2 || value.some(empty) || computeWorkflowDerivedValues([field], { [field.daysFromKey!]: value })[field.key] === undefined)) {
        unknown[key] = `「${field.label}」需要完整的「${metadata.labels[ref] ?? ref}」`;
      }
    }
    visiting.delete(key); visited.add(key);
  };
  for (const key of metadata.dependencies.keys()) visit(key);
  return expandDependencies(unknown, metadata);
}

function futureInputs(node: WorkflowNodeConfig, current: UnknownFields, metadata: FieldMeta, completed: ReadonlySet<string>): UnknownFields {
  const unknown = { ...current };
  if (completed.has(node.key)) return unknown;
  if ((node.type === 'approve' || node.type === 'handler') && node.approvalType !== 'autoApprove' && node.approveMethod !== 'auto') {
    for (const [field, permission] of Object.entries(node.fieldPermissions ?? {})) if (permission === 'edit') {
      unknown[field] = `后续「${node.label}」可修改「${metadata.labels[field] ?? field}」，需处理后才能确定`;
    }
  }
  if (node.type === 'trigger') {
    const config = node.triggerConfig;
    const fields = [...(config?.fieldKeys ?? []), ...Object.keys(config?.fieldValues ?? {})];
    if (fields.length && (config?.triggerType === 'updateData' || config?.triggerType === 'deleteData')) {
      for (const field of fields) unknown[field] = `「${node.label}」的字段更新尚未执行`;
    } else unknown['*'] = `「${node.label}」的处理结果尚未产生`;
  }
  if (node.type === 'routeGateway' && node.decisionRuleKey) unknown['*'] = `「${node.label}」的决策结果尚未产生`;
  if (node.type === 'subProcess') for (const field of Object.keys(node.subProcessOutputMapping ?? {})) unknown[field] = `「${node.label}」的子流程结果尚未产生`;
  return expandDependencies(unknown, metadata);
}

/** Gateway selection preserves the runtime edge order (branch priority) and normal-edge fallback semantics. */
export function selectWorkflowPathBranches(node: WorkflowNodeConfig, edges: readonly WorkflowEdge[], context: WorkflowConditionStateContext): WorkflowConditionResult[] {
  const condition = (edge: WorkflowEdge) => workflowEdgeConditionState(edge, context);
  if (node.type === 'exclusiveGateway' || node.type === 'routeGateway') {
    let earlierUnknown = false, certainCandidate = false;
    const firstDefault = edges.findIndex(edge => !workflowEdgeHasCondition(edge));
    const selected = edges.map(edge => {
      if (!workflowEdgeHasCondition(edge)) return { status: 'excluded' as const, reason: '未使用的默认分支' };
      if (certainCandidate) return { status: 'excluded' as const, reason: '前面已有成立的优先分支' };
      const result = condition(edge);
      if (result.status === 'excluded') return result;
      if (result.status === 'unknown') { earlierUnknown = true; return result; }
      certainCandidate = true;
      return earlierUnknown ? { status: 'unknown' as const, reason: '前面的优先分支尚不确定' } : result;
    });
    if (firstDefault >= 0) selected[firstDefault] = certainCandidate
      ? { status: 'excluded', reason: '已有成立的条件分支' }
      : earlierUnknown ? { status: 'unknown', reason: '条件尚不确定，暂不能确定默认分支' }
        : { status: 'matched', reason: '所有条件均不成立，使用默认分支' };
    return selected;
  }
  if (node.type === 'inclusiveGateway' && edges.length > 1) {
    const selected = edges.map(edge => workflowEdgeHasCondition(edge) ? condition(edge) : { status: 'excluded' as const, reason: '未使用的默认分支' });
    const conditional = selected.filter((_, index) => workflowEdgeHasCondition(edges[index]));
    // The existing inclusive engine takes the last unconditional fallback; valid designer graphs have one.
    const fallback = edges.reduce((last, edge, index) => !workflowEdgeHasCondition(edge) ? index : last, -1);
    if (fallback >= 0) selected[fallback] = conditional.some(result => result.status === 'matched')
      ? { status: 'excluded', reason: '已有成立的条件分支' }
      : conditional.some(result => result.status === 'unknown') ? { status: 'unknown', reason: '条件尚不确定，暂不能确定默认分支' }
        : { status: 'matched', reason: '所有条件均不成立，使用默认分支' };
    return selected;
  }
  return edges.map(() => ({ status: 'matched', reason: node.type === 'parallelGateway' ? '并行分支均需经过' : '正常后续路径' }));
}

/**
 * Predict normal graph reachability, never execute a decision/trigger/random assignment or create tasks.
 * Multiple passes merge future input uncertainty at joins; this prevents an untouched sibling from making
 * a condition after a parallel editable branch appear certain. Each pass visits node/status once.
 */
export function planWorkflowPath(flow: WorkflowFlowData, options: WorkflowPathPlanOptions = {}): WorkflowPathPlan {
  const metadata = fieldMetadata(options.formFields ?? []);
  const formData = options.recomputeDerivedValues && options.formFields
    ? computeWorkflowDerivedValues(options.formFields, { ...(options.formData ?? {}) }) : options.formData ?? {};
  const baseUnknown = expandDependencies({ ...missingInputs(formData, metadata), ...options.unknownFields }, metadata);
  const nodeMap = new Map(flow.nodes.map(node => [node.id, node]));
  const byKey = new Map(flow.nodes.map(node => [node.data.key, node]));
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of flow.edges) {
    if (edge.isException || nodeMap.get(edge.target)?.data.type === 'catchNode') continue;
    if (!nodeMap.has(edge.target) || !nodeMap.has(edge.source)) continue;
    const list = outgoing.get(edge.source) ?? []; list.push(edge); outgoing.set(edge.source, list);
  }
  const roots = options.activeNodeKeys !== undefined
    ? options.activeNodeKeys.map(key => byKey.get(key)).filter((node): node is FlowNode => !!node)
    : flow.nodes.filter(node => node.data.type === 'start');
  const completed = new Set(options.completedNodeKeys ?? []);
  const knownUnknown = new Map<string, UnknownFields>();
  let result: WorkflowPathPlan = { nodes: [], edges: [], branches: [], formData, truncated: false };
  const maxPasses = Math.max(1, flow.nodes.length + 1);
  for (let pass = 0; pass < maxPasses; pass++) {
    const nodes = new Map(flow.nodes.map(node => [node.id, { nodeId: node.id, nodeKey: node.data.key, nodeName: node.data.label, nodeType: node.data.type, status: 'excluded' as WorkflowConditionStatus, reason: completed.has(node.data.key) ? '已完成的前序节点' : '不在当前预测路径中' }]));
    const edges = new Map(flow.edges.map(edge => [edge.id, { edgeId: edge.id, source: edge.source, target: edge.target, status: 'excluded' as WorkflowConditionStatus, reason: edge.isException || nodeMap.get(edge.target)?.data.type === 'catchNode' ? '异常处理路径不参与正常审批预测' : '不在当前预测路径中' }]));
    const observed = new Map<string, UnknownFields>();
    const queue: Array<{ node: FlowNode; status: WorkflowConditionStatus; reason: string; unknown: UnknownFields }> = roots.map(node => ({ node, status: 'matched', reason: options.activeNodeKeys ? '当前活动节点' : '发起节点', unknown: baseUnknown }));
    const visited = new Set<string>();
    const visitOrder: string[] = [];
    const ordered = new Set<string>();
    for (let index = 0; index < queue.length; index++) {
      const arrival = queue[index], node = arrival.node;
      const unknown = { ...arrival.unknown }; mergeUnknown(unknown, knownUnknown.get(node.id) ?? {});
      const seenUnknown = observed.get(node.id) ?? {}; mergeUnknown(seenUnknown, unknown); observed.set(node.id, seenUnknown);
      if (!ordered.has(node.id)) { ordered.add(node.id); visitOrder.push(node.id); }
      const row = nodes.get(node.id)!;
      if (statesRank[arrival.status] > statesRank[row.status]) { row.status = arrival.status; row.reason = arrival.reason; }
      const visitKey = `${node.id}:${arrival.status}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);
      if (node.data.type === 'end' || node.data.type === 'catchNode') continue;
      if (node.data.approvalType === 'autoReject') continue;
      const future = futureInputs(node.data, unknown, metadata, completed);
      const outs = outgoing.get(node.id) ?? [];
      const selected = selectWorkflowPathBranches(node.data, outs, { formData, starter: options.starter, now: options.now, unknownFields: future, requiredFields: metadata.required, fieldLabels: metadata.labels });
      outs.forEach((edge, edgeIndex) => {
        const predicted = selected[edgeIndex];
        const status = predicted.status === 'excluded' ? 'excluded' : arrival.status === 'unknown' ? 'unknown' : predicted.status;
        const reason = status === 'unknown' && predicted.status === 'matched' ? arrival.reason : predicted.reason;
        const edgeRow = edges.get(edge.id)!;
        if (statesRank[status] > statesRank[edgeRow.status]) { edgeRow.status = status; edgeRow.reason = reason; }
        else if (status === 'excluded' && edgeRow.status === 'excluded') edgeRow.reason = reason;
        if (status !== 'excluded') queue.push({ node: nodeMap.get(edge.target)!, status, reason, unknown: future });
        else { const excludedNode = nodes.get(edge.target); if (excludedNode?.status === 'excluded') excludedNode.reason = reason; }
      });
    }
    const branches: WorkflowPathBranch[] = [];
    for (const node of flow.nodes) {
      if (!['exclusiveGateway', 'routeGateway', 'parallelGateway', 'inclusiveGateway'].includes(node.data.type)) continue;
      (outgoing.get(node.id) ?? []).forEach((edge, priority) => branches.push({ ...edges.get(edge.id)!, gatewayKey: node.data.key, label: edge.label ?? null, priority, isDefault: !workflowEdgeHasCondition(edge) && node.data.type !== 'parallelGateway' }));
    }
    result = { nodes: [...visitOrder.map(id => nodes.get(id)!), ...[...nodes.values()].filter(node => !ordered.has(node.nodeId))], edges: [...edges.values()], branches, formData, truncated: false };
    let changed = false;
    for (const [id, fields] of observed) {
      const previous = knownUnknown.get(id) ?? {};
      if (Object.keys(fields).some(key => !(key in previous))) changed = true;
      mergeUnknown(previous, fields); knownUnknown.set(id, previous);
    }
    if (!changed) return result;
  }
  result.truncated = true;
  for (const node of result.nodes) if (node.status !== 'excluded' && !roots.some(root => root.id === node.nodeId)) { node.status = 'unknown'; node.reason = '复杂回路的后续路径需运行时确认'; }
  for (const edge of result.edges) if (edge.status !== 'excluded') { edge.status = 'unknown'; edge.reason = '复杂回路的后续路径需运行时确认'; }
  for (const branch of result.branches) if (branch.status !== 'excluded') { branch.status = 'unknown'; branch.reason = '复杂回路的后续路径需运行时确认'; }
  return result;
}
