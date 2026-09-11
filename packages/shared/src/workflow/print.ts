/**
 * 审批单打印（纯逻辑，前后端 / Mock 共用）。
 *
 * 三件事：
 * 1. `generateWorkflowPrintContent(fields)`：表单快照 → 报表打印网格版式（24 栏栅格），尊重 row 栅格 /
 *    group / tabs / steps 分段、detail 明细 → 重复块子表、signature → 图片单元格；审批链固定尾部。
 *    服务端在流程未绑定模板时用它即时生成；设计器「从流程表单生成模板」用它作为定制起点。
 * 2. `buildWorkflowPrintDatasets(input)`：实例 → 打印数据集（instance / form / form_fields / form_<明细> /
 *    tasks / cc / comments / consults / attachments），字段值按类型格式化；人员 / 部门 / 字典 / 关联单的名称
 *    由调用方经 `collectWorkflowPrintLookupIds` 批量解析后传入。
 * 3. `describeWorkflowPrintDatasets(fields)`：数据集字段目录，供设计器字段面板与文档。
 *
 * 只从 report 域导入类型：report/validation 运行时依赖 workflow/validation，反向运行时导入会形成 ESM 值环。
 */
import type { ReportPrintCell, ReportPrintCellStyle, ReportPrintContent, ReportPrintMerge, ReportPrintPageConfig, ReportPrintSheet } from '../report/contracts/print';
import type { ReportPrintDatasetRows } from '../report/types';
import type { WorkflowInstance, WorkflowTask } from './contracts/instances';
import type { WorkflowFormField } from './types';
import {
  WORKFLOW_APPROVE_METHOD_LABELS,
  WORKFLOW_INSTANCE_PRIORITY_LABELS,
  WORKFLOW_INSTANCE_STATUS_LABELS,
  WORKFLOW_TASK_STATUS_LABELS,
} from './constants';

type Row = Record<string, unknown>;

// ─── 数据集目录 ───────────────────────────────────────────────────────────────

export interface WorkflowPrintDatasetColumn {
  key: string;
  label: string;
  /** image = 值为图片 data URL，模板中应放图片单元格 */
  kind?: 'text' | 'number' | 'image';
}

export interface WorkflowPrintDatasetDescriptor {
  key: string;
  label: string;
  /** single = 恒为一行（模板任意单元格直接引用）；rows = 多行（需放在重复块内） */
  cardinality: 'single' | 'rows';
  columns: WorkflowPrintDatasetColumn[];
}

/** `instance` 数据集列（同时是审批单主数据集 main，模板中可直接 `${title}` 引用） */
export const WORKFLOW_PRINT_INSTANCE_COLUMNS: WorkflowPrintDatasetColumn[] = [
  { key: 'id', label: '实例 ID', kind: 'number' },
  { key: 'title', label: '标题' },
  { key: 'printTitle', label: '打印标题（流程名称 审批单）' },
  { key: 'serialNo', label: '业务编号' },
  { key: 'definitionName', label: '流程名称' },
  { key: 'categoryName', label: '流程分类' },
  { key: 'initiatorName', label: '发起人' },
  { key: 'initiatorDeptName', label: '发起部门' },
  { key: 'status', label: '状态码' },
  { key: 'statusText', label: '状态' },
  { key: 'priorityText', label: '优先级' },
  { key: 'createdAt', label: '发起时间' },
  { key: 'finishedAt', label: '完成时间' },
  { key: 'currentNodeNames', label: '当前节点' },
  { key: 'bizType', label: '业务类型' },
  { key: 'bizId', label: '业务记录' },
  { key: 'ccNames', label: '抄送人' },
  { key: 'attachmentCount', label: '附件数', kind: 'number' },
  { key: 'printerName', label: '打印人' },
  { key: 'printedAt', label: '打印时间' },
];

export const WORKFLOW_PRINT_TASK_COLUMNS: WorkflowPrintDatasetColumn[] = [
  { key: 'nodeName', label: '审批节点' },
  { key: 'assigneeName', label: '处理人' },
  { key: 'statusText', label: '结果' },
  { key: 'comment', label: '审批意见' },
  { key: 'actionAt', label: '处理时间' },
  { key: 'createdAt', label: '到达时间' },
  { key: 'approveMethodText', label: '审批方式' },
  { key: 'signTypeText', label: '加签 / 转办' },
  { key: 'signature', label: '手写签名', kind: 'image' },
  { key: 'attachmentNames', label: '附件' },
];

const WORKFLOW_PRINT_CC_COLUMNS: WorkflowPrintDatasetColumn[] = [
  { key: 'nodeName', label: '抄送节点' },
  { key: 'assigneeName', label: '抄送人' },
  { key: 'createdAt', label: '抄送时间' },
];

const WORKFLOW_PRINT_COMMENT_COLUMNS: WorkflowPrintDatasetColumn[] = [
  { key: 'userName', label: '评论人' },
  { key: 'content', label: '内容' },
  { key: 'createdAt', label: '时间' },
];

const WORKFLOW_PRINT_CONSULT_COLUMNS: WorkflowPrintDatasetColumn[] = [
  { key: 'nodeName', label: '节点' },
  { key: 'inviterName', label: '邀请人' },
  { key: 'consulteeName', label: '协办人' },
  { key: 'question', label: '问题' },
  { key: 'opinion', label: '意见' },
  { key: 'repliedAt', label: '回复时间' },
];

