/**
 * 版本 diff 细化：对比两份 flowData，输出节点增删改（含字段级变化）与连线/条件变化。
 * 节点按 data.key 稳定匹配；连线按 sourceKey->targetKey 匹配（节点 id 可能跨版本变化）。
 */
import type {
  WorkflowEdge,
  WorkflowFlowData,
  WorkflowNodeConfig,
  WorkflowVersionDiffSummary,
  WorkflowVersionEdgeChange,
  WorkflowVersionFieldChange,
  WorkflowVersionNodeChange,
} from '@zenith/shared';

const NODE_TYPE_LABEL: Record<string, string> = {
  start: '开始', approve: '审批', handler: '办理', end: '结束',
  exclusiveGateway: '排他网关', parallelGateway: '并行网关', inclusiveGateway: '包容网关', routeGateway: '路由网关',
  ccNode: '抄送', delay: '延时', trigger: '触发器', subProcess: '子流程', catchNode: '异常捕获',
};

const APPROVE_METHOD_LABEL: Record<string, string> = {
  sequence: '顺序会签', parallel: '并行会签', ratio: '比例会签', or: '或签', and: '会签', random: '随机一人',
};

const ASSIGNEE_TYPE_LABEL: Record<string, string> = {
  user: '指定成员', role: '角色', department: '部门负责人', userGroup: '用户组', post: '岗位',
  deptMember: '部门成员', initiator: '发起人', initiatorLeader: '发起人上级', initiatorDept: '发起人部门主管',
  startUserDeptResponsible: '部门分管领导', manager: '直属主管', expression: '表达式', formUser: '表单字段', self: '自选', decision: '决策表',
};

function assigneeSummary(cfg: WorkflowNodeConfig): string {
  if (cfg.assigneeType) {
    const label = ASSIGNEE_TYPE_LABEL[cfg.assigneeType] ?? cfg.assigneeType;
    const counts: Record<string, number | undefined> = {
      user: cfg.userIds?.length, role: cfg.roleIds?.length, department: cfg.deptIds?.length,
      userGroup: cfg.userGroupIds?.length, post: cfg.postIds?.length, deptMember: cfg.deptMemberDeptIds?.length,
    };
    const n = counts[cfg.assigneeType];
    return n != null ? `${label}(${n})` : label;
  }
  if (cfg.assigneeId != null) return `成员#${cfg.assigneeId}`;
  if (cfg.assigneeIds?.length) return `成员(${cfg.assigneeIds.length})`;
  return '未配置';
}

function timeoutSummary(cfg: WorkflowNodeConfig): string {
  const t = cfg.timeout;
  if (!t?.enabled) return '关闭';
  const unit = t.unit === 'minutes' ? '分钟' : t.unit === 'days' ? '天' : '小时';
  return `${t.duration}${unit} · ${t.action === 'autoApprove' ? '自动通过' : t.action === 'autoReject' ? '自动拒绝' : '提醒'}`;
}

/** 节点指纹：用于字段级比较（仅 approve/handler 比较审批人/方式/超时） */
function nodeFingerprint(cfg: WorkflowNodeConfig): Record<string, string> {
  const fp: Record<string, string> = {
    名称: cfg.label ?? '',
    类型: NODE_TYPE_LABEL[cfg.type] ?? cfg.type,
  };
  if (cfg.type === 'approve' || cfg.type === 'handler') {
    fp['审批人'] = assigneeSummary(cfg);
    fp['审批方式'] = cfg.approveMethod ? (APPROVE_METHOD_LABEL[cfg.approveMethod] ?? cfg.approveMethod) : '—';
    fp['超时策略'] = timeoutSummary(cfg);
  }
  if (cfg.type === 'ccNode') fp['抄送人'] = assigneeSummary(cfg);
  if (cfg.type === 'delay') fp['延时'] = cfg.delayType === 'toDate' ? `至 ${cfg.targetDate ?? '?'}` : `${cfg.delayValue ?? 0}${cfg.delayUnit === 'minute' ? '分钟' : cfg.delayUnit === 'day' ? '天' : '小时'}`;
  return fp;
}

function edgeConditionSummary(edge: WorkflowEdge): string {
  if (edge.isDefault) return '默认分支';
  if (edge.condition) {
    const c = edge.condition;
    return `${c.field} ${c.operator} ${String(c.value)}`;
  }
  if (Array.isArray(edge.conditions) && edge.conditions.length > 0) {
    return edge.conditions.map((g) => g.rules.map((r) => `${r.field} ${r.operator} ${String(r.value)}`).join(g.type === 'and' ? ' 且 ' : ' 或 ')).join(' | ');
  }
  return '无条件';
}

type FlowNode = { id: string; data: WorkflowNodeConfig };

