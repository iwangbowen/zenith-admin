import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowTask,
} from '@zenith/shared';

// ─── 流程定义 ──────────────────────────────────────────────────────────────

const LEAVE_FLOW_DATA = {
  nodes: [
    { id: 'start_1', type: 'start', position: { x: 300, y: 50 }, data: { key: 'start_1', type: 'start' as const, label: '开始' } },
    { id: 'approve_1', type: 'approve', position: { x: 300, y: 150 }, data: { key: 'approve_1', type: 'approve' as const, label: '直属主管审批', assigneeId: 2, assigneeName: '李四' } },
    { id: 'gw_1', type: 'exclusiveGateway', position: { x: 300, y: 280 }, data: { key: 'gw_1', type: 'exclusiveGateway' as const, label: '请假时长判断' } },
    { id: 'approve_2', type: 'approve', position: { x: 150, y: 400 }, data: { key: 'approve_2', type: 'approve' as const, label: 'HR 审批', assigneeId: 3, assigneeName: '王五' } },
    { id: 'cc_1', type: 'ccNode', position: { x: 450, y: 400 }, data: { key: 'cc_1', type: 'ccNode' as const, label: '抄送HR', assigneeIds: [3], assigneeNames: ['王五'] } },
    { id: 'end_1', type: 'end', position: { x: 300, y: 520 }, data: { key: 'end_1', type: 'end' as const, label: '结束' } },
  ],
  edges: [
    { id: 'e1', source: 'start_1', target: 'approve_1' },
    { id: 'e2', source: 'approve_1', target: 'gw_1' },
    { id: 'e3', source: 'gw_1', target: 'approve_2', condition: { field: 'days', operator: 'gte' as const, value: 3 } },
    { id: 'e4', source: 'gw_1', target: 'cc_1', condition: null, label: '< 3天' },
    { id: 'e5', source: 'approve_2', target: 'end_1' },
    { id: 'e6', source: 'cc_1', target: 'end_1' },
  ],
};

const EXPENSE_FLOW_DATA = {
  nodes: [
    { id: 'start_1', type: 'start', position: { x: 300, y: 50 }, data: { key: 'start_1', type: 'start' as const, label: '开始' } },
    { id: 'approve_1', type: 'approve', position: { x: 300, y: 150 }, data: { key: 'approve_1', type: 'approve' as const, label: '部门主管审批', assigneeId: 2, assigneeName: '李四' } },
    { id: 'approve_2', type: 'approve', position: { x: 300, y: 280 }, data: { key: 'approve_2', type: 'approve' as const, label: '财务审批', assigneeId: 4, assigneeName: '赵六' } },
    { id: 'end_1', type: 'end', position: { x: 300, y: 400 }, data: { key: 'end_1', type: 'end' as const, label: '结束' } },
  ],
  edges: [
    { id: 'e1', source: 'start_1', target: 'approve_1' },
    { id: 'e2', source: 'approve_1', target: 'approve_2' },
    { id: 'e3', source: 'approve_2', target: 'end_1' },
  ],
};