const WORKFLOW_PRINT_ATTACHMENT_COLUMNS: WorkflowPrintDatasetColumn[] = [
  { key: 'source', label: '来源' },
  { key: 'name', label: '文件名' },
  { key: 'sizeText', label: '大小' },
];

const WORKFLOW_PRINT_FORM_FIELD_COLUMNS: WorkflowPrintDatasetColumn[] = [
  { key: 'key', label: '字段 key' },
  { key: 'label', label: '字段名' },
  { key: 'value', label: '值' },
  { key: 'type', label: '字段类型' },
];

/** 布局容器与说明类字段：无值，不进数据集 */
const LAYOUT_FIELD_TYPES = new Set(['row', 'tabs', 'steps', 'group', 'divider', 'description']);

/** 数据集键 / 字段 token 只允许标识符字符（渲染器按 `.` 取路径，数据集键经 identifier 校验） */
export function workflowPrintFieldKey(key: string): string {
  const safe = key.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(safe) ? safe : `f_${safe}`;
}

/** 明细字段对应的数据集键 */
export function workflowPrintDetailDatasetKey(fieldKey: string): string {
  return `form_${workflowPrintFieldKey(fieldKey)}`.toLowerCase();
}

function isNumericFieldType(type: string): boolean {
  return type === 'number' || type === 'amount' || type === 'slider' || type === 'rate' || type === 'nps';
}

/** 叶子字段（有值的字段）平铺；明细子字段单独作为子表列，不进入平铺结果 */
export function flattenWorkflowPrintLeafFields(fields: WorkflowFormField[]): WorkflowFormField[] {
  const out: WorkflowFormField[] = [];
  const walk = (list: WorkflowFormField[]) => {
    for (const field of list) {
      if (field.type === 'row') { for (const column of field.columns ?? []) walk(column.fields); continue; }
      if (field.type === 'tabs' || field.type === 'steps') { for (const pane of field.panes ?? []) walk(pane.fields); continue; }
      if (field.type === 'group') { walk(field.children ?? []); continue; }
      if (LAYOUT_FIELD_TYPES.has(field.type)) continue;
      if (field.hidden || field.type === 'password') continue;
      out.push(field);
    }
  };
  walk(fields);
  return out;
}

export function describeWorkflowPrintDatasets(fields: WorkflowFormField[]): WorkflowPrintDatasetDescriptor[] {
  const leaves = flattenWorkflowPrintLeafFields(fields);
  const formColumns: WorkflowPrintDatasetColumn[] = leaves.map((field) => ({
    key: workflowPrintFieldKey(field.key),
    label: field.label || field.key,
    kind: field.type === 'signature' ? 'image' : isNumericFieldType(field.type) ? 'number' : 'text',
  }));
  const detailSets: WorkflowPrintDatasetDescriptor[] = leaves
    .filter((field) => field.type === 'detail')
    .map((field) => ({
      key: workflowPrintDetailDatasetKey(field.key),
      label: `明细：${field.label || field.key}`,
      cardinality: 'rows',
      columns: (field.children ?? []).filter((child) => !LAYOUT_FIELD_TYPES.has(child.type)).map((child) => ({
        key: workflowPrintFieldKey(child.key),
        label: child.label || child.key,
        kind: isNumericFieldType(child.type) ? 'number' : 'text',
      })),
    }));
  return [
    { key: 'instance', label: '审批单', cardinality: 'single', columns: WORKFLOW_PRINT_INSTANCE_COLUMNS },
    { key: 'form', label: '表单字段', cardinality: 'single', columns: formColumns },
    { key: 'form_fields', label: '表单字段（逐行）', cardinality: 'rows', columns: WORKFLOW_PRINT_FORM_FIELD_COLUMNS },
    ...detailSets,
    { key: 'tasks', label: '审批记录', cardinality: 'rows', columns: WORKFLOW_PRINT_TASK_COLUMNS },
    { key: 'cc', label: '抄送记录', cardinality: 'rows', columns: WORKFLOW_PRINT_CC_COLUMNS },
    { key: 'comments', label: '沟通评论', cardinality: 'rows', columns: WORKFLOW_PRINT_COMMENT_COLUMNS },
    { key: 'consults', label: '协办意见', cardinality: 'rows', columns: WORKFLOW_PRINT_CONSULT_COLUMNS },
    { key: 'attachments', label: '附件清单', cardinality: 'rows', columns: WORKFLOW_PRINT_ATTACHMENT_COLUMNS },
  ];
}

// ─── 字段值格式化 ─────────────────────────────────────────────────────────────

/** 人员 / 部门 / 字典 / 关联审批单的显示名（由调用方批量解析） */
export interface WorkflowPrintLookups {
  userNames: Map<number, string>;
  deptNames: Map<number, string>;
  /** dictCode → (itemValue → label) */
  dictLabels: Map<string, Map<string, string>>;
  relationTitles: Map<number, string>;
}

export function emptyWorkflowPrintLookups(): WorkflowPrintLookups {
  return { userNames: new Map(), deptNames: new Map(), dictLabels: new Map(), relationTitles: new Map() };
}

export interface WorkflowPrintLookupIds {
  userIds: number[];
  deptIds: number[];
  dictCodes: string[];
  relationIds: number[];
}

