/**
 * 工作流前后端共享的纯函数工具（无副作用、无 DB 依赖）。
 *
 * 放在 shared 是为了让「前端审批弹窗 / 后端校验 / MSW Mock」三处对
 * 「下一节点审批人自选」的判定保持**完全一致**，避免各自实现产生偏差。
 */
import type { WorkflowFieldPermission, WorkflowFlowData, WorkflowFormField, WorkflowInstanceSummaryItem, WorkflowNodeConfig, WorkflowNodeFailurePolicy } from './types';

type WorkflowFlowNode = WorkflowFlowData['nodes'][number];

/** 人工审批节点类型（会创建待办、阻断流转，遍历到此即停止） */
const HUMAN_TASK_TYPES = new Set(['approve', 'handler']);
/**
 * 「穿透型」节点类型：本身不创建待办、不阻断流转，引擎会越过它们继续推进到下一批人工任务。
 * 仅这些类型允许在查找「紧邻的下一审批节点」时被穿过。
 */
const PASSTHROUGH_TYPES = new Set([
  'start',
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'routeGateway',
  'ccNode',
]);

/**
 * 从指定节点出发，沿正常出边（排除异常边 / catch 节点）穿过网关、抄送等「穿透型」节点，
 * 在遇到第一个**人工审批节点**（approve / handler）即停止（不再越过），
 * 收集其中 `assigneeType === 'approverSelect'` 的「紧邻下一审批节点」。
 *
 * 与审批引擎 `advanceTokens` 推进到「下一批人工任务」的语义保持一致：
 * - 多跳：`A → B(普通审批) → C(approverSelect)`，从 A 出发会停在 B，**不会**误纳 C；
 *   C 由 B 审批时才作为「紧邻下一节点」被提示。
 * - 并行：`A → 网关 → [B, C]` 两个 approverSelect，二者都会被收集（各自独立选人）。
 * - 阻断：遇到 delay / trigger / subProcess 等会暂停流转的节点即停止，不穿透。
 *
 * @param flowData    流程图数据（节点 + 连线）
 * @param fromNodeKey 当前审批节点的 key
 * @returns 紧邻下一审批节点中、需由当前审批人选人的 approverSelect 节点列表（按 key 去重）
 */
export function findNextApproverSelectNodes(
  flowData: WorkflowFlowData,
  fromNodeKey: string,
): WorkflowFlowNode[] {
  const startNode = flowData.nodes.find((n) => n.data.key === fromNodeKey);
  if (!startNode) return [];

  const nodeById = new Map(flowData.nodes.map((n) => [n.id, n]));
  const result: WorkflowFlowNode[] = [];
  const seenKeys = new Set<string>();
  const visited = new Set<string>([startNode.id]);
  const queue: string[] = [startNode.id];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const edge of flowData.edges ?? []) {
      if (edge.source !== currentId || edge.isException || visited.has(edge.target)) continue;
      const target = nodeById.get(edge.target);
      if (!target || target.data.type === 'catchNode') continue;
      visited.add(edge.target);

      if (HUMAN_TASK_TYPES.has(target.data.type)) {
        // 紧邻的下一人工审批节点：是 approverSelect 则收集；无论是否收集都不再越过它
        if (target.data.assigneeType === 'approverSelect' && !seenKeys.has(target.data.key)) {
          seenKeys.add(target.data.key);
          result.push(target);
        }
        continue;
      }

      // 仅穿透型节点（网关 / 抄送 / start）允许继续向后查找；其余阻断型节点（delay/trigger/subProcess/end）停止
      if (PASSTHROUGH_TYPES.has(target.data.type)) {
        queue.push(edge.target);
      }
    }
  }

  return result;
}

/**
 * 解析节点的统一失败策略（Saga / 补偿）。
 *
 * 返回 `null` 表示「无显式策略」——引擎应回退到 legacy 的**异常边 → catchNode → catchAction** 路径，
 * 保证既有流程 100% 向后兼容。
 *
 * 兼容映射（仅当节点未显式配置 `failurePolicy` 时）：
 * - trigger.onFailure='continue' → { action:'continue' }
 * - trigger.onFailure='retry'    → { action:'retry', maxRetries }
 * - trigger.onFailure='block'    → null（沿用异常边/catch 挂起语义）
 * - 其余节点                      → null（沿用异常边/catch）
 */