function nodesOf(flow: WorkflowFlowData | null): FlowNode[] {
  return (flow && Array.isArray(flow.nodes) ? flow.nodes : []) as FlowNode[];
}
function edgesOf(flow: WorkflowFlowData | null): WorkflowEdge[] {
  return (flow && Array.isArray(flow.edges) ? flow.edges : []) as WorkflowEdge[];
}

export function buildVersionDiff(left: WorkflowFlowData | null, right: WorkflowFlowData | null): {
  summary: WorkflowVersionDiffSummary;
  nodeChanges: WorkflowVersionNodeChange[];
  edgeChanges: WorkflowVersionEdgeChange[];
} {
  const leftNodes = new Map(nodesOf(left).map((n) => [n.data.key, n.data]));
  const rightNodes = new Map(nodesOf(right).map((n) => [n.data.key, n.data]));

  const nodeChanges: WorkflowVersionNodeChange[] = [];
  // removed
  for (const [key, cfg] of leftNodes) {
    if (!rightNodes.has(key)) {
      nodeChanges.push({ kind: 'removed', nodeKey: key, nodeName: cfg.label || key, nodeType: NODE_TYPE_LABEL[cfg.type] ?? cfg.type, fields: [] });
    }
  }
  // added + modified
  for (const [key, cfg] of rightNodes) {
    const before = leftNodes.get(key);
    if (!before) {
      nodeChanges.push({ kind: 'added', nodeKey: key, nodeName: cfg.label || key, nodeType: NODE_TYPE_LABEL[cfg.type] ?? cfg.type, fields: [] });
      continue;
    }
    const fpBefore = nodeFingerprint(before);
    const fpAfter = nodeFingerprint(cfg);
    const fields: WorkflowVersionFieldChange[] = [];
    const keys = new Set([...Object.keys(fpBefore), ...Object.keys(fpAfter)]);
    for (const f of keys) {
      const b = fpBefore[f] ?? '—';
      const a = fpAfter[f] ?? '—';
      if (b !== a) fields.push({ field: f, before: b, after: a });
    }
    if (fields.length > 0) {
      nodeChanges.push({ kind: 'modified', nodeKey: key, nodeName: cfg.label || key, nodeType: NODE_TYPE_LABEL[cfg.type] ?? cfg.type, fields });
    }
  }

  // 连线：按 sourceKey->targetKey 匹配
  const buildEdgeMap = (flow: WorkflowFlowData | null) => {
    const idToKey = new Map(nodesOf(flow).map((n) => [n.id, n.data.key]));
    const idToName = new Map(nodesOf(flow).map((n) => [n.id, n.data.label || n.data.key]));
    const map = new Map<string, { edge: WorkflowEdge; fromName: string; toName: string }>();
    for (const e of edgesOf(flow)) {
      const sk = idToKey.get(e.source) ?? e.source;
      const tk = idToKey.get(e.target) ?? e.target;
      map.set(`${sk}->${tk}`, { edge: e, fromName: idToName.get(e.source) ?? sk, toName: idToName.get(e.target) ?? tk });
    }
    return map;
  };
  const leftEdges = buildEdgeMap(left);
  const rightEdges = buildEdgeMap(right);
  const edgeChanges: WorkflowVersionEdgeChange[] = [];
  for (const [sig, { fromName, toName }] of leftEdges) {
    if (!rightEdges.has(sig)) edgeChanges.push({ kind: 'removed', from: fromName, to: toName, before: edgeConditionSummary(leftEdges.get(sig)!.edge), after: null });
  }
  for (const [sig, r] of rightEdges) {
    const l = leftEdges.get(sig);
    if (!l) {
      edgeChanges.push({ kind: 'added', from: r.fromName, to: r.toName, before: null, after: edgeConditionSummary(r.edge) });
      continue;
    }
    const beforeCond = edgeConditionSummary(l.edge);
    const afterCond = edgeConditionSummary(r.edge);
    if (beforeCond !== afterCond) edgeChanges.push({ kind: 'modified', from: r.fromName, to: r.toName, before: beforeCond, after: afterCond });
  }

  const summary: WorkflowVersionDiffSummary = {
    nodesAdded: nodeChanges.filter((c) => c.kind === 'added').length,
    nodesRemoved: nodeChanges.filter((c) => c.kind === 'removed').length,
    nodesModified: nodeChanges.filter((c) => c.kind === 'modified').length,
    edgesAdded: edgeChanges.filter((c) => c.kind === 'added').length,
    edgesRemoved: edgeChanges.filter((c) => c.kind === 'removed').length,
    edgesModified: edgeChanges.filter((c) => c.kind === 'modified').length,
  };

  return { summary, nodeChanges, edgeChanges };
}