function toIdList(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => (typeof item === 'object' && item !== null && 'id' in item ? (item as { id: unknown }).id : item))
    .map((item) => (typeof item === 'number' ? item : Number(item)))
    .filter((item) => Number.isInteger(item) && item > 0);
}

/** 扫描表单数据中需要名称解析的引用（含明细子字段），供服务端一次性批量加载 */
export function collectWorkflowPrintLookupIds(fields: WorkflowFormField[], formData: Row | null | undefined): WorkflowPrintLookupIds {
  const userIds = new Set<number>();
  const deptIds = new Set<number>();
  const dictCodes = new Set<string>();
  const relationIds = new Set<number>();
  const visit = (field: WorkflowFormField, value: unknown) => {
    if (value === null || value === undefined || value === '') return;
    switch (field.type) {
      case 'userSelect': for (const id of toIdList(value)) userIds.add(id); break;
      case 'deptSelect': for (const id of toIdList(value)) deptIds.add(id); break;
      case 'relation': for (const id of toIdList(value)) relationIds.add(id); break;
      case 'dictSelect': if (field.dictCode) dictCodes.add(field.dictCode); break;
      case 'detail': {
        if (!Array.isArray(value)) break;
        for (const row of value) {
          if (typeof row !== 'object' || row === null) continue;
          for (const child of field.children ?? []) visit(child, (row as Row)[child.key]);
        }
        break;
      }
      default: break;
    }
  };
  for (const field of flattenWorkflowPrintLeafFields(fields)) visit(field, formData?.[field.key]);
  return { userIds: [...userIds], deptIds: [...deptIds], dictCodes: [...dictCodes], relationIds: [...relationIds] };
}

function optionLabel(field: WorkflowFormField, value: unknown): string {
  const raw = String(value);
  return field.optionItems?.find((item) => item.value === raw)?.label || raw;
}

/** 千分位 + 精度（不依赖 toLocaleString，服务端 / 浏览器输出一致） */
export function formatWorkflowPrintNumber(value: number, precision?: number): string {
  const fixed = precision !== undefined && precision >= 0 ? value.toFixed(precision) : String(value);
  const [intPart, fracPart] = fixed.split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const digits = sign ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${fracPart !== undefined ? `.${fracPart}` : ''}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fileNames(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => (typeof item === 'object' && item !== null ? String((item as { name?: unknown }).name ?? '') : String(item)))
    .filter(Boolean)
    .join('、');
}

function namesFromLookup(value: unknown, names: Map<number, string>, fallbackPrefix: string): string {
  const ids = toIdList(value);
  if (ids.length === 0) return typeof value === 'string' ? value : '';
  return ids.map((id) => names.get(id) ?? `${fallbackPrefix}${id}`).join('、');
}

/** 单字段值 → 打印文本；无值返回空串（打印件不显示占位符） */
export function formatWorkflowPrintValue(field: WorkflowFormField, value: unknown, lookups: WorkflowPrintLookups): string {
  if (value === null || value === undefined || value === '') return '';
  switch (field.type) {
    case 'switch': return value ? '是' : '否';
    case 'select':
    case 'radio':
    case 'autoComplete':
      return optionLabel(field, value);
    case 'multiSelect':
    case 'checkbox':
    case 'tags':
      return Array.isArray(value) ? value.map((item) => optionLabel(field, item)).join('、') : optionLabel(field, value);
    case 'dateRange':
      return Array.isArray(value) ? value.filter(Boolean).map(String).join(' ~ ') : String(value);
    case 'region':
    case 'cascader':
      return Array.isArray(value) ? value.map(String).join(' / ') : String(value);
    case 'number':
    case 'amount': {
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num)) return String(value);
      const text = formatWorkflowPrintNumber(num, field.type === 'amount' ? (field.precision ?? 2) : field.precision);
      return field.unit ? `${text} ${field.unit}` : text;
    }
    case 'rate': return `${String(value)} 分`;
    case 'slider':
    case 'nps':
      return String(value);
    case 'userSelect': return namesFromLookup(value, lookups.userNames, '用户#');
    case 'deptSelect': return namesFromLookup(value, lookups.deptNames, '部门#');
    case 'relation': return namesFromLookup(value, lookups.relationTitles, '审批单#');
    case 'dictSelect': {
      const labels = field.dictCode ? lookups.dictLabels.get(field.dictCode) : undefined;
      const list = Array.isArray(value) ? value : [value];
      return list.map((item) => labels?.get(String(item)) ?? String(item)).join('、');
    }
    case 'location': {
      if (typeof value !== 'object') return String(value);
      const loc = value as { address?: unknown; lng?: unknown; lat?: unknown };
      if (loc.address) return String(loc.address);
      return loc.lng != null && loc.lat != null ? `${String(loc.lng)}, ${String(loc.lat)}` : '';
    }
    case 'matrix': {
      if (typeof value !== 'object' || Array.isArray(value)) return String(value);
      return Object.entries(value as Row).map(([row, col]) => `${row}：${String(col ?? '')}`).join('；');
    }
    case 'attachment':
    case 'image':
      return fileNames(value);
    case 'signature': return typeof value === 'string' ? value : '';
    case 'richtext': return stripHtml(String(value));
    case 'detail': return Array.isArray(value) ? `共 ${value.length} 行` : '';
    default:
      if (Array.isArray(value)) return value.map(String).join('、');
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