export function resolveFailurePolicy(node: WorkflowNodeConfig | null | undefined): WorkflowNodeFailurePolicy | null {
  if (!node) return null;
  if (node.failurePolicy) return node.failurePolicy;
  if (node.type === 'trigger') {
    const of = node.triggerConfig?.onFailure;
    if (of === 'continue') return { action: 'continue' };
    if (of === 'retry') return { action: 'retry', maxRetries: node.triggerConfig?.maxRetries };
  }
  return null;
}

// ─── 节点级表单字段权限（read / edit / hidden）──────────────────────────────────
//
// 设计器 FormPermissionTab 按节点为每个字段 key 配置权限；未配置的字段默认 `read`。
// 以下纯函数让「前端渲染 / 后端写入白名单 / MSW Mock」三处语义完全一致：
// - hidden：当前节点不可见（渲染时整体移除，包含布局容器的子字段）
// - read  ：可见但不可编辑（默认）
// - edit  ：可见且可编辑，审批提交时允许写回

/** 读取流程图中指定节点的字段权限表；节点不存在或未配置时返回 undefined */
export function resolveNodeFieldPermissions(
  flowData: WorkflowFlowData | null | undefined,
  nodeKey: string | null | undefined,
): Record<string, WorkflowFieldPermission> | undefined {
  if (!flowData || !nodeKey) return undefined;
  const node = flowData.nodes.find((n) => n.data.key === nodeKey);
  return node?.data.fieldPermissions;
}

/** 权限表中是否存在至少一个可编辑字段 */
export function hasEditableFieldPermission(
  perms: Record<string, WorkflowFieldPermission> | null | undefined,
): boolean {
  if (!perms) return false;
  return Object.values(perms).includes('edit');
}

/**
 * 将节点字段权限应用到表单字段树（递归处理分栏/标签页/分步/分组/明细容器）：
 * - hidden → 整体移除（容器被隐藏时其子字段随之移除）
 * - read（含未配置）→ 克隆为 `readOnly: true`（同时取消 required，只读字段不参与必填校验）
 * - edit → 原样保留
 *
 * 返回新数组，不修改入参。`perms` 为空时原样返回（兼容未配置权限的旧流程）。
 */
export function applyFieldPermissionsToFields(
  fields: WorkflowFormField[],
  perms: Record<string, WorkflowFieldPermission> | null | undefined,
): WorkflowFormField[] {
  if (!perms || Object.keys(perms).length === 0) return fields;
  const walk = (list: WorkflowFormField[]): WorkflowFormField[] => {
    const out: WorkflowFormField[] = [];
    for (const f of list) {
      const perm = perms[f.key];
      if (perm === 'hidden') continue;
      let next: WorkflowFormField = f;
      if (f.type === 'row' && f.columns) {
        next = { ...next, columns: f.columns.map((col) => ({ ...col, fields: walk(col.fields) })) };
      } else if ((f.type === 'tabs' || f.type === 'steps') && f.panes) {
        next = { ...next, panes: f.panes.map((pane) => ({ ...pane, fields: walk(pane.fields) })) };
      } else if ((f.type === 'group' || f.type === 'detail') && f.children) {
        next = { ...next, children: walk(f.children) };
      }
      // 显式 edit 才可编辑；read / 未配置一律只读（与 FormPermissionTab 默认「可读」一致）
      if (perm !== 'edit') {
        next = { ...next, readOnly: true, required: false };
      }
      out.push(next);
    }
    return out;
  };
  return walk(fields);
}

/**
 * 审批提交表单变更的服务端白名单过滤：仅保留权限为 `edit` 的字段 key。
 * 节点无权限配置（perms 为空）时视为**无可编辑字段**，返回空对象——
 * 写权限必须显式声明，与「未配置默认可读」保持一致的安全语义。
 */
