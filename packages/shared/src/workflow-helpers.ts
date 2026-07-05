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

// ─── 待办/列表摘要字段（钉钉式卡片摘要）────────────────────────────────────────
//
// 流程「更多设置」可配置 `summaryFields`（≤3 个字段 key），待办/申请列表在标题下
// 直接展示关键表单值。以下纯函数供「后端列表映射 / MSW Mock / 设计器选项过滤」共用。

export const WORKFLOW_SUMMARY_MAX_FIELDS = 3;

/** 布局与复杂值类型不适合做摘要（无标量文本表示或值为 ID/文件对象） */
const SUMMARY_EXCLUDED_FIELD_TYPES = new Set([
  'row', 'tabs', 'steps', 'group', 'divider', 'description', 'detail',
  'attachment', 'image', 'signature', 'richtext', 'userSelect', 'deptSelect', 'relation', 'password',
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
