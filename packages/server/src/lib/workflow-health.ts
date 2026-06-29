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
  WorkflowEdgeCondition,
  WorkflowFlowData,
  WorkflowNodeConfig,
} from '@zenith/shared';
import { validateFlowData } from './workflow-engine';
import { validateExpression } from './workflow-expression';
import { formatDateTime } from './datetime';

/** 审批人/条件表达式可引用的根变量（form=表单字段，starter=发起人上下文） */
const EXPR_ROOTS = ['form', 'starter'];

/** DB/类型感知的体检增强（由 service 层预算后注入纯分析器，分析器本身仍不外呼/不查库） */
export interface WorkflowHealthEnrichment {
  /** 字段 key → 表单字段类型，用于条件操作符/类型兼容性校验 */
  fieldTypes?: Map<string, string> | null;
  /** nodeKey → 不可用审批人提示（如「指定审批人 张三 已停用」），注入审批人维度 */
  approverAvailability?: Map<string, string[]> | null;
}

/** 数值/大小比较类操作符——要求字段为数值或日期型 */
const NUMERIC_OPERATORS = new Set(['gt', 'gte', 'lt', 'lte', 'between']);
/** 日期相对比较操作符——要求字段为日期型 */
const DATE_OPERATORS = new Set(['withinDays', 'beforeDays']);
/** 数值/日期可比较字段类型 */
const NUMERIC_DATE_FIELD_TYPES = new Set(['number', 'amount', 'slider', 'date', 'dateRange', 'time']);
/** 日期型字段类型 */
const DATE_FIELD_TYPES = new Set(['date', 'dateRange', 'time']);
/** 取值含糊（可能存数值/日期）的字段类型，类型校验时放行以免误报 */
const AMBIGUOUS_FIELD_TYPES = new Set(['select', 'radio', 'autoComplete']);

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

/** 单条件数值区间：用于网关两两重叠检测（仅 form 数值比较）。null=无法判定。 */
function numericInterval(e: WorkflowEdge): { field: string; lo: number; hi: number } | null {
  const c = e.condition;
  if (!c || (c.source ?? 'form') !== 'form' || c.aggregate) return null;
  const v = Number(c.value);
  if (Number.isNaN(v)) return null;
  switch (c.operator) {
    case 'gt': return { field: c.field, lo: v + 1e-9, hi: Infinity };
    case 'gte': return { field: c.field, lo: v, hi: Infinity };
    case 'lt': return { field: c.field, lo: -Infinity, hi: v - 1e-9 };
    case 'lte': return { field: c.field, lo: -Infinity, hi: v };
    case 'eq': return { field: c.field, lo: v, hi: v };
    default: return null;
  }
}