// ─── 数据集构建 ───────────────────────────────────────────────────────────────

export interface WorkflowPrintDatasetInput {
  instance: WorkflowInstance;
  /** 表单快照字段（`normalizeWorkflowFormSnapshot(instance.formSnapshot)?.fields`），custom 表单传空数组 */
  fields: WorkflowFormField[];
  lookups?: WorkflowPrintLookups;
  initiatorDeptName?: string | null;
  printerName: string;
  /** 已按系统时间规范格式化 */
  printedAt: string;
}

function formatBytes(size: unknown): string {
  const bytes = typeof size === 'number' ? size : Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const TASK_SIGN_TYPE_LABELS: Record<string, string> = {
  before: '前加签', after: '后加签', parallel: '并行加签', excluded: '已排除',
};

const TRANSFER_ACTION_LABELS: Record<string, string> = {
  transfer: '转办', delegate: '委派', reassign: '改派', handover: '交接', timeout: '超时升级',
};

/** 真实审批环节：排除运行时留痕行与抄送节点（与详情面板「流转记录」口径一致） */
export function selectWorkflowPrintTasks(tasks: WorkflowTask[] | null | undefined): WorkflowTask[] {
  return (tasks ?? []).filter((task) => task.signType !== 'excluded' && task.nodeType !== 'ccNode');
}

function taskRow(task: WorkflowTask): Row {
  const transfers = (task.transfers ?? []).map((t) => `${TRANSFER_ACTION_LABELS[t.action] ?? t.action}→${t.toUserName ?? `用户#${t.toUserId}`}`);
  const signParts = [
    task.signType && task.signType !== 'excluded' ? TASK_SIGN_TYPE_LABELS[task.signType] : '',
    task.delegatedFromId != null ? (task.delegationMode === 'suggest' ? '委派（建议）' : '委派') : '',
    ...transfers,
  ].filter(Boolean);
  return {
    id: task.id,
    nodeKey: task.nodeKey,
    nodeName: task.nodeName,
    nodeType: task.nodeType ?? '',
    assigneeName: task.assigneeName ?? (task.assigneeId != null ? `用户#${task.assigneeId}` : ''),
    status: task.status,
    statusText: WORKFLOW_TASK_STATUS_LABELS[task.status] ?? task.status,
    comment: task.comment ?? '',
    actionAt: task.actionAt ?? '',
    createdAt: task.createdAt,
    approveMethodText: task.approveMethod ? (WORKFLOW_APPROVE_METHOD_LABELS[task.approveMethod] ?? task.approveMethod) : '',
    signTypeText: signParts.join('；'),
    signature: task.signature ?? '',
    attachmentNames: (task.attachments ?? []).map((a) => a.name).join('、'),
  };
}

export function buildWorkflowPrintDatasets(input: WorkflowPrintDatasetInput): ReportPrintDatasetRows {
  const { instance, fields } = input;
  const lookups = input.lookups ?? emptyWorkflowPrintLookups();
  const formData = (instance.formData ?? {}) as Row;
  const leaves = flattenWorkflowPrintLeafFields(fields);
  const isTerminal = instance.status === 'approved' || instance.status === 'rejected'
    || instance.status === 'withdrawn' || instance.status === 'cancelled';

  const approvalTasks = selectWorkflowPrintTasks(instance.tasks);
  const ccTasks = (instance.tasks ?? []).filter((task) => task.nodeType === 'ccNode' && task.signType !== 'excluded');
  const ccNames = [...new Set(ccTasks.map((task) => task.assigneeName ?? '').filter(Boolean))].join('、');

  const attachments: Row[] = [];
  for (const field of leaves) {
    if (field.type !== 'attachment' && field.type !== 'image') continue;
    const value = formData[field.key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item !== 'object' || item === null) continue;
      const file = item as { name?: unknown; size?: unknown };
      attachments.push({ source: field.label || field.key, name: String(file.name ?? ''), sizeText: formatBytes(file.size) });
    }
  }
  for (const task of instance.tasks ?? []) {
    for (const file of task.attachments ?? []) {
      attachments.push({ source: `${task.nodeName}（${task.assigneeName ?? ''}）`, name: file.name, sizeText: formatBytes(file.size) });
    }
  }

  const instanceRow: Row = {
    id: instance.id,
    title: instance.title,
    printTitle: instance.definitionName ? `${instance.definitionName}审批单` : instance.title,
    serialNo: instance.serialNo ?? '',
    definitionName: instance.definitionName ?? '',
    categoryName: instance.categoryName ?? '',
    initiatorName: instance.initiatorName ?? '',
    initiatorDeptName: input.initiatorDeptName ?? '',
    status: instance.status,
    statusText: WORKFLOW_INSTANCE_STATUS_LABELS[instance.status] ?? instance.status,
    priorityText: instance.priority ? (WORKFLOW_INSTANCE_PRIORITY_LABELS[instance.priority] ?? instance.priority) : '',
    createdAt: instance.createdAt,
    finishedAt: isTerminal ? instance.updatedAt : '',
    currentNodeNames: (instance.currentNodeNames ?? (instance.currentNodeName ? [instance.currentNodeName] : [])).join('、'),
    bizType: instance.bizType ?? '',
    bizId: instance.bizId ?? '',
    ccNames,
    attachmentCount: attachments.length,
    printerName: input.printerName,
    printedAt: input.printedAt,
  };

  const formRow: Row = {};
  const formFieldRows: Row[] = [];
  const datasets: ReportPrintDatasetRows = {};
  for (const field of leaves) {
    const key = workflowPrintFieldKey(field.key);
    const value = formData[field.key];
    const text = formatWorkflowPrintValue(field, value, lookups);
    formRow[key] = text;
    if (field.type !== 'signature') formFieldRows.push({ key, label: field.label || field.key, value: text, type: field.type });
    if (field.type === 'detail') {
      const rows = Array.isArray(value) ? value : [];
      datasets[workflowPrintDetailDatasetKey(field.key)] = rows.map((raw, index) => {
        const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Row;
        const out: Row = { _index: index + 1 };
        for (const child of field.children ?? []) {
          if (LAYOUT_FIELD_TYPES.has(child.type)) continue;
          const childValue = source[child.key];
          // 数值子列保留数值（重复块合计 ${SUM(key)} 需要），其余格式化为文本
          if (isNumericFieldType(child.type)) {
            const num = typeof childValue === 'number' ? childValue : Number(childValue);
            out[workflowPrintFieldKey(child.key)] = childValue === null || childValue === undefined || childValue === '' || !Number.isFinite(num) ? '' : num;
          } else {
            out[workflowPrintFieldKey(child.key)] = formatWorkflowPrintValue(child, childValue, lookups);
          }
        }
        return out;
      });
    }
  }

  datasets.instance = [instanceRow];
  datasets.form = [formRow];
  datasets.form_fields = formFieldRows;
  datasets.tasks = approvalTasks.map(taskRow);
  datasets.cc = ccTasks.map((task) => ({
    nodeName: task.nodeName,
    assigneeName: task.assigneeName ?? '',
    createdAt: task.createdAt,
  }));
  datasets.comments = (instance.comments ?? []).map((comment) => ({
    userName: comment.userName ?? '',
    content: comment.content,
    createdAt: comment.createdAt,
  }));
  datasets.consults = (instance.consults ?? []).map((consult) => ({
    nodeName: consult.nodeName ?? '',
    inviterName: consult.inviterName ?? '',
    consulteeName: consult.consulteeName ?? '',
    question: consult.question ?? '',
    opinion: consult.opinion ?? '',
    repliedAt: consult.repliedAt ?? '',
  }));
  datasets.attachments = attachments;
  return datasets;
}

// ─── 自动版式生成 ─────────────────────────────────────────────────────────────

/** 24 栏栅格：与表单设计器 columnSpan / row.span 语义一致，宽度按 A4 竖版可用宽度取整 */
export const WORKFLOW_PRINT_GRID_COLS = 24;
const COL_WIDTH_PX = 28;
const ROW_HEIGHT = {
  title: 34, subtitle: 20, section: 22, group: 22, field: 26, tall: 52, signature: 64,
  tableHead: 22, tableRow: 24, taskRow: 40, spacer: 8, footer: 18,
} as const;

const THIN = { style: 'thin' as const, color: '#C9CED6' };
const CELL_BORDER = { top: THIN, right: THIN, bottom: THIN, left: THIN };
const STYLE = {
  title: { fontSize: 17, bold: true, color: '#111827', align: 'center', valign: 'middle' },
  subtitle: { fontSize: 9, color: '#6B7280', align: 'center', valign: 'middle' },
  section: { fontSize: 10, bold: true, color: '#111827', background: '#E8EDF3', align: 'left', valign: 'middle', border: CELL_BORDER },
  group: { fontSize: 9.5, bold: true, color: '#1F2937', background: '#F3F5F8', align: 'left', valign: 'middle', border: CELL_BORDER },
  label: { fontSize: 9, bold: true, color: '#374151', background: '#F8FAFC', align: 'left', valign: 'middle', border: CELL_BORDER, wrap: true },
  value: { fontSize: 9.5, color: '#111827', align: 'left', valign: 'middle', border: CELL_BORDER, wrap: true },
  tableHead: { fontSize: 9, bold: true, color: '#374151', background: '#F8FAFC', align: 'center', valign: 'middle', border: CELL_BORDER, wrap: true },
  tableCell: { fontSize: 9, color: '#111827', align: 'left', valign: 'middle', border: CELL_BORDER, wrap: true },
  tableCellCenter: { fontSize: 9, color: '#111827', align: 'center', valign: 'middle', border: CELL_BORDER, wrap: true },
  total: { fontSize: 9, bold: true, color: '#111827', background: '#F8FAFC', align: 'right', valign: 'middle', border: CELL_BORDER },
  footer: { fontSize: 8, color: '#9CA3AF', align: 'right', valign: 'middle' },
  dividerTitle: { fontSize: 9, color: '#6B7280', align: 'center', valign: 'middle' },
} satisfies Record<string, ReportPrintCellStyle>;

export interface WorkflowPrintLayoutOptions {
  /** 是否输出沟通评论段（服务端按实例有无评论决定；设计器生成模板时默认包含） */
  includeComments?: boolean;
  /** 是否输出抄送行 */
  includeCc?: boolean;
  /** 页脚文本（支持 {page} / {pages} / {date}） */
  footer?: string;
}

class GridBuilder {
  rows = 0;
  readonly cells: ReportPrintCell[] = [];
  readonly merges: ReportPrintMerge[] = [];
  readonly rowHeights: number[] = [];
  readonly repeatBlocks: NonNullable<ReportPrintSheet['repeatBlocks']> = [];

  /** 在网格末尾追加一行 */
  addRow(height: number): number {
    this.rowHeights.push(height);
    return this.rows++;
  }

  /**
   * 使用指定行：不存在则补到该行（嵌套栅格列共享同一批行，后排列可能复用前排列已建的行），
   * 已存在则只把行高抬到不低于 height。
   */
  useRow(row: number, height: number): number {
    while (this.rows <= row) this.addRow(height);
    if (height > (this.rowHeights[row] ?? 0)) this.rowHeights[row] = height;
    return row;
  }

  cell(row: number, col: number, colSpan: number, cell: Omit<ReportPrintCell, 'row' | 'col'>, rowSpan = 1): void {
    this.cells.push({ row, col, ...cell });
    if (colSpan > 1 || rowSpan > 1) this.merges.push({ row, col, rowSpan, colSpan });
  }

  text(row: number, col: number, colSpan: number, v: string, s: ReportPrintCellStyle, datasetKey?: string): void {
    this.cell(row, col, colSpan, { v, s, ...(datasetKey ? { datasetKey } : {}) });
  }

  /** 空白带边框占位（补齐栅格短列 / 行尾余量，保持表格封闭） */
  blank(row: number, col: number, colSpan: number, rowSpan = 1): void {
    if (colSpan <= 0 || rowSpan <= 0) return;
    this.cell(row, col, colSpan, { v: '', s: { border: CELL_BORDER } }, rowSpan);
  }

  block(id: string, datasetKey: string, start: number, end: number): void {
    this.repeatBlocks.push({ id, datasetKey, range: { start, end } });
  }
}

/** 字段占用栏数：columnSpan 相对 24 栏；容器内按容器宽度等比缩放，至少 1 栏 */
function fieldUnits(field: WorkflowFormField, containerWidth: number): number {
  const span = field.columnSpan && field.columnSpan > 0 && field.columnSpan < WORKFLOW_PRINT_GRID_COLS ? field.columnSpan : WORKFLOW_PRINT_GRID_COLS;
  if (span >= WORKFLOW_PRINT_GRID_COLS) return containerWidth;
  return Math.max(1, Math.min(containerWidth, Math.round(containerWidth * span / WORKFLOW_PRINT_GRID_COLS)));
}

function labelUnits(width: number): number {
  if (width >= 12) return 4;
  if (width >= 8) return 3;
  return Math.max(1, Math.floor(width / 2));
}

/** 独占整行的字段类型（长文本、明细、签名、文件列表、矩阵） */
const FULL_WIDTH_TYPES = new Set(['textarea', 'richtext', 'detail', 'signature', 'attachment', 'image', 'matrix']);

function distributeUnits(width: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(width / count);
  const remainder = width - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

/** 明细字段 → 标题行 + 列头 + 重复块行（+ 合计行），返回下一个可用行 */
function layoutDetail(grid: GridBuilder, field: WorkflowFormField, x: number, width: number, startRow: number): number {
  const children = (field.children ?? []).filter((child) => !LAYOUT_FIELD_TYPES.has(child.type) && !child.hidden);
  const datasetKey = workflowPrintDetailDatasetKey(field.key);
  let row = startRow;
  grid.text(grid.useRow(row++, ROW_HEIGHT.group), x, width, field.label || field.key, STYLE.group);
  if (children.length === 0) {
    grid.text(grid.useRow(row++, ROW_HEIGHT.field), x, width, '（明细未配置子字段）', STYLE.value);
    return row;
  }
  // 序号列固定 2 栏，其余等分
  const seqUnits = width >= 8 ? 2 : 0;
  const units = distributeUnits(width - seqUnits, children.length);
  const headRow = grid.useRow(row++, ROW_HEIGHT.tableHead);
  let cursor = x;
  if (seqUnits) { grid.text(headRow, cursor, seqUnits, '#', STYLE.tableHead); cursor += seqUnits; }
  children.forEach((child, index) => {
    grid.text(headRow, cursor, units[index], child.label || child.key, STYLE.tableHead);
    cursor += units[index];
  });
  const bodyRow = grid.useRow(row++, ROW_HEIGHT.tableRow);
  cursor = x;
  if (seqUnits) { grid.text(bodyRow, cursor, seqUnits, '${_index}', STYLE.tableCellCenter, datasetKey); cursor += seqUnits; }
  children.forEach((child, index) => {
    const style: ReportPrintCellStyle = isNumericFieldType(child.type) ? { ...STYLE.tableCell, align: 'right' } : STYLE.tableCell;
    grid.text(bodyRow, cursor, units[index], `\${${workflowPrintFieldKey(child.key)}}`, style, datasetKey);
    cursor += units[index];
  });
  grid.block(`detail_${workflowPrintFieldKey(field.key)}`.toLowerCase(), datasetKey, bodyRow, bodyRow);

  const firstSummary = children.findIndex((child) => child.detailSummary && isNumericFieldType(child.type));
  if (firstSummary >= 0) {
    const totalRow = grid.useRow(row++, ROW_HEIGHT.tableRow);
    cursor = x;
    const labelWidth = seqUnits + units.slice(0, firstSummary).reduce((sum, u) => sum + u, 0);
    if (labelWidth > 0) { grid.text(totalRow, cursor, labelWidth, '合计', STYLE.total); cursor += labelWidth; }
    for (let index = firstSummary; index < children.length; index++) {
      const child = children[index];
      if (child.detailSummary && isNumericFieldType(child.type)) {
        grid.text(totalRow, cursor, units[index], `\${SUM(${workflowPrintFieldKey(child.key)})}`, STYLE.total, datasetKey);
      } else {
        grid.blank(totalRow, cursor, units[index]);
      }
      cursor += units[index];
    }
  }
  return row;
}

/** 叶子字段：标签 + 值（签名为图片单元格；长文本抬高行高） */
function layoutLeaf(grid: GridBuilder, field: WorkflowFormField, row: number, x: number, width: number): void {
  const key = workflowPrintFieldKey(field.key);
  const label = labelUnits(width);
  grid.text(row, x, label, field.label || field.key, STYLE.label);
  if (field.type === 'signature') {
    grid.cell(row, x + label, width - label, { kind: 'image', image: { src: `\${${key}}`, fit: 'contain' }, s: { border: CELL_BORDER, valign: 'middle' }, datasetKey: 'form' });
    grid.useRow(row, ROW_HEIGHT.signature);
    return;
  }
  grid.text(row, x + label, width - label, `\${${key}}`, STYLE.value, 'form');
  if (field.type === 'textarea' || field.type === 'richtext' || field.type === 'matrix') grid.useRow(row, ROW_HEIGHT.tall);
}

/**
 * 在 [x, x+width) 栏范围内从 startRow 起流式排布字段，返回下一个可用行。
 * 叶子字段按 columnSpan 并排，放不下换行；容器递归；明细 / 长文本独占整行。
 * 行号只沿本容器推进（嵌套栅格列各自独立计数、共享网格行），网格行不足时按需补建。
 */
function layoutFields(grid: GridBuilder, fields: WorkflowFormField[], x: number, width: number, startRow: number): number {
  let row = startRow;
  let cursor = x;
  let lineOpen = false;
  const closeLine = () => {
    if (!lineOpen) return;
    grid.blank(row, cursor, x + width - cursor);
    row++;
    cursor = x;
    lineOpen = false;
  };

  for (const field of fields) {
    if (field.hidden || field.type === 'password' || field.type === 'description') continue;
    if (field.type === 'divider') {
      closeLine();
      if (field.title) grid.text(grid.useRow(row, ROW_HEIGHT.section), x, width, field.title, STYLE.dividerTitle);
      else grid.useRow(row, ROW_HEIGHT.spacer);
      row++;
      continue;
    }
    if (field.type === 'group') {
      closeLine();
      grid.text(grid.useRow(row, ROW_HEIGHT.group), x, width, field.title || field.label || '', STYLE.group);
      row = layoutFields(grid, field.children ?? [], x, width, row + 1);
      continue;
    }
    if (field.type === 'tabs' || field.type === 'steps') {
      closeLine();
      for (const pane of field.panes ?? []) {
        grid.text(grid.useRow(row, ROW_HEIGHT.group), x, width, pane.title, STYLE.group);
        row = layoutFields(grid, pane.fields, x, width, row + 1);
      }
      continue;
    }
    if (field.type === 'row') {
      closeLine();
      const columns = (field.columns ?? []).filter((column) => column.fields.length > 0);
      if (columns.length === 0) continue;
      const totalSpan = columns.reduce((sum, column) => sum + Math.max(1, column.span), 0);
      const widths = columns.map((column) => Math.max(1, Math.round(width * Math.max(1, column.span) / totalSpan)));
      // 取整误差归到最后一列，保证列宽之和等于容器宽度
      widths[widths.length - 1] += width - widths.reduce((sum, w) => sum + w, 0);
      const top = row;
      let colX = x;
      const ends = columns.map((column, index) => {
        const end = layoutFields(grid, column.fields, colX, widths[index], top);
        colX += widths[index];
        return end;
      });
      const bottom = Math.max(top, ...ends);
      colX = x;
      columns.forEach((_column, index) => {
        if (ends[index] < bottom) grid.blank(ends[index], colX, widths[index], bottom - ends[index]);
        colX += widths[index];
      });
      row = bottom;
      continue;
    }
    if (field.type === 'detail') {
      closeLine();
      row = layoutDetail(grid, field, x, width, row);
      continue;
    }
    const units = FULL_WIDTH_TYPES.has(field.type) ? width : fieldUnits(field, width);
    if (lineOpen && cursor + units > x + width) closeLine();
    if (!lineOpen) {
      grid.useRow(row, ROW_HEIGHT.field);
      lineOpen = true;
    }
    layoutLeaf(grid, field, row, cursor, units);
    cursor += units;
    if (cursor >= x + width) closeLine();
  }
  closeLine();
  return row;
}

/**
 * 表单快照 → 审批单打印内容（单 sheet，主数据集为 instance）。
 * 输出可直接交给 renderPrintContent(name, content, [instanceRow], {}, pageConfig, { datasets })。
 */
export function generateWorkflowPrintContent(fields: WorkflowFormField[], options: WorkflowPrintLayoutOptions = {}): ReportPrintContent {
  const W = WORKFLOW_PRINT_GRID_COLS;
  const grid = new GridBuilder();

  grid.text(grid.addRow(ROW_HEIGHT.title), 0, W, '${printTitle}', STYLE.title);
  grid.text(grid.addRow(ROW_HEIGHT.subtitle), 0, W, '编号：${serialNo}    状态：${statusText}    发起时间：${createdAt}', STYLE.subtitle);
  grid.addRow(ROW_HEIGHT.spacer);

  const info: Array<[string, string, string, string]> = [
    ['流程名称', '${definitionName}', '发起人', '${initiatorName}'],
    ['发起部门', '${initiatorDeptName}', '优先级', '${priorityText}'],
    ['业务编号', '${serialNo}', '当前状态', '${statusText}'],
    ['发起时间', '${createdAt}', '完成时间', '${finishedAt}'],
  ];
  grid.text(grid.addRow(ROW_HEIGHT.section), 0, W, '基本信息', STYLE.section);
  for (const [l1, v1, l2, v2] of info) {
    const row = grid.addRow(ROW_HEIGHT.field);
    grid.text(row, 0, 4, l1, STYLE.label);
    grid.text(row, 4, 8, v1, STYLE.value);
    grid.text(row, 12, 4, l2, STYLE.label);
    grid.text(row, 16, 8, v2, STYLE.value);
  }

  grid.text(grid.addRow(ROW_HEIGHT.section), 0, W, '表单内容', STYLE.section);
  if (fields.length === 0) {
    grid.text(grid.addRow(ROW_HEIGHT.field), 0, W, '（该流程使用自定义业务表单，无表单快照）', STYLE.value);
  } else {
    layoutFields(grid, fields, 0, W, grid.rows);
  }

  grid.text(grid.addRow(ROW_HEIGHT.section), 0, W, '审批记录', STYLE.section);
  const taskUnits = [4, 3, 3, 6, 5, 3];
  const taskHeads = ['审批节点', '处理人', '结果', '审批意见', '处理时间', '签名'];
  const headRow = grid.addRow(ROW_HEIGHT.tableHead);
  let cursor = 0;
  taskHeads.forEach((head, index) => { grid.text(headRow, cursor, taskUnits[index], head, STYLE.tableHead); cursor += taskUnits[index]; });
  const taskRowIndex = grid.addRow(ROW_HEIGHT.taskRow);
  cursor = 0;
  const taskCells: Array<[string, ReportPrintCellStyle]> = [
    ['${nodeName}', STYLE.tableCell],
    ['${assigneeName}', STYLE.tableCell],
    ['${statusText}', STYLE.tableCellCenter],
    ['${comment}', STYLE.tableCell],
    ['${actionAt}', STYLE.tableCellCenter],
  ];
  taskCells.forEach(([v, s], index) => { grid.text(taskRowIndex, cursor, taskUnits[index], v, s, 'tasks'); cursor += taskUnits[index]; });
  grid.cell(taskRowIndex, cursor, taskUnits[5], { kind: 'image', image: { src: '${signature}', fit: 'contain' }, s: { border: CELL_BORDER, valign: 'middle' }, datasetKey: 'tasks' });
  grid.block('tasks', 'tasks', taskRowIndex, taskRowIndex);

  if (options.includeCc) {
    const ccRow = grid.addRow(ROW_HEIGHT.field);
    grid.text(ccRow, 0, 4, '抄送', STYLE.label);
    grid.text(ccRow, 4, W - 4, '${ccNames}', STYLE.value);
  }

  if (options.includeComments) {
    grid.text(grid.addRow(ROW_HEIGHT.section), 0, W, '沟通记录', STYLE.section);
    const commentRow = grid.addRow(ROW_HEIGHT.tableRow);
    grid.text(commentRow, 0, 4, '${userName}', STYLE.tableCell, 'comments');
    grid.text(commentRow, 4, 14, '${content}', STYLE.tableCell, 'comments');
    grid.text(commentRow, 18, 6, '${createdAt}', STYLE.tableCellCenter, 'comments');
    grid.block('comments', 'comments', commentRow, commentRow);
  }

  grid.addRow(ROW_HEIGHT.spacer);
  grid.text(grid.addRow(ROW_HEIGHT.footer), 0, W, '打印人：${printerName}    打印时间：${printedAt}', STYLE.footer);

  const sheet: ReportPrintSheet = {
    id: 'approval-sheet',
    name: '审批单',
    grid: {
      rows: grid.rows,
      cols: W,
      colWidths: Array.from({ length: W }, () => COL_WIDTH_PX),
      rowHeights: grid.rowHeights,
      cells: grid.cells,
      merges: grid.merges,
    },
    repeatBlocks: grid.repeatBlocks,
  };
  return {
    sheets: [sheet],
    entityDatasets: describeWorkflowPrintDatasets(fields).map((dataset) => dataset.key),
  };
}

/** 审批单默认页面配置：A4 竖版，页脚页码 */
export function workflowPrintPageConfig(options: WorkflowPrintLayoutOptions = {}): ReportPrintPageConfig {
  return {
    paper: 'A4',
    orientation: 'portrait',
    margin: { top: 12, right: 14, bottom: 12, left: 14 },
    footer: options.footer ?? '第 {page} / {pages} 页',
  };
}