export function sanitizeFormUpdatesByNodePerms(
  perms: Record<string, WorkflowFieldPermission> | null | undefined,
  updates: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!perms || !updates) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (perms[key] === 'edit') out[key] = value;
  }
  return out;
}

/**
 * 收集流程 flowData 中**执行路径依赖**的表单字段 key：
 * 分支条件（source='form'）、formUser / formDepartment 审批人字段、
 * 审批人表达式中的 `form.*` 引用、延迟节点目标日期字段、子流程循环/发起人字段。
 *
 * 用于发布前门禁：designer 类型未绑定表单（或字段缺失）时，这些引用在运行时
 * 必然解析失败（分支全走默认、审批人为空），应阻断发布而非上线后才暴露。
 */
export function collectReferencedFormFieldKeys(
  flowData: Pick<WorkflowFlowData, 'nodes' | 'edges'> | null | undefined,
): Set<string> {
  const keys = new Set<string>();
  const addKey = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) keys.add(v.trim());
  };
  for (const edge of flowData?.edges ?? []) {
    const rules = [
      ...(edge.condition ? [edge.condition] : []),
      ...(edge.conditions ?? []).flatMap((g) => g.rules ?? []),
    ];
    for (const rule of rules) {
      if ((rule.source ?? 'form') === 'form') addKey(rule.field);
    }
  }
  for (const node of flowData?.nodes ?? []) {
    const data = node.data;
    if (!data) continue;
    if (data.assigneeType === 'formUser') addKey(data.formUserField);
    if (data.assigneeType === 'formDepartment') addKey(data.formDeptField);
    if (data.assigneeType === 'expression' && typeof data.assigneeExpression === 'string') {
      for (const m of data.assigneeExpression.matchAll(/\bform\.([A-Za-z_$][\w$]*)/g)) addKey(m[1]);
    }
    if (data.type === 'delay' && data.delayType === 'toDate') addKey(data.targetDate);
    if (data.type === 'subProcess') {
      addKey(data.subProcessMultiSource);
      if (data.subProcessInitiator === 'formField') addKey(data.subProcessInitiatorField);
    }
  }
  return keys;
}

// ─── 待办/列表摘要字段（钉钉式卡片摘要）────────────────────────────────────────
//
// 流程「更多设置」可配置 `summaryFields`（≤3 个字段 key），待办/申请列表在标题下
// 直接展示关键表单值。以下纯函数供「后端列表映射 / MSW Mock / 设计器选项过滤」共用。

export const WORKFLOW_SUMMARY_MAX_FIELDS = 3;

/** 布局与复杂值类型不适合做摘要（无标量文本表示或值为 ID/文件对象） */
const SUMMARY_EXCLUDED_FIELD_TYPES = new Set([
  'row', 'tabs', 'steps', 'group', 'divider', 'description', 'detail',
  'attachment', 'image', 'signature', 'richtext', 'userSelect', 'deptSelect', 'relation', 'password',
  'matrix', 'location',
]);

/** 字段类型是否可作为列表摘要字段（设计器选择器与运行时格式化共用同一判定） */
export function isWorkflowSummaryCapableField(type: string): boolean {
  return !SUMMARY_EXCLUDED_FIELD_TYPES.has(type);
}

function flattenWorkflowFormFields(fields: WorkflowFormField[]): WorkflowFormField[] {
  const out: WorkflowFormField[] = [];
  for (const f of fields) {
    out.push(f);
    if (f.type === 'row' && f.columns) for (const col of f.columns) out.push(...flattenWorkflowFormFields(col.fields));
    else if ((f.type === 'tabs' || f.type === 'steps') && f.panes) for (const pane of f.panes) out.push(...flattenWorkflowFormFields(pane.fields));
    else if ((f.type === 'group' || f.type === 'detail') && f.children) out.push(...flattenWorkflowFormFields(f.children));
  }
  return out;
}