function rangesOverlap(a: WorkflowEdge, b: WorkflowEdge): boolean {
  const x = numericInterval(a), y = numericInterval(b);
  if (!x || !y || x.field !== y.field) return false;
  return x.lo <= y.hi && y.lo <= x.hi;
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

export function analyzeWorkflowHealth(
  raw: WorkflowFlowData | null | undefined,
  knownFields?: Set<string> | null,
  enrichment?: WorkflowHealthEnrichment | null,
): WorkflowDefinitionHealthReport {
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
  // 3D-1 指定审批人可用性（service 层预解析的停用/缺失用户）→ 注入审批人维度告警
  const availability = enrichment?.approverAvailability;
  if (availability && availability.size > 0) {
    for (const n of assigneeNodes) {
      const msgs = availability.get(n.data.key);
      if (msgs && msgs.length > 0) {
        for (const m of msgs) {
          approverIssues.push(issue('warning', `节点「${n.data.label || n.data.key}」${m}`, '更换为在用的审批人，或改用动态来源并配置空审批人兜底策略', n));
        }
      }
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
    // 排他网关重叠矩阵：两两数值区间相交 → 同一输入可命中多分支（排他语义被破坏）
    if (gw.data.type === 'exclusiveGateway' || gw.data.type === 'routeGateway') {
      for (let i = 0; i < conditional.length; i++) {
        for (let j = i + 1; j < conditional.length; j++) {
          const a = conditional[i], b = conditional[j];
          if (conditionSignature(a) !== conditionSignature(b) && rangesOverlap(a, b)) {
            gwIssues.push(issue('warning', `网关「${gw.data.label || gw.data.key}」分支「${nodeName(a.target)}」与「${nodeName(b.target)}」条件区间重叠`, '排他网关要求条件互斥，请收紧区间或改用包容网关', gw));
          }
        }
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
    if (!n.data.timeout?.enabled) {
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

  // ── expression / 字段引用 ──
  // 审批人表达式做语法 + 变量根校验（始终执行，无需表单）；条件/表达式的具体字段引用
  // 仅在已解析出表单字段集合（knownFields）时校验，避免对外部表单/未绑定表单误报。
  const exprIssues: WorkflowDefinitionHealthIssue[] = [];
  let exprChecks = 0;
  const hasFields = !!knownFields && knownFields.size > 0;
  const collectConditions = (e: WorkflowEdge): WorkflowEdgeCondition[] => {
    const list: WorkflowEdgeCondition[] = [];
    if (e.condition) list.push(e.condition);
    for (const g of e.conditions ?? []) for (const r of g.rules ?? []) list.push(r);
    return list;
  };

  for (const n of nodes.filter((x) => x.data.assigneeType === 'expression')) {
    const expr = (n.data.assigneeExpression ?? '').trim();
    if (!expr) continue; // 空表达式由 approver 维度兜底
    exprChecks += 1;
    const res = validateExpression(expr, EXPR_ROOTS);
    if (!res.valid) {
      exprIssues.push(issue('critical', `节点「${n.data.label || n.data.key}」审批人表达式非法：${res.error}`, '修正表达式语法（仅支持纯运算，禁止函数调用），变量只能引用 form.* / starter.*', n));
    } else if (hasFields) {
      const refs = res.references
        .filter((p) => p.startsWith('form.'))
        .map((p) => p.slice(5).split('.')[0])
        .filter((f) => f && !knownFields!.has(f));
      const uniq = [...new Set(refs)];
      if (uniq.length > 0) {
        exprIssues.push(issue('warning', `节点「${n.data.label || n.data.key}」审批人表达式引用了表单中不存在的字段：${uniq.join('、')}`, '确认这些字段存在于绑定表单中，或更正字段 key', n));
      }
    }
  }

  if (hasFields) {
    for (const e of edges) {
      const src = nodeById.get(e.source) ?? null;
      for (const c of collectConditions(e)) {
        if ((c.source ?? 'form') !== 'form') continue; // starter 维度字段不是表单字段
        if (c.aggregate) continue; // 聚合条件的 field 是明细子表字段，aggregateField 为其子列，跳过顶层校验
        if (!c.field) continue;
        exprChecks += 1;
        if (!knownFields!.has(c.field)) {
          exprIssues.push(issue('warning', `分支「→ ${nodeName(e.target)}」条件引用了表单中不存在的字段「${c.field}」`, '确认该字段存在于绑定表单中，或更正条件字段 key', src));
        }
      }
    }
  }

  // 3D-2 条件操作符与字段类型兼容性（仅在已知字段类型时校验，含糊类型放行避免误报）
  const fieldTypes = enrichment?.fieldTypes;
  if (fieldTypes && fieldTypes.size > 0) {
    for (const e of edges) {
      const src = nodeById.get(e.source) ?? null;
      for (const c of collectConditions(e)) {
        if ((c.source ?? 'form') !== 'form' || c.aggregate || !c.field) continue;
        const ft = fieldTypes.get(c.field);
        if (!ft || AMBIGUOUS_FIELD_TYPES.has(ft)) continue;
        if (NUMERIC_OPERATORS.has(c.operator) && !NUMERIC_DATE_FIELD_TYPES.has(ft)) {
          exprChecks += 1;
          exprIssues.push(issue('warning', `分支「→ ${nodeName(e.target)}」对字段「${c.field}」（${ft}）使用了数值/大小比较操作符`, '数值比较请用于数字/金额/日期型字段，或更换操作符（如等于/包含）', src));
        } else if (DATE_OPERATORS.has(c.operator) && !DATE_FIELD_TYPES.has(ft)) {
          exprChecks += 1;
          exprIssues.push(issue('warning', `分支「→ ${nodeName(e.target)}」对字段「${c.field}」（${ft}）使用了日期相对比较操作符`, '相对日期比较请用于日期型字段', src));
        }
      }
    }
  }

  const exprScore = clamp(100 - exprIssues.filter((i) => i.severity === 'critical').length * 30 - exprIssues.filter((i) => i.severity === 'warning').length * 12);
  const expressionCheck: WorkflowDefinitionHealthCheckItem = {
    key: 'expression', title: '表达式与字段引用', weight: 0.15, score: exprScore,
    status: statusFromIssues(exprIssues),
    summary: exprChecks === 0
      ? '无表达式审批人/条件字段需校验'
      : (exprIssues.length === 0 ? '表达式语法与字段引用均合法' : `发现 ${exprIssues.length} 处表达式/字段引用问题`),
    issues: exprIssues,
  };

  const checks = [structureCheck, approverCheck, branchCheck, timeoutCheck, expressionCheck];
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const score = clamp(checks.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight);
  const grade: WorkflowDefinitionHealthReport['grade'] = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';

  return { score, grade, valid: validation.valid, checks, branchCoverage, generatedAt: formatDateTime(new Date()) };
}