export const mockWorkflowDefinitions: WorkflowDefinition[] = [
  {
    id: 1,
    name: '请假申请',
    description: '适用于各类请假场景，包括年假、病假、事假等',
    flowData: LEAVE_FLOW_DATA,
    formFields: [
      { key: 'leaveType', label: '请假类型', type: 'select', required: true, options: ['年假', '病假', '事假', '陪产假', '婚假'] },
      { key: 'startDate', label: '开始日期', type: 'date', required: true },
      { key: 'endDate', label: '结束日期', type: 'date', required: true },
      { key: 'days', label: '请假天数', type: 'number', required: true },
      { key: 'reason', label: '请假原因', type: 'textarea', required: false },
    ],
    status: 'published',
    version: 3,
    tenantId: 1,
    createdBy: 1,
    createdByName: '张三',
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-02-15T10:30:00.000Z',
  },
  {
    id: 2,
    name: '费用报销',
    description: '员工日常差旅、办公用品等费用报销申请',
    flowData: EXPENSE_FLOW_DATA,
    formFields: [
      { key: 'expenseType', label: '报销类型', type: 'select', required: true, options: ['差旅费', '交通费', '餐饮费', '办公用品', '其他'] },
      { key: 'amount', label: '报销金额', type: 'amount', required: true, currency: 'CNY', precision: 2 },
      { key: 'occurDate', label: '发生日期', type: 'date', required: true },
      { key: 'description', label: '费用说明', type: 'textarea', required: true },
      { key: 'receipts', label: '票据附件', type: 'attachment', maxCount: 10 },
    ],
    status: 'published',
    version: 2,
    tenantId: 1,
    createdBy: 1,
    createdByName: '张三',
    createdAt: '2026-01-15T09:00:00.000Z',
    updatedAt: '2026-03-01T14:00:00.000Z',
  },
  {
    id: 3,
    name: '采购申请',
    description: '设备、物资采购审批流程',
    flowData: null,
    formFields: [
      { key: 'itemName', label: '采购物品', type: 'text', required: true },
      { key: 'quantity', label: '数量', type: 'number', required: true },
      { key: 'estimatedCost', label: '预估金额', type: 'amount', required: true, currency: 'CNY', precision: 2 },
      { key: 'purpose', label: '用途说明', type: 'textarea', required: true },
      { key: 'tags', label: '物品标签', type: 'multiSelect', options: ['办公用品', '电子设备', '家具', '软件', '其他'] },
      { key: 'photos', label: '参考图片', type: 'image', maxCount: 5 },
    ],
    status: 'draft',
    version: 1,
    tenantId: 1,
    createdBy: 2,
    createdByName: '李四',
    createdAt: '2026-03-20T11:00:00.000Z',
    updatedAt: '2026-03-20T11:00:00.000Z',
  },
  {
    id: 4,
    name: '离职申请',
    description: '员工离职流程，包含多部门并行审批',
    flowData: {
      nodes: [
        { id: 'start_1', type: 'start', position: { x: 300, y: 50 }, data: { key: 'start_1', type: 'start' as const, label: '开始' } },
        { id: 'approve_1', type: 'approve', position: { x: 300, y: 150 }, data: { key: 'approve_1', type: 'approve' as const, label: 'HR 审批', assigneeId: 3, assigneeName: '王五' } },
        { id: 'end_1', type: 'end', position: { x: 300, y: 280 }, data: { key: 'end_1', type: 'end' as const, label: '结束' } },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'approve_1' },
        { id: 'e2', source: 'approve_1', target: 'end_1' },
      ],
    },
    formFields: [
      { key: 'resignDate', label: '期望离职日期', type: 'date', required: true },
      { key: 'reason', label: '离职原因', type: 'textarea', required: true },
    ],
    status: 'disabled',
    version: 5,
    tenantId: 1,
    createdBy: 1,
    createdByName: '张三',
    createdAt: '2025-12-01T08:00:00.000Z',
    updatedAt: '2026-01-05T16:00:00.000Z',
  },
];

// ─── 流程任务 ──────────────────────────────────────────────────────────────

export const mockWorkflowTasks: WorkflowTask[] = [
  // 实例 1 的任务（已审批完成）
  {
    id: 1,
    instanceId: 1,
    nodeKey: 'approve_1',
    nodeName: '直属主管审批',
    nodeType: 'approve',
    assigneeId: 2,
    assigneeName: '李四',
    assigneeAvatar: null,
    status: 'approved',
    comment: '同意，注意按时归来。',
    actionAt: '2026-03-15T10:30:00.000Z',
    createdAt: '2026-03-14T09:00:00.000Z',
  },
  {
    id: 2,
    instanceId: 1,
    nodeKey: 'cc_1',
    nodeName: '抄送HR',
    nodeType: 'ccNode',
    assigneeId: 3,
    assigneeName: '王五',
    assigneeAvatar: null,
    status: 'approved',
    comment: null,
    actionAt: '2026-03-15T10:31:00.000Z',
    createdAt: '2026-03-15T10:31:00.000Z',
  },
  // 实例 2 的任务（审批中）
  {
    id: 3,
    instanceId: 2,
    nodeKey: 'approve_1',
    nodeName: '部门主管审批',
    nodeType: 'approve',
    assigneeId: 2,
    assigneeName: '李四',
    assigneeAvatar: null,
    status: 'approved',
    comment: '金额合理，同意。',
    actionAt: '2026-03-28T14:00:00.000Z',
    createdAt: '2026-03-27T16:00:00.000Z',
  },
  {
    id: 4,
    instanceId: 2,
    nodeKey: 'approve_2',
    nodeName: '财务审批',
    nodeType: 'approve',
    assigneeId: 4,
    assigneeName: '赵六',
    assigneeAvatar: null,
    status: 'pending',
    comment: null,
    actionAt: null,
    createdAt: '2026-03-28T14:01:00.000Z',
  },
  // 实例 3 的任务（待审批 - 作为待我审批的数据，assigneeId=1 即当前登录用户）
  {
    id: 5,
    instanceId: 3,
    nodeKey: 'approve_1',
    nodeName: '直属主管审批',
    nodeType: 'approve',
    assigneeId: 1,
    assigneeName: '张三',
    assigneeAvatar: null,
    status: 'pending',
    comment: null,
    actionAt: null,
    createdAt: '2026-04-01T10:00:00.000Z',
  },
  // 实例 4 的任务（已驳回）
  {
    id: 6,
    instanceId: 4,
    nodeKey: 'approve_1',
    nodeName: '部门主管审批',
    nodeType: 'approve',
    assigneeId: 2,
    assigneeName: '李四',
    assigneeAvatar: null,
    status: 'rejected',
    comment: '金额偏高，请重新评估。',
    actionAt: '2026-03-22T11:00:00.000Z',
    createdAt: '2026-03-21T09:00:00.000Z',
  },
];

