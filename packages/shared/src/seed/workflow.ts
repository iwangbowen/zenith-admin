import type { WorkflowCustomFormConfig } from '../workflow/types';
import type { WorkflowCategory, WorkflowDataSource, WorkflowDefinition, WorkflowForm } from '../workflow/contracts';
import { SEED_DATE } from './_base';

// ─── 工作流表单库 ───────────────────────────────────────────────────────────────

export const SEED_WORKFLOW_FORMS: WorkflowForm[] = [
  {
    id: 1,
    name: '请假申请表',
    code: 'leave_request',
    description: '员工请假申请通用表单，覆盖年假、病假、事假等场景',
    categoryId: null,
    schema: {
      fields: [
        { key: 'leaveType', label: '请假类型', type: 'select', required: true, options: ['年假', '病假', '事假', '陪产假', '婚假'] },
        { key: 'leaveDates', label: '开始结束日期', type: 'dateRange', required: true, dateFormat: 'yyyy-MM-dd' },
        { key: 'days', label: '请假天数', type: 'number', required: true, unit: '天', min: 0.5, precision: 1, daysFromKey: 'leaveDates' },
        { key: 'reason', label: '请假事由', type: 'textarea', required: true, maxLength: 500 },
      ],
      settings: { description: '请如实填写请假时间与事由，提交后将进入主管审批。', submitButtonText: '提交请假申请', labelPosition: 'top' },
    },
    status: 'enabled',
    revision: 1,
    tenantId: 1,
    createdBy: 1,
    createdByName: '张三',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 2,
    name: '报销申请表',
    code: 'expense_request',
    description: '日常费用、差旅费用报销申请表',
    categoryId: null,
    schema: {
      fields: [
        { key: 'expenseType', label: '报销类型', type: 'select', required: true, options: ['差旅费', '交通费', '餐饮费', '办公用品', '其他'] },
        { key: 'amount', label: '报销金额', type: 'amount', required: true, currency: 'CNY', precision: 2, min: 0, unit: '元' },
        { key: 'totalAmount', label: '预计总金额', type: 'formula', formula: '{amount}', precision: 2, unit: '元', helpText: '用于金额条件审批判断' },
        { key: 'occurDate', label: '发生日期', type: 'date', required: true, dateFormat: 'yyyy-MM-dd' },
        { key: 'description', label: '费用说明', type: 'textarea', required: true, maxLength: 500 },
        { key: 'receipts', label: '票据附件', type: 'attachment', required: true, maxCount: 10, helpText: '请上传发票、行程单等凭证' },
      ],
      settings: { description: '请确认票据真实有效，金额将按审批流程自动流转。', submitButtonText: '提交报销申请', labelPosition: 'top' },
    },
    status: 'enabled',
    revision: 1,
    tenantId: 1,
    createdBy: 1,
    createdByName: '张三',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 3,
    name: '采购申请表',
    code: 'purchase_request',
    description: '设备、物资采购审批表单',
    categoryId: null,
    schema: {
      fields: [
        { key: 'itemName', label: '采购物品', type: 'text', required: true, maxLength: 100 },
        { key: 'quantity', label: '数量', type: 'number', required: true, min: 1, precision: 0, unit: '件' },
        { key: 'estimatedCost', label: '预估金额', type: 'amount', required: true, currency: 'CNY', precision: 2, min: 0, unit: '元' },
        { key: 'purpose', label: '用途说明', type: 'textarea', required: true, maxLength: 500 },
        { key: 'attachments', label: '采购附件', type: 'attachment', maxCount: 5 },
      ],
      settings: { description: '请填写采购用途并上传报价单等附件。', submitButtonText: '提交采购申请', labelPosition: 'top' },
    },
    status: 'enabled',
    revision: 1,
    tenantId: 1,
    createdBy: 2,
    createdByName: '李四',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

// ─── 工作流内置模板 ─────────────────────────────────────────────────────────

export interface SeedWorkflowTemplate {
  id: number;
  name: string;
  code: string;
  description: string;
  categoryName: string | null;
  icon: string | null;
  color: string | null;
  flowData: Record<string, unknown>;
  formSchema: Record<string, unknown> | null;
  sort: number;
  builtin: boolean;
  tenantId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface SeedFlowStep {
  key: string;
  name: string;
  nodeType?: 'approver' | 'handler' | 'cc';
  props?: Record<string, unknown>;
}

const APPROVER_DEFAULT_PROPS: Record<string, unknown> = {
  approvalType: 'manual',
  approveMethod: 'or',
  rejectStrategy: 'terminate',
  emptyStrategy: 'autoApprove',
  fieldPermissions: {},
};

function mapSeedNodeType(t: 'approver' | 'handler' | 'cc'): string {
  if (t === 'handler') return 'handler';
  if (t === 'cc') return 'ccNode';
  return 'approve';
}

/**
 * 构造线性流程的 flowData（含设计器 process 树 + 引擎 nodes/edges 扁平结构）。
 * 与 packages/web 的 designer/utils.ts treeToFlat() 对线性链的输出保持一致：
 * nodes 顺序固定为 [start, end, ...审批节点]，data.key 即节点 key。
 */
function buildLinearFlow(steps: SeedFlowStep[], settings?: Record<string, unknown>): Record<string, unknown> {
  let child: Record<string, unknown> | undefined;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    const nodeType = s.nodeType ?? 'approver';
    const props = nodeType === 'approver' ? { ...APPROVER_DEFAULT_PROPS, ...(s.props ?? {}) } : { ...(s.props ?? {}) };
    child = { id: s.key, key: s.key, type: nodeType, name: s.name, props, children: child };
  }
  const process = {
    initiator: { id: 'initiator', type: 'initiator', name: '发起人', props: { fieldPermissions: {} }, children: child },
  };

  const nodes: Array<Record<string, unknown>> = [
    { id: 'node-start', type: 'workflowNode', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
    { id: 'node-end', type: 'workflowNode', position: { x: 0, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
  ];
  const edges: Array<Record<string, unknown>> = [];
  let prevId = 'node-start';
  for (const s of steps) {
    const nodeType = s.nodeType ?? 'approver';
    const flatId = `node-${s.key}`;
    const props = nodeType === 'approver' ? { ...APPROVER_DEFAULT_PROPS, ...(s.props ?? {}) } : { ...(s.props ?? {}) };
    nodes.push({ id: flatId, type: 'workflowNode', position: { x: 0, y: 0 }, data: { key: s.key, type: mapSeedNodeType(nodeType), label: s.name, ...props } });
    edges.push({ id: `e-${prevId}-${flatId}`, source: prevId, target: flatId });
    prevId = flatId;
  }
  edges.push({ id: `e-${prevId}-node-end`, source: prevId, target: 'node-end' });

  const flow: Record<string, unknown> = { process, nodes, edges };
  if (settings) flow.settings = settings;
  return flow;
}

const TEMPLATE_SETTINGS: Record<string, unknown> = { allowWithdraw: true, allowComment: true, serialNo: { enabled: false } };

// ─── 表单远程数据源 初始数据 ───────────────────────────────────────────────
export const SEED_WORKFLOW_DATA_SOURCES: WorkflowDataSource[] = [
  {
    id: 1,
    name: '示例-用户列表',
    method: 'GET',
    url: 'https://jsonplaceholder.typicode.com/users',
    headers: null,
    itemsPath: null,
    valueField: 'id',
    labelField: 'name',
    keywordParam: null,
    status: 'enabled',
    remark: '公共测试接口，演示远程数据源',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_WORKFLOW_CONNECTORS = [
  {
    id: 1,
    name: '示例 HTTP（httpbin）',
    code: 'demo_httpbin',
    description: '公共回声 API，用于连接器演示与一键测试',
    type: 'http' as const,
    config: { baseUrl: 'https://httpbin.org', method: 'GET' as const, authType: 'none' as const },
    timeoutMs: 10000,
    retryMax: 0,
    circuitBreakerEnabled: true,
    failureThreshold: 5,
    cooldownSec: 60,
    rateLimitEnabled: false,
    rateLimitWindowSec: 1,
    rateLimitMax: 0,
    status: 'enabled' as const,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_WORKFLOW_TEMPLATES: SeedWorkflowTemplate[] = [
  {
    id: 1,
    name: '请假审批',
    code: 'tpl_leave',
    description: '员工请假申请，提交后由直属主管审批。',
    categoryName: '人事行政',
    icon: 'CalendarDays',
    color: '#52c41a',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
    ], { ...TEMPLATE_SETTINGS, summaryFields: ['leaveType', 'leaveDates', 'days'] }),
    formSchema: SEED_WORKFLOW_FORMS[0].schema as unknown as Record<string, unknown>,
    sort: 1,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 2,
    name: '报销审批',
    code: 'tpl_expense',
    description: '费用报销申请，直属主管 + 部门负责人两级审批。',
    categoryName: '财务报销',
    icon: 'Receipt',
    color: '#fa8c16',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
      { key: 'approve_dept_head', name: '部门负责人审批', props: { assigneeType: 'department' } },
    ], { ...TEMPLATE_SETTINGS, summaryFields: ['expenseType', 'amount', 'occurDate'] }),
    formSchema: SEED_WORKFLOW_FORMS[1].schema as unknown as Record<string, unknown>,
    sort: 2,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 3,
    name: '采购申请',
    code: 'tpl_purchase',
    description: '物资/设备采购申请，直属主管审批后抄送发起人。',
    categoryName: '采购审批',
    icon: 'ShoppingCart',
    color: '#1890ff',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
      { key: 'cc_initiator', name: '抄送发起人', nodeType: 'cc', props: { assigneeType: 'initiator', onlyOnApprove: true, fieldPermissions: {} } },
    ], TEMPLATE_SETTINGS),
    formSchema: SEED_WORKFLOW_FORMS[2].schema as unknown as Record<string, unknown>,
    sort: 3,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 4,
    name: '加班申请',
    code: 'tpl_overtime',
    description: '员工加班申请，直属主管审批。',
    categoryName: '人事行政',
    icon: 'Clock',
    color: '#13c2c2',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
    ], TEMPLATE_SETTINGS),
    formSchema: {
      fields: [
        { key: 'overtimeDate', label: '加班日期', type: 'date', required: true, dateFormat: 'yyyy-MM-dd' },
        { key: 'overtimeRange', label: '加班时间段', type: 'text', required: true, maxLength: 50, placeholder: '如 18:00-21:00' },
        { key: 'hours', label: '加班时长(小时)', type: 'number', required: true, min: 0.5, precision: 1, unit: '小时' },
        { key: 'reason', label: '加班事由', type: 'textarea', required: true, maxLength: 500 },
      ],
      settings: { description: '请如实填写加班时间与事由。', submitButtonText: '提交加班申请', labelPosition: 'top' },
    },
    sort: 4,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 5,
    name: '外出申请',
    code: 'tpl_outing',
    description: '因公外出报备，直属主管审批后抄送发起人。',
    categoryName: '人事行政',
    icon: 'MapPin',
    color: '#2f54eb',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
      { key: 'cc_initiator', name: '抄送发起人', nodeType: 'cc', props: { assigneeType: 'initiator', onlyOnApprove: true, fieldPermissions: {} } },
    ], TEMPLATE_SETTINGS),
    formSchema: {
      fields: [
        { key: 'outDates', label: '外出时间', type: 'dateRange', required: true, dateFormat: 'yyyy-MM-dd HH:mm' },
        { key: 'destination', label: '外出地点', type: 'text', required: true, maxLength: 100 },
        { key: 'reason', label: '外出事由', type: 'textarea', required: true, maxLength: 500 },
      ],
      settings: { description: '因公外出请提前报备。', submitButtonText: '提交外出申请', labelPosition: 'top' },
    },
    sort: 5,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 6,
    name: '转正申请',
    code: 'tpl_regular',
    description: '试用期转正，直属主管 + 部门负责人两级审批。',
    categoryName: '人事行政',
    icon: 'UserCheck',
    color: '#52c41a',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管评估', props: { assigneeType: 'manager', managerLevel: 1 } },
      { key: 'approve_dept_head', name: '部门负责人审批', props: { assigneeType: 'department' } },
    ], TEMPLATE_SETTINGS),
    formSchema: {
      fields: [
        { key: 'entryDate', label: '入职日期', type: 'date', required: true, dateFormat: 'yyyy-MM-dd' },
        { key: 'regularDate', label: '期望转正日期', type: 'date', required: true, dateFormat: 'yyyy-MM-dd' },
        { key: 'summary', label: '试用期工作总结', type: 'textarea', required: true, maxLength: 1000 },
        { key: 'attachments', label: '附件', type: 'attachment', maxCount: 5 },
      ],
      settings: { description: '请填写试用期工作总结。', submitButtonText: '提交转正申请', labelPosition: 'top' },
    },
    sort: 6,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 7,
    name: '用章申请',
    code: 'tpl_seal',
    description: '公司用章/盖章申请，直属主管 + 部门负责人审批。',
    categoryName: '人事行政',
    icon: 'Stamp',
    color: '#fa541c',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
      { key: 'approve_dept_head', name: '部门负责人审批', props: { assigneeType: 'department' } },
    ], TEMPLATE_SETTINGS),
    formSchema: {
      fields: [
        { key: 'sealType', label: '印章类型', type: 'select', required: true, options: ['公章', '合同章', '财务章', '法人章'] },
        { key: 'useFor', label: '用章事由', type: 'textarea', required: true, maxLength: 500 },
        { key: 'count', label: '盖章份数', type: 'number', required: true, min: 1, precision: 0, unit: '份' },
        { key: 'files', label: '待盖章文件', type: 'attachment', required: true, maxCount: 10 },
      ],
      settings: { description: '请上传待盖章文件并说明用途。', submitButtonText: '提交用章申请', labelPosition: 'top' },
    },
    sort: 7,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 8,
    name: '付款申请',
    code: 'tpl_payment',
    description: '对外付款申请，直属主管 + 部门负责人两级审批。',
    categoryName: '财务报销',
    icon: 'CreditCard',
    color: '#fa8c16',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
      { key: 'approve_dept_head', name: '部门负责人审批', props: { assigneeType: 'department' } },
    ], TEMPLATE_SETTINGS),
    formSchema: {
      fields: [
        { key: 'payee', label: '收款方', type: 'text', required: true, maxLength: 100 },
        { key: 'amount', label: '付款金额', type: 'amount', required: true, currency: 'CNY', precision: 2, min: 0, unit: '元' },
        { key: 'payDate', label: '期望付款日期', type: 'date', required: true, dateFormat: 'yyyy-MM-dd' },
        { key: 'purpose', label: '付款用途', type: 'textarea', required: true, maxLength: 500 },
        { key: 'invoice', label: '发票/合同附件', type: 'attachment', required: true, maxCount: 10 },
      ],
      settings: { description: '请上传发票或合同凭证。', submitButtonText: '提交付款申请', labelPosition: 'top' },
    },
    sort: 8,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

