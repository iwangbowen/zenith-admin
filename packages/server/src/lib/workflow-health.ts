/**
 * 发布前健康评分 + 分支覆盖分析（纯静态分析，不落库、不外呼）。
 *
 * 维度：
 *  - structure 结构合法性（复用 validateFlowData）
 *  - approver  审批人可解析性（每个 approve/handler/cc 节点是否配齐审批人来源）
 *  - branch    分支覆盖（网关默认分支缺失 / 条件重叠 / 死路 / 路由字段缺失）
 *  - timeout   超时/SLA 策略完整性（审批节点是否配置超时提醒）
 */
import type {
  WorkflowDefinitionBranchCoverageItem,
  WorkflowDefinitionHealthCheckItem,
  WorkflowDefinitionHealthIssue,
  WorkflowDefinitionHealthReport,
  WorkflowEdge,
  WorkflowFlowData,
  WorkflowNodeConfig,
} from '@zenith/shared';
import { validateFlowData } from './workflow-engine';
import { formatDateTime } from './datetime';

type FlowNode = { id: string; type?: string; data: WorkflowNodeConfig };

const GATEWAY_TYPES = new Set(['exclusiveGateway', 'inclusiveGateway', 'routeGateway']);
const ASSIGNEE_NODE_TYPES = new Set(['approve', 'handler', 'ccNode']);
/** 需要运行时动态解析、应配置空审批人兜底策略的来源类型 */
const DYNAMIC_ASSIGNEE_TYPES = new Set(['role', 'department', 'deptMember', 'userGroup', 'post', 'manager', 'expression', 'startUserDeptResponsible']);

function issue(severity: WorkflowDefinitionHealthIssue['severity'], message: string, suggestion: string | null, node?: FlowNode | null): WorkflowDefinitionHealthIssue {
  return { severity, message, suggestion, nodeKey: node?.data.key ?? null, nodeName: node ? (node.data.label || node.data.key) : null };
}

function statusFromIssues(issues: WorkflowDefinitionHealthIssue[]): WorkflowDefinitionHealthCheckItem['status'] {
  if (issues.some((i) => i.severity === 'critical')) return 'fail';
  if (issues.some((i) => i.severity === 'warning')) return 'warn';
  return 'pass';
}

function edgeHasCondition(e: WorkflowEdge): boolean {
  return Boolean(e.condition || (Array.isArray(e.conditions) && e.conditions.length > 0));
}

function conditionSignature(e: WorkflowEdge): string {
  if (e.condition) {
    const c = e.condition;
    return JSON.stringify({ f: c.field, o: c.operator, v: c.value, s: c.source ?? 'form', ag: c.aggregate ?? null });
  }
  if (Array.isArray(e.conditions)) return JSON.stringify(e.conditions);
  return '';
}