function summaryOptionLabel(field: WorkflowFormField, value: unknown): string {
  const raw = String(value);
  const item = field.optionItems?.find((o) => o.value === raw);
  return item?.label || raw;
}

/** 单字段值 → 摘要文本；无法表达（对象/排除类型）返回 null，空值返回 '-' */
function formatSummaryValue(field: WorkflowFormField, value: unknown): string | null {
  if (!isWorkflowSummaryCapableField(field.type)) return null;
  if (value === null || value === undefined || value === '') return '-';
  if (field.type === 'switch') return value ? '是' : '否';
  if (Array.isArray(value)) {
    if (value.length === 0) return '-';
    if (value.some((v) => typeof v === 'object' && v !== null)) return null;
    const parts = value.map((v) => summaryOptionLabel(field, v));
    if (field.type === 'dateRange') return parts.join(' ~ ');
    if (field.type === 'region') return parts.join(' / ');
    return parts.join('、');
  }
  if (typeof value === 'object') return null;
  if (field.type === 'select' || field.type === 'radio') return summaryOptionLabel(field, value);
  const text = String(value);
  if ((field.type === 'number' || field.type === 'amount') && field.unit) return `${text} ${field.unit}`;
  return text;
}

/**
 * 按 `summaryFields` 配置从表单快照与表单数据构建摘要项（顺序跟随配置，最多 max 条）。
 * 未配置、字段已被删除或值无法文本化的项自动跳过。
 */
export function buildWorkflowSummaryItems(
  fields: WorkflowFormField[] | null | undefined,
  formData: Record<string, unknown> | null | undefined,
  summaryKeys: string[] | null | undefined,
  max: number = WORKFLOW_SUMMARY_MAX_FIELDS,
): WorkflowInstanceSummaryItem[] {
  if (!summaryKeys?.length || !fields?.length) return [];
  const byKey = new Map(flattenWorkflowFormFields(fields).map((f) => [f.key, f]));
  const out: WorkflowInstanceSummaryItem[] = [];
  for (const key of summaryKeys) {
    if (out.length >= max) break;
    const field = byKey.get(key);
    if (!field) continue;
    const value = formatSummaryValue(field, (formData ?? {})[key]);
    if (value === null) continue;
    out.push({ key, label: field.label || key, value });
  }
  return out;
}

// ─── 表单字段 key 重命名 → 流程定义 flowData 级联更新 ──────────────────────────
//
// 表单库中修改字段 key 后，引用该表单的流程定义 flowData 中仍残留旧 key
// （分支条件、字段权限、审批人字段、触发器模板、子流程映射、摘要字段、业务编号模板等）。
// 本纯函数对 flowData 做**定点**重写（不做全文替换，避免误伤 URL/名称等无关字符串），
// 供服务端在表单更新事务内级联修复所有引用定义；前后端/MSW 共享同一语义。

const escapeReg = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 替换模板串中的 {{form.oldKey}} 占位（触发器 bodyTemplate / fieldValues / 子流程映射值） */
function renameFormTemplateRefs(template: string, renames: Record<string, string>): string {
  let out = template;
  for (const [oldKey, newKey] of Object.entries(renames)) {
    out = out.replace(new RegExp(`\\{\\{\\s*form\\.${escapeReg(oldKey)}\\s*\\}\\}`, 'g'), `{{form.${newKey}}}`);
  }
  return out;
}

/** 替换业务编号模板中的 {FORM.oldKey} 占位（renderWorkflowSerialNo 的 token 前缀大小写不敏感） */
function renameSerialTemplateRefs(template: string, renames: Record<string, string>): string {
  let out = template;
  for (const [oldKey, newKey] of Object.entries(renames)) {
    out = out.replace(new RegExp(`\\{(FORM)\\.${escapeReg(oldKey)}\\}`, 'gi'), (_m, prefix: string) => `{${prefix}.${newKey}}`);
  }
  return out;
}

const renameKey = (key: unknown, renames: Record<string, string>): unknown =>
  typeof key === 'string' && key in renames ? renames[key] : key;