// ─── 流程定义（业务接入示例：请假审批，formType=external）────────────────────────
export interface SeedWorkflowDefinition {
  id: number;
  name: string;
  description: string;
  initiatorScopeType: WorkflowDefinition['initiatorScopeType'];
  flowData: Record<string, unknown>;
  formType: WorkflowDefinition['formType'];
  customForm: WorkflowCustomFormConfig;
  status: WorkflowDefinition['status'];
  version: number;
  tenantId: number | null;
}

// 由「请假管理」业务模块通过 startWorkflowForBiz 发起并关联；审批人查看 LeaveApprovalView。
// 不指定显式 id（避免 serial 序列冲突），biz-leave 服务按名称查找该已发布定义。
export const SEED_WORKFLOW_DEFINITIONS: SeedWorkflowDefinition[] = [
  {
    id: 1,
    name: '请假审批',
    description: '业务接入示例：由「请假管理」业务模块发起并关联的审批流程（formType=external）',
    initiatorScopeType: 'all',
    flowData: buildLinearFlow(
      [{ key: 'approve_admin', name: '管理员审批', props: { assigneeType: 'user', assigneeIds: [1] } }],
      TEMPLATE_SETTINGS,
    ),
    formType: 'external',
    customForm: {
      createComponent: '',
      viewComponent: 'biz/leave/LeaveApprovalView',
      icon: 'CalendarClock',
      variables: [{ key: 'days', label: '请假天数', type: 'number' }],
    },
    status: 'published',
    version: 1,
    tenantId: null,
  },
  {
    id: 2,
    name: 'CMS 内容审核',
    description: 'CMS 站点开启工作流审核模式后，内容提交审核时自动发起本流程；审批通过自动发布并刷新静态页，驳回回写驳回状态',
    initiatorScopeType: 'all',
    flowData: buildLinearFlow(
      [{ key: 'approve_editor', name: '主编审核', props: { assigneeType: 'user', assigneeIds: [1] } }],
      TEMPLATE_SETTINGS,
    ),
    formType: 'external',
    customForm: {
      createComponent: '',
      viewComponent: 'cms/ContentApprovalView',
      icon: 'FileCheck',
      variables: [
        { key: 'siteName', label: '所属站点', type: 'string' },
        { key: 'channelName', label: '所属栏目', type: 'string' },
        { key: 'contentTitle', label: '内容标题', type: 'string' },
      ],
    },
    status: 'published',
    version: 1,
    tenantId: null,
  },
];

// ─── 工作流分类 ─────────────────────────────────────────────────────────────────

export const SEED_WORKFLOW_CATEGORIES: WorkflowCategory[] = [
  { id: 1, name: '采购审批', code: 'purchase',  icon: 'ShoppingCart', color: '#1890ff', sort: 1, description: '采购申请相关审批流程', tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '人事行政', code: 'hr',         icon: 'Users',        color: '#52c41a', sort: 2, description: '人事及行政审批流程',   tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '财务报销', code: 'finance',    icon: 'DollarSign',   color: '#fa8c16', sort: 3, description: '财务费用报销流程',     tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, name: 'IT运维',   code: 'it',         icon: 'Monitor',      color: '#722ed1', sort: 4, description: 'IT及运维相关审批',     tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];