function isApproverResolvable(cfg: WorkflowNodeConfig): boolean {
  if (cfg.assigneeId != null) return true;
  if (Array.isArray(cfg.assigneeIds) && cfg.assigneeIds.length > 0) return true;
  switch (cfg.assigneeType) {
    case 'user': return Boolean(cfg.userIds?.length);
    case 'role': return Boolean(cfg.roleIds?.length);
    case 'department': return Boolean(cfg.deptIds?.length);
    case 'userGroup': return Boolean(cfg.userGroupIds?.length);
    case 'post': return Boolean(cfg.postIds?.length);
    case 'deptMember': return Boolean(cfg.deptMemberDeptIds?.length);
    case 'expression': return Boolean(cfg.assigneeExpression && cfg.assigneeExpression.trim());
    case undefined: return false;
    // 其余动态来源（发起人 / 主管 / 表单字段 / 自选 等）运行时解析，视为已配置
    default: return true;
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function analyzeWorkflowHealth(raw: WorkflowFlowData | null | undefined): WorkflowDefinitionHealthReport {
  const flowData = (raw ?? { nodes: [], edges: [] }) as WorkflowFlowData;
  const nodes = (Array.isArray(flowData.nodes) ? flowData.nodes : []) as FlowNode[];
  const edges = (Array.isArray(flowData.edges) ? flowData.edges : []) as WorkflowEdge[];

  const nodeById = new Map<string, FlowNode>();
  for (const n of nodes) nodeById.set(n.id, n);
  const edgesBySource = new Map<string, WorkflowEdge[]>();
  for (const e of edges) {
    const list = edgesBySource.get(e.source);
    if (list) list.push(e); else edgesBySource.set(e.source, [e]);
  }
  const nodeName = (id: string): string => {
    const n = nodeById.get(id);
    return n ? (n.data.label || n.data.key || id) : id;
  };

  // ── structure ──
  const validation = validateFlowData(flowData);
  const structureIssues: WorkflowDefinitionHealthIssue[] = validation.errors.map((e) => issue('critical', e, null));
  const structureScore = validation.valid ? 100 : clamp(100 - structureIssues.length * 15);
  const structureCheck: WorkflowDefinitionHealthCheckItem = {
    key: 'structure', title: '结构合法性', weight: 0.35, score: structureScore,
    status: validation.valid ? 'pass' : 'fail',
    summary: validation.valid ? '流程结构合法' : `发现 ${structureIssues.length} 处结构问题`,
    issues: structureIssues,
  };

  // ── approver ──
  const assigneeNodes = nodes.filter((n) => ASSIGNEE_NODE_TYPES.has(n.data.type));
  const approverIssues: WorkflowDefinitionHealthIssue[] = [];
  let resolvable = 0;
  for (const n of assigneeNodes) {
    if (isApproverResolvable(n.data)) {
      resolvable += 1;
      if (n.data.assigneeType && DYNAMIC_ASSIGNEE_TYPES.has(n.data.assigneeType) && !n.data.emptyStrategy) {
        approverIssues.push(issue('info', `节点「${n.data.label || n.data.key}」审批人为动态来源但未配置空审批人兜底策略`, '设置 emptyStrategy（自动通过 / 转交管理员等）避免运行时无人可审', n));
      }
    } else {
      const sev = n.data.type === 'ccNode' ? 'warning' : 'critical';
      approverIssues.push(issue(sev, `节点「${n.data.label || n.data.key}」未配置可解析的审批人来源`, '为该节点指定审批人（成员 / 角色 / 部门 / 岗位 / 发起人相关等）', n));
    }
  }
  const approverScore = assigneeNodes.length === 0 ? 100 : clamp((resolvable / assigneeNodes.length) * 100);
  const approverCheck: WorkflowDefinitionHealthCheckItem = {
    key: 'approver', title: '审批人可解析性', weight: 0.30, score: approverScore,
    status: statusFromIssues(approverIssues),
    summary: assigneeNodes.length === 0 ? '无审批/办理/抄送节点' : `${resolvable}/${assigneeNodes.length} 个审批节点已配齐审批人`,
    issues: approverIssues,
  };

  // ── branch coverage ──
  const branchCoverage: WorkflowDefinitionBranchCoverageItem[] = [];
  const branchIssues: WorkflowDefinitionHealthIssue[] = [];
  for (const gw of nodes.filter((n) => GATEWAY_TYPES.has(n.data.type))) {
    const out = edgesBySource.get(gw.id) ?? [];
    const conditional = out.filter((e) => edgeHasCondition(e) && !e.isDefault);
    const defaults = out.filter((e) => e.isDefault || (!edgeHasCondition(e) && !e.isException));
    const hasDefault = defaults.length > 0;
    const gwIssues: WorkflowDefinitionHealthIssue[] = [];

    if (out.length === 0) {
      gwIssues.push(issue('critical', `网关「${gw.data.label || gw.data.key}」没有任何出口分支`, '至少连接一条出边', gw));
    } else if ((gw.data.type === 'exclusiveGateway' || gw.data.type === 'inclusiveGateway') && conditional.length > 0 && !hasDefault) {
      gwIssues.push(issue('warning', `网关「${gw.data.label || gw.data.key}」缺少默认分支`, '添加一条默认分支兜底，避免所有条件都不满足时流程卡死', gw));
    }
    if (defaults.length > 1) {
      gwIssues.push(issue('warning', `网关「${gw.data.label || gw.data.key}」存在 ${defaults.length} 条默认分支`, '默认分支应唯一', gw));
    }
    const seen = new Map<string, string>();
    for (const e of conditional) {
      const sig = conditionSignature(e);
      const tName = nodeName(e.target);
      if (seen.has(sig)) {
        gwIssues.push(issue('warning', `网关「${gw.data.label || gw.data.key}」分支「${seen.get(sig)}」与「${tName}」条件完全相同（重叠）`, '合并或区分这两条分支的条件', gw));
      } else {
        seen.set(sig, tName);
      }
    }

    branchCoverage.push({ nodeKey: gw.data.key, nodeName: gw.data.label || gw.data.key, nodeType: gw.data.type, branchCount: out.length, hasDefault, issues: gwIssues });
    branchIssues.push(...gwIssues);
  }
  // 死路：非开始/结束节点却没有任何后继连线
  for (const n of nodes) {
    if (n.data.type === 'start' || n.data.type === 'end' || n.data.type === 'catchNode') continue;
    const out = edgesBySource.get(n.id) ?? [];
    if (out.length === 0) {
      branchIssues.push(issue('warning', `节点「${n.data.label || n.data.key}」是死路：没有后继连线，流程到此中断`, '连接到后续节点或结束节点', n));
    }
  }
  const branchScore = clamp(100 - branchIssues.filter((i) => i.severity === 'critical').length * 30 - branchIssues.filter((i) => i.severity === 'warning').length * 12 - branchIssues.filter((i) => i.severity === 'info').length * 4);
  const branchCheck: WorkflowDefinitionHealthCheckItem = {
    key: 'branch', title: '分支覆盖', weight: 0.25, score: branchScore,
    status: statusFromIssues(branchIssues),
    summary: branchIssues.length === 0 ? '分支覆盖完整，未发现死路/重叠' : `发现 ${branchIssues.length} 处分支问题`,
    issues: branchIssues,
  };

  // ── timeout / SLA ──
  const timeoutIssues: WorkflowDefinitionHealthIssue[] = [];
  for (const n of nodes.filter((x) => x.data.type === 'approve' || x.data.type === 'handler')) {
    if (n.data.timeout == null) {
      timeoutIssues.push(issue('info', `节点「${n.data.label || n.data.key}」未配置超时/SLA 提醒`, '配置超时时长，便于超时预警与自动催办', n));
    }
  }
  const timeoutScore = clamp(100 - timeoutIssues.length * 5);
  const timeoutCheck: WorkflowDefinitionHealthCheckItem = {
    key: 'timeout', title: '超时/SLA 策略', weight: 0.10, score: timeoutScore,
    status: statusFromIssues(timeoutIssues),
    summary: timeoutIssues.length === 0 ? '审批节点均已配置超时策略' : `${timeoutIssues.length} 个审批节点未配置超时`,
    issues: timeoutIssues,
  };

  const checks = [structureCheck, approverCheck, branchCheck, timeoutCheck];
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const score = clamp(checks.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight);
  const grade: WorkflowDefinitionHealthReport['grade'] = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';

  return { score, grade, valid: validation.valid, checks, branchCoverage, generatedAt: formatDateTime(new Date()) };
}