/** 重命名 Record 的键（fieldPermissions / subProcessOutputMapping / 触发器 fieldValues） */
function renameRecordKeys<T>(record: Record<string, T>, renames: Record<string, string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k in renames ? renames[k] : k, v]));
}

/** 重命名条件规则中的表单字段引用（source='starter' 的规则 field 为发起人维度，不动） */
function renameConditionRule<T extends { field?: unknown; source?: unknown; aggregateField?: unknown }>(
  rule: T,
  renames: Record<string, string>,
): T {
  if (!rule || typeof rule !== 'object' || rule.source === 'starter') return rule;
  return {
    ...rule,
    ...(typeof rule.field === 'string' ? { field: renameKey(rule.field, renames) } : {}),
    ...(typeof rule.aggregateField === 'string' ? { aggregateField: renameKey(rule.aggregateField, renames) } : {}),
  };
}

function renameConditionGroups(groups: unknown, renames: Record<string, string>): unknown {
  if (!Array.isArray(groups)) return groups;
  return groups.map((g) => {
    if (!g || typeof g !== 'object' || !Array.isArray((g as { rules?: unknown }).rules)) return g;
    const group = g as { rules: Array<Record<string, unknown>> };
    return { ...group, rules: group.rules.map((r) => renameConditionRule(r, renames)) };
  });
}

/** 重写节点配置（扁平 nodes[].data 与流程树 props 共用同一批字段名） */
function renameNodeProps(props: Record<string, unknown>, renames: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...props };
  // 字段权限表：键为表单字段 key
  if (out.fieldPermissions && typeof out.fieldPermissions === 'object') {
    out.fieldPermissions = renameRecordKeys(out.fieldPermissions as Record<string, unknown>, renames);
  }
  // 直接存字段 key 的标量属性
  for (const prop of ['formUserField', 'formDeptField', 'targetDate', 'subProcessMultiSource', 'subProcessInitiatorField', 'routeFieldKey'] as const) {
    if (typeof out[prop] === 'string') out[prop] = renameKey(out[prop], renames);
  }
  // 子流程出参映射：键为父表单字段 key（值为子表单字段，不动）
  if (out.subProcessOutputMapping && typeof out.subProcessOutputMapping === 'object') {
    out.subProcessOutputMapping = renameRecordKeys(out.subProcessOutputMapping as Record<string, unknown>, renames);
  }
  // 子流程入参映射：值为 {{form.父字段}} 模板（键为子表单字段，不动）
  if (out.subProcessFieldMapping && typeof out.subProcessFieldMapping === 'object') {
    out.subProcessFieldMapping = Object.fromEntries(
      Object.entries(out.subProcessFieldMapping as Record<string, unknown>)
        .map(([k, v]) => [k, typeof v === 'string' ? renameFormTemplateRefs(v, renames) : v]),
    );
  }
  // 触发器配置：模板占位 + 操作字段列表 + 字段更新映射
  const trigger = out.triggerConfig;
  if (trigger && typeof trigger === 'object') {
    const tc = { ...(trigger as Record<string, unknown>) };
    if (typeof tc.bodyTemplate === 'string') tc.bodyTemplate = renameFormTemplateRefs(tc.bodyTemplate, renames);
    if (Array.isArray(tc.fieldKeys)) tc.fieldKeys = tc.fieldKeys.map((k) => renameKey(k, renames));
    if (tc.fieldValues && typeof tc.fieldValues === 'object') {
      const renamedValues = Object.fromEntries(
        Object.entries(tc.fieldValues as Record<string, unknown>)
          .map(([k, v]) => [k, typeof v === 'string' ? renameFormTemplateRefs(v, renames) : v]),
      );
      tc.fieldValues = renameRecordKeys(renamedValues, renames);
    }
    out.triggerConfig = tc;
  }
  // 设计器树 props 中触发器配置尚未收敛进 triggerConfig（保存时才转换），同名顶层属性同样处理
  if (typeof out.bodyTemplate === 'string') out.bodyTemplate = renameFormTemplateRefs(out.bodyTemplate, renames);
  if (Array.isArray(out.fieldKeys)) out.fieldKeys = out.fieldKeys.map((k) => renameKey(k, renames));
  if (out.fieldValues && typeof out.fieldValues === 'object' && !Array.isArray(out.fieldValues)) {
    const renamedValues = Object.fromEntries(
      Object.entries(out.fieldValues as Record<string, unknown>)
        .map(([k, v]) => [k, typeof v === 'string' ? renameFormTemplateRefs(v, renames) : v]),
    );
    out.fieldValues = renameRecordKeys(renamedValues, renames);
  }
  return out;
}