// ─── 流程实例 ──────────────────────────────────────────────────────────────

export const mockWorkflowInstances: WorkflowInstance[] = [
  {
    id: 1,
    definitionId: 1,
    definitionName: '请假申请',
    title: '张三的请假申请 - 年假 3 天',
    formData: { leaveType: '年假', startDate: '2026-03-16', endDate: '2026-03-18', days: 3, reason: '家庭事务处理' },
    status: 'approved',
    currentNodeKey: null,
    initiatorId: 1,
    initiatorName: '张三',
    initiatorAvatar: null,
    tenantId: 1,
    tasks: mockWorkflowTasks.filter(t => t.instanceId === 1),
    createdAt: '2026-03-14T09:00:00.000Z',
    updatedAt: '2026-03-15T10:31:00.000Z',
  },
  {
    id: 2,
    definitionId: 2,
    definitionName: '费用报销',
    title: '张三的差旅报销申请 - ¥1,280',
    formData: { expenseType: '差旅费', amount: 1280, occurDate: '2026-03-25', description: '出差上海参加技术峰会' },
    status: 'running',
    currentNodeKey: 'approve_2',
    initiatorId: 1,
    initiatorName: '张三',
    initiatorAvatar: null,
    tenantId: 1,
    tasks: mockWorkflowTasks.filter(t => t.instanceId === 2),
    createdAt: '2026-03-27T16:00:00.000Z',
    updatedAt: '2026-03-28T14:01:00.000Z',
  },
  {
    id: 3,
    definitionId: 1,
    definitionName: '请假申请',
    title: '王五的请假申请 - 病假 2 天',
    formData: { leaveType: '病假', startDate: '2026-04-03', endDate: '2026-04-04', days: 2, reason: '感冒发烧就医' },
    status: 'running',
    currentNodeKey: 'approve_1',
    initiatorId: 3,
    initiatorName: '王五',
    initiatorAvatar: null,
    tenantId: 1,
    tasks: mockWorkflowTasks.filter(t => t.instanceId === 3),
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
  },
  {
    id: 4,
    definitionId: 2,
    definitionName: '费用报销',
    title: '李四的办公用品采购报销 - ¥3,600',
    formData: { expenseType: '办公用品', amount: 3600, occurDate: '2026-03-20', description: '采购员工工位设备' },
    status: 'rejected',
    currentNodeKey: null,
    initiatorId: 2,
    initiatorName: '李四',
    initiatorAvatar: null,
    tenantId: 1,
    tasks: mockWorkflowTasks.filter(t => t.instanceId === 4),
    createdAt: '2026-03-21T09:00:00.000Z',
    updatedAt: '2026-03-22T11:00:00.000Z',
  },
];

// 下一个 ID（用于创建新实例）
let nextInstanceId = mockWorkflowInstances.length + 1;
let nextTaskId = mockWorkflowTasks.length + 1;
let nextDefinitionId = mockWorkflowDefinitions.length + 1;

export function getNextInstanceId() { return nextInstanceId++; }
export function getNextTaskId() { return nextTaskId++; }
export function getNextDefinitionId() { return nextDefinitionId++; }