/** 递归重写钉钉风格流程树节点（props + 分支条件 + 子节点） */
function renameProcessNode(node: Record<string, unknown>, renames: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...node };
  if (out.props && typeof out.props === 'object') {
    out.props = renameNodeProps(out.props as Record<string, unknown>, renames);
  }
  if (Array.isArray(out.branches)) {
    out.branches = out.branches.map((b) => {
      if (!b || typeof b !== 'object') return b;
      const branch = { ...(b as Record<string, unknown>) };
      if (branch.conditions) branch.conditions = renameConditionGroups(branch.conditions, renames);
      if (branch.children && typeof branch.children === 'object') {
        branch.children = renameProcessNode(branch.children as Record<string, unknown>, renames);
      }
      return branch;
    });
  }
  if (out.children && typeof out.children === 'object') {
    out.children = renameProcessNode(out.children as Record<string, unknown>, renames);
  }
  return out;
}

/**
 * 表单字段 key 批量重命名后，级联重写流程定义 flowData 中的所有表单字段引用。
 *
 * 覆盖位置：
 * - 扁平 nodes[].data：fieldPermissions 键、formUserField/formDeptField、延迟节点 targetDate、
 *   子流程 multiSource/initiatorField/出参映射键/入参映射 {{form.x}}、触发器 bodyTemplate/fieldKeys/fieldValues、routeFieldKey
 * - edges[].condition / conditions[]：source≠'starter' 的 rules[].field 与 aggregateField
 * - process 流程树（设计器结构）：同构 props + branches[].conditions 递归
 * - settings.summaryFields 摘要字段、settings.serialNo.template 中 {FORM.key} 占位
 *
 * 返回新对象，不修改入参；renames 为空时原样返回。
 */
export function renameWorkflowFormFieldKeys(
  flowData: WorkflowFlowData,
  renames: Record<string, string>,
): WorkflowFlowData {
  const entries = Object.entries(renames).filter(([o, n]) => o && n && o !== n);
  if (entries.length === 0) return flowData;
  const map = Object.fromEntries(entries);

  const nodes = (flowData.nodes ?? []).map((n) => ({
    ...n,
    data: renameNodeProps(n.data as unknown as Record<string, unknown>, map) as unknown as WorkflowNodeConfig,
  }));

  const edges = (flowData.edges ?? []).map((e) => ({
    ...e,
    ...(e.condition ? { condition: renameConditionRule(e.condition, map) } : {}),
    ...(e.conditions ? { conditions: renameConditionGroups(e.conditions, map) as typeof e.conditions } : {}),
  }));

  const out: WorkflowFlowData = { ...flowData, nodes, edges };

  if (flowData.process && typeof flowData.process === 'object') {
    const process = { ...flowData.process };
    if (process.initiator && typeof process.initiator === 'object') {
      process.initiator = renameProcessNode(process.initiator as Record<string, unknown>, map);
    }
    out.process = process;
  }

  if (flowData.settings) {
    const settings = { ...flowData.settings };
    if (Array.isArray(settings.summaryFields)) {
      settings.summaryFields = settings.summaryFields.map((k) => (k in map ? map[k] : k));
    }
    if (settings.serialNo?.template) {
      settings.serialNo = { ...settings.serialNo, template: renameSerialTemplateRefs(settings.serialNo.template, map) };
    }
    out.settings = settings;
  }

  return out;
}
