import { fillPath } from '@zenith/shared/core';
import { planWorkflowPath, selectWorkflowPathBranches, workflowAttachmentContract } from '@zenith/shared/workflow';
import type { WorkflowDefinition, WorkflowDefinitionVersion, WorkflowInstance, WorkflowTask, WorkflowFormField, WorkflowInstanceFormSnapshot, WorkflowFlowData } from '@zenith/shared/workflow';
import { SEED_WORKFLOW_DEFINITIONS, SEED_DATE } from '@zenith/shared/seed';
import { nextIdFrom } from '@/mocks/utils/handlers';
import { mockUsers } from './users';
import { mockWorkflowForms } from './workflow-forms';
import { createMockActivation, getMockApprovalActivations } from '@/mocks/utils/workflow-approval';

/** 流程定义版本的派生字段：表单字段数组 */
function cloneWorkflowFormFields(formId: number | null | undefined): WorkflowFormField[] | null {
  const fields = mockWorkflowForms.find((form) => form.id === formId)?.schema?.fields ?? null;
  return fields ? JSON.parse(JSON.stringify(fields)) as WorkflowFormField[] : null;
}

/** 与服务端 buildInstanceFormSnapshot 同构：实例发起时冻结的表单快照 */
function buildMockFormSnapshot(formId: number | null | undefined): WorkflowInstanceFormSnapshot | null {
  const form = mockWorkflowForms.find((item) => item.id === formId);
  const fields = cloneWorkflowFormFields(formId);
  if (!fields) return null;
  return {
    formType: 'designer',
    formId: form?.id ?? null,
    formName: form?.name ?? null,
    fields,
    settings: form?.schema?.settings ?? null,
    customForm: null,
  };
}

// ─── 流程定义 ──────────────────────────────────────────────────────────────

const LEAVE_FLOW_DATA = {
  nodes: [
    { id: 'start_1', type: 'start', position: { x: 300, y: 50 }, data: { key: 'start_1', type: 'start' as const, label: '开始' } },
    { id: 'approve_1', type: 'approve', position: { x: 300, y: 150 }, data: { key: 'approve_1', type: 'approve' as const, label: '直属主管审批', assigneeId: 2, assigneeName: '李四' } },
    { id: 'gw_1', type: 'exclusiveGateway', position: { x: 300, y: 280 }, data: { key: 'gw_1', type: 'exclusiveGateway' as const, label: '请假时长判断' } },
    { id: 'approve_2', type: 'approve', position: { x: 150, y: 400 }, data: { key: 'approve_2', type: 'approve' as const, label: 'HR 审批', assigneeType: 'approverSelect' as const, selectScopeType: 'user' as const } },
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
  settings: { allowWithdraw: true, allowResubmit: true, notifyInitiator: true, allowComment: true, summaryFields: ['leaveType', 'leaveDates', 'days'] },
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
  settings: { allowWithdraw: true, allowResubmit: true, notifyInitiator: true, allowComment: true, summaryFields: ['expenseType', 'amount', 'occurDate'] },
};

// External 定义与 DB seed 同源；1–6 是其它 Demo 定义，业务定义使用后续 ID。
const mockBusinessDefinitions: WorkflowDefinition[] = SEED_WORKFLOW_DEFINITIONS.map((seed, index) => ({
  ...structuredClone(seed),
  id: 7 + index,
  categoryId: null,
  initiatorScopeIds: null,
  flowData: structuredClone(seed.flowData) as unknown as WorkflowDefinition['flowData'],
  formId: null,
  formFields: null,
  tenantId: 1,
  createdBy: 1,
  createdByName: '张三',
  createdAt: SEED_DATE,
  updatedAt: SEED_DATE,
}));
const bizLeaveDefinition = mockBusinessDefinitions.find((definition) => definition.name === '请假审批')!;
const BIZ_LEAVE_CUSTOM_FORM = bizLeaveDefinition.customForm;

export const mockWorkflowDefinitions: WorkflowDefinition[] = [
  {
    id: 1,
    name: '请假申请',
    description: '适用于各类请假场景，包括年假、病假、事假等',
    categoryId: null,
    initiatorScopeType: 'all',
    initiatorScopeIds: null,
    flowData: LEAVE_FLOW_DATA,
    formId: 1,
    formFields: null,
    formType: 'designer',
    customForm: null,
    status: 'published',
    version: 3,
    tenantId: 1,
    createdBy: 1,
    createdByName: '张三',
    createdAt: '2026-01-10 08:00:00',
    updatedAt: '2026-02-15 10:30:00',
  },
  {
    id: 2,
    name: '费用报销',
    description: '员工日常差旅、办公用品等费用报销申请',
    categoryId: null,
    initiatorScopeType: 'departments',
    initiatorScopeIds: [1],
    flowData: EXPENSE_FLOW_DATA,
    formId: 2,
    formFields: null,
    formType: 'designer',
    customForm: null,
    status: 'published',
    version: 2,
    tenantId: 1,
    createdBy: 1,
    createdByName: '张三',
    createdAt: '2026-01-15 09:00:00',
    updatedAt: '2026-03-01 14:00:00',
  },
  {
    id: 3,
    name: '采购申请',
    description: '设备、物资采购审批流程',
    categoryId: null,
    initiatorScopeType: 'users',
    initiatorScopeIds: [2],
    flowData: null,
    formId: 3,
    formFields: null,
    formType: 'designer',
    customForm: null,
    status: 'draft',
    version: 1,
    tenantId: 1,
    createdBy: 2,
    createdByName: '李四',
    createdAt: '2026-03-20 11:00:00',
    updatedAt: '2026-03-20 11:00:00',
  },
  {
    id: 4,
    name: '离职申请',
    description: '员工离职流程，包含多部门并行审批',
    categoryId: null,
    initiatorScopeType: 'roles',
    initiatorScopeIds: [1],
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
    formId: 1,
    formFields: null,
    formType: 'designer',
    customForm: null,
    status: 'disabled',
    version: 5,
    tenantId: 1,
    createdBy: 1,
    createdByName: '张三',
    createdAt: '2025-12-01 08:00:00',
    updatedAt: '2026-01-05 16:00:00',
  },
  {
    id: 5,
    name: '出差报销审批（综合测试）',
    description: '综合测试流程：覆盖多种新表单控件 + 复杂审批流程（条件分支、抄送、加签）',
    categoryId: null,
    initiatorScopeType: 'all',
    initiatorScopeIds: null,
    flowData: {
  "nodes": [
    {
      "id": "root",
      "position": {
        "x": 300,
        "y": 0
      },
      "data": {
        "key": "root",
        "type": "start",
        "label": "发起人"
      }
    },
    {
      "id": "manager",
      "position": {
        "x": 300,
        "y": 140
      },
      "data": {
        "key": "manager",
        "type": "approve",
        "label": "直属主管审批",
        "assigneeType": "manager",
        "managerLevel": 1,
        "approveMethod": "or"
      }
    },
    {
      "id": "branch_amount",
      "position": {
        "x": 300,
        "y": 280
      },
      "data": {
        "key": "branch_amount",
        "type": "exclusiveGateway",
        "label": "金额条件分支"
      }
    },
    {
      "id": "dept_head",
      "position": {
        "x": 300,
        "y": 420
      },
      "data": {
        "key": "dept_head",
        "type": "approve",
        "label": "部门经理",
        "assigneeType": "role",
        "roleIds": [2],
        "approveMethod": "or"
      }
    },
    {
      "id": "gm",
      "position": {
        "x": 300,
        "y": 560
      },
      "data": {
        "key": "gm",
        "type": "approve",
        "label": "总经理审批",
        "assigneeType": "user",
        "assigneeIds": [
          1
        ],
        "assigneeNames": [
          "张三"
        ],
        "approveMethod": "or"
      }
    },
    {
      "id": "finance",
      "position": {
        "x": 300,
        "y": 700
      },
      "data": {
        "key": "finance",
        "type": "approve",
        "label": "财务审核",
        "assigneeType": "user",
        "assigneeIds": [
          4
        ],
        "assigneeNames": [
          "赵六"
        ],
        "approveMethod": "or"
      }
    },
    {
      "id": "cc_hr",
      "position": {
        "x": 300,
        "y": 840
      },
      "data": {
        "key": "cc_hr",
        "type": "ccNode",
        "label": "抄送 HR",
        "assigneeType": "user",
        "assigneeIds": [
          3
        ],
        "assigneeNames": [
          "王五"
        ]
      }
    },
    {
      "id": "end",
      "position": {
        "x": 300,
        "y": 980
      },
      "data": {
        "key": "end",
        "type": "end",
        "label": "结束"
      }
    }
  ],
  "edges": [
    {
      "id": "travel_e0",
      "source": "root",
      "target": "manager"
    },
    {
      "id": "travel_e1",
      "source": "manager",
      "target": "branch_amount"
    },
    {
      "id": "travel_e2",
      "source": "branch_amount",
      "target": "dept_head",
      "label": "金额 ≤ 5000",
      "condition": {
        "field": "totalAmount",
        "operator": "lte",
        "value": 5000
      }
    },
    {
      "id": "travel_e3",
      "source": "branch_amount",
      "target": "gm",
      "label": "金额 > 5000",
      "isDefault": true
    },
    {
      "id": "travel_e4",
      "source": "dept_head",
      "target": "finance"
    },
    {
      "id": "travel_e5",
      "source": "gm",
      "target": "finance"
    },
    {
      "id": "travel_e6",
      "source": "finance",
      "target": "cc_hr"
    },
    {
      "id": "travel_e7",
      "source": "cc_hr",
      "target": "end"
    }
  ]
},
    formId: 2,
    formFields: null,
    formType: 'designer',
    customForm: null,
    status: 'published',
    version: 1,
    tenantId: 1,
    createdBy: 1,
    createdByName: '张三',
    createdAt: '2026-03-20 09:00:00',
    updatedAt: '2026-03-20 09:00:00',
  },
  {
    id: 6,
    name: '业务系统对接申请（自定义表单示例）',
    description: '演示「自定义业务表单」：发起填写与查看均由 src/pages 下的业务页面承载',
    categoryId: null,
    initiatorScopeType: 'all',
    initiatorScopeIds: null,
    flowData: LEAVE_FLOW_DATA,
    formId: null,
    formFields: null,
    formType: 'custom',
    customForm: {
      createComponent: 'biz/demo/DemoBusinessForm',
      viewComponent: null,
      icon: 'ClipboardList',
      variables: [
        { key: 'amount', label: '金额', type: 'number' },
        { key: 'reason', label: '事由', type: 'string' },
      ],
    },
    status: 'published',
    version: 1,
    tenantId: 1,
    createdBy: 1,
    createdByName: '张三',
    createdAt: '2026-03-25 09:00:00',
    updatedAt: '2026-03-25 09:00:00',
  },
  ...mockBusinessDefinitions,
];

// ─── 流程任务 ──────────────────────────────────────────────────────────────

type LegacyMockTask = Omit<WorkflowTask, 'activationId' | 'slotId' | 'taskKind' | 'waitReason' | 'activatedAt' | 'signPosition'>;
const initialWorkflowTasks: LegacyMockTask[] = [
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
    attachments: [{ id: 1, fileId: '018f6f8a-0900-7000-8000-000000000001', name: '请假佐证材料.pdf', url: fillPath(workflowAttachmentContract.content.fullPath, { id: 1 }), size: 102400, mimeType: 'application/pdf' }],
    actionAt: '2026-03-15 10:30:00',
    createdAt: '2026-03-14 09:00:00',
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
    actionAt: '2026-03-15 10:31:00',
    createdAt: '2026-03-15 10:31:00',
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
    actionAt: '2026-03-28 14:00:00',
    createdAt: '2026-03-27 16:00:00',
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
    createdAt: '2026-03-28 14:01:00',
  },
  // 实例 3 的任务（待审批 - 作为待我审批的数据，assigneeId=1 即当前登录用户；启用转办演示移动端选人）
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
    actionButtons: { transfer: { enabled: true } },
    createdAt: '2026-04-01 10:00:00',
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
    actionAt: '2026-03-22 11:00:00',
    createdAt: '2026-03-21 09:00:00',
  },
  {
    id: 900101,
    instanceId: 9001,
    nodeKey: 'approve_admin',
    nodeName: '管理员审批',
    nodeType: 'approve',
    assigneeId: 1,
    assigneeName: '张三',
    assigneeAvatar: null,
    status: 'approved',
    comment: '同意休假。',
    actionAt: '2026-06-16 10:00:00',
    createdAt: '2026-06-15 09:00:00',
  },
  {
    id: 900201,
    instanceId: 9002,
    nodeKey: 'approve_admin',
    nodeName: '管理员审批',
    nodeType: 'approve',
    assigneeId: 1,
    assigneeName: '张三',
    assigneeAvatar: null,
    status: 'pending',
    comment: null,
    actionAt: null,
    createdAt: '2026-06-22 09:00:00',
  },
  // 实例 5/6 的任务（财务审批待我处理，无签名/自选节点，可批量同意）
  {
    id: 7,
    instanceId: 5,
    nodeKey: 'approve_1',
    nodeName: '部门主管审批',
    nodeType: 'approve',
    assigneeId: 2,
    assigneeName: '李四',
    assigneeAvatar: null,
    status: 'approved',
    comment: '属实，同意。',
    actionAt: '2026-06-24 15:00:00',
    createdAt: '2026-06-24 09:00:00',
  },
  {
    id: 8,
    instanceId: 5,
    nodeKey: 'approve_2',
    nodeName: '财务审批',
    nodeType: 'approve',
    assigneeId: 1,
    assigneeName: '张三',
    assigneeAvatar: null,
    status: 'pending',
    comment: null,
    actionAt: null,
    createdAt: '2026-06-24 15:00:00',
  },
  {
    id: 9,
    instanceId: 6,
    nodeKey: 'approve_1',
    nodeName: '部门主管审批',
    nodeType: 'approve',
    assigneeId: 2,
    assigneeName: '李四',
    assigneeAvatar: null,
    status: 'approved',
    comment: '按预算执行。',
    actionAt: '2026-06-25 11:30:00',
    createdAt: '2026-06-25 09:00:00',
  },
  {
    id: 10,
    instanceId: 6,
    nodeKey: 'approve_2',
    nodeName: '财务审批',
    nodeType: 'approve',
    assigneeId: 1,
    assigneeName: '张三',
    assigneeAvatar: null,
    status: 'pending',
    comment: null,
    actionAt: null,
    createdAt: '2026-06-25 11:30:00',
  },
];

export const mockWorkflowTasks: WorkflowTask[] = initialWorkflowTasks.map(task => ({
  ...task, activationId: null, slotId: null, taskKind: task.nodeType === 'ccNode' ? 'cc' : task.nodeType === 'approve' || task.nodeType === 'handler' ? 'approval' : 'system',
  waitReason: null, activatedAt: task.status === 'pending' ? task.createdAt : null, signPosition: null,
}));

// ─── 流程实例 ──────────────────────────────────────────────────────────────

export const mockWorkflowInstances: WorkflowInstance[] = [
  {
    id: 1,
    definitionId: 1,
    definitionName: '请假申请',
    title: '张三的请假申请 - 年假 3 天',
    formData: { leaveType: '年假', leaveDates: ['2026-03-16', '2026-03-18'], startDate: '2026-03-16', endDate: '2026-03-18', days: 3, reason: '家庭事务处理' },
    formSnapshot: buildMockFormSnapshot(1),
    status: 'approved',
    currentNodeKey: null,
    initiatorId: 1,
    initiatorName: '张三',
    initiatorAvatar: null,
    tenantId: 1,
    tasks: mockWorkflowTasks.filter(t => t.instanceId === 1),
    // 办结时由后台固化的 PDF 存证（Demo 数据仅用于展示「已归档」标识与归档件优先返回）
    archive: { fileId: 'demo-archive-1', sha256: 'a3f1c9d2e4b5670189abcdef0123456789abcdef0123456789abcdef01234567', templateId: null, archivedAt: '2026-03-15 10:31:05' },
    createdAt: '2026-03-14 09:00:00',
    updatedAt: '2026-03-15 10:31:00',
  },
  {
    id: 2,
    definitionId: 2,
    definitionName: '费用报销',
    title: '张三的差旅报销申请 - ¥1,280',
    formData: { expenseType: '差旅费', amount: 1280, totalAmount: 1280, occurDate: '2026-03-25', description: '出差上海参加技术峰会', receipts: [] },
    formSnapshot: buildMockFormSnapshot(2),
    status: 'running',
    currentNodeKey: 'approve_2',
    initiatorId: 1,
    initiatorName: '张三',
    initiatorAvatar: null,
    tenantId: 1,
    tasks: mockWorkflowTasks.filter(t => t.instanceId === 2),
    createdAt: '2026-03-27 16:00:00',
    updatedAt: '2026-03-28 14:01:00',
  },
  {
    id: 3,
    definitionId: 1,
    definitionName: '请假申请',
    title: '王五的请假申请 - 病假 2 天',
    formData: { leaveType: '病假', leaveDates: ['2026-04-03', '2026-04-04'], startDate: '2026-04-03', endDate: '2026-04-04', days: 2, reason: '感冒发烧就医' },
    formSnapshot: buildMockFormSnapshot(1),
    status: 'running',
    currentNodeKey: 'approve_1',
    initiatorId: 3,
    initiatorName: '王五',
    initiatorAvatar: null,
    tenantId: 1,
    tasks: mockWorkflowTasks.filter(t => t.instanceId === 3),
    createdAt: '2026-04-01 10:00:00',
    updatedAt: '2026-04-01 10:00:00',
  },
  {
    id: 5,
    definitionId: 2,
    definitionName: '费用报销',
    title: '王五的市内交通费报销 - ¥420',
    formData: { expenseType: '交通费', amount: 420, totalAmount: 420, occurDate: '2026-06-23', description: '客户拜访打车费用', receipts: [] },
    formSnapshot: buildMockFormSnapshot(2),
    status: 'running',
    currentNodeKey: 'approve_2',
    initiatorId: 3,
    initiatorName: '王五',
    initiatorAvatar: null,
    tenantId: 1,
    tasks: mockWorkflowTasks.filter(t => t.instanceId === 5),
    createdAt: '2026-06-24 09:00:00',
    updatedAt: '2026-06-24 15:00:00',
  },
  {
    id: 6,
    definitionId: 2,
    definitionName: '费用报销',
    title: '赵六的团队建设费用报销 - ¥1,500',
    formData: { expenseType: '团建费', amount: 1500, totalAmount: 1500, occurDate: '2026-06-20', description: '部门季度团建聚餐', receipts: [] },
    formSnapshot: buildMockFormSnapshot(2),
    status: 'running',
    currentNodeKey: 'approve_2',
    initiatorId: 4,
    initiatorName: '赵六',
    initiatorAvatar: null,
    tenantId: 1,
    tasks: mockWorkflowTasks.filter(t => t.instanceId === 6),
    createdAt: '2026-06-25 09:00:00',
    updatedAt: '2026-06-25 11:30:00',
  },
  {
    id: 4,
    definitionId: 2,
    definitionName: '费用报销',
    title: '李四的办公用品采购报销 - ¥3,600',
    formData: { expenseType: '办公用品', amount: 3600, totalAmount: 3600, occurDate: '2026-03-20', description: '采购员工工位设备', receipts: [] },
    formSnapshot: buildMockFormSnapshot(2),
    status: 'rejected',
    currentNodeKey: null,
    initiatorId: 2,
    initiatorName: '李四',
    initiatorAvatar: null,
    tenantId: 1,
    tasks: mockWorkflowTasks.filter(t => t.instanceId === 4),
    createdAt: '2026-03-21 09:00:00',
    updatedAt: '2026-03-22 11:00:00',
  },
  {
    // 子流程演示：由实例 #2（差旅报销）的子流程节点发起的子实例
    id: 5,
    definitionId: 1,
    definitionName: '请假申请',
    title: '张三的差旅报销申请 - ¥1,280 / 用印子流程',
    formData: { leaveType: '用印', reason: '差旅报销用印审批', days: 1 },
    formSnapshot: buildMockFormSnapshot(1),
    status: 'running',
    currentNodeKey: 'approve_1',
    initiatorId: 1,
    initiatorName: '张三',
    initiatorAvatar: null,
    tenantId: 1,
    parentInstanceId: 2,
    parentTaskId: null,
    tasks: mockWorkflowTasks.filter(t => t.instanceId === 5),
    createdAt: '2026-03-28 14:05:00',
    updatedAt: '2026-03-28 14:05:00',
  },
  {
    id: 9001,
    definitionId: 7,
    definitionName: '请假审批',
    title: '年假申请 - 管理员 - 2026-06-20',
    formData: { days: 3, leaveType: 'annual' },
    formSnapshot: { formType: 'external', formId: null, formName: null, fields: [], settings: null, customForm: BIZ_LEAVE_CUSTOM_FORM },
    definitionSnapshot: structuredClone(bizLeaveDefinition),
    status: 'approved',
    currentNodeKey: null,
    initiatorId: 1,
    initiatorName: '管理员',
    initiatorAvatar: null,
    tenantId: 1,
    bizType: 'biz_leave',
    bizId: '1',
    tasks: mockWorkflowTasks.filter(t => t.instanceId === 9001),
    createdAt: '2026-06-15 09:00:00',
    updatedAt: '2026-06-16 10:00:00',
  },
  {
    id: 9002,
    definitionId: 7,
    definitionName: '请假审批',
    title: '病假申请 - 管理员 - 2026-06-22',
    formData: { days: 1, leaveType: 'sick' },
    formSnapshot: { formType: 'external', formId: null, formName: null, fields: [], settings: null, customForm: BIZ_LEAVE_CUSTOM_FORM },
    definitionSnapshot: structuredClone(bizLeaveDefinition),
    status: 'running',
    currentNodeKey: 'approve_admin',
    initiatorId: 1,
    initiatorName: '管理员',
    initiatorAvatar: null,
    tenantId: 1,
    bizType: 'biz_leave',
    bizId: '2',
    tasks: mockWorkflowTasks.filter(t => t.instanceId === 9002),
    createdAt: '2026-06-22 09:00:00',
    updatedAt: '2026-06-22 09:00:00',
  },
];

// 下一个 ID（用于创建新实例）
let nextInstanceId = nextIdFrom(mockWorkflowInstances);
let nextTaskId = nextIdFrom(mockWorkflowTasks);
let nextDefinitionId = nextIdFrom(mockWorkflowDefinitions);

export function getNextInstanceId() { return nextInstanceId++; }
export function getNextTaskId() { return nextTaskId++; }
export function getNextDefinitionId() { return nextDefinitionId++; }

/**
 * 到达人工节点时物化该轮次的全部正式席位。后续激活与计票复用共享审批语义。
 */
export function buildMockApprovalTasks(node: WorkflowFlowData['nodes'][number]['data'], instanceId: number, now: string, initiatorId = 1): WorkflowTask[] {
  const candidates = resolveMockWorkflowAssignees(node, initiatorId);
  const selected = node.approveMethod === 'random' && candidates.length ? [candidates[Math.floor(Math.random() * candidates.length)]] : candidates;
  const rows = [...new Set(selected)].map((assigneeId): WorkflowTask => ({
    id: getNextTaskId(), instanceId, nodeKey: node.key, nodeName: node.label, nodeType: node.type,
    assigneeId, signaturePolicy: node.signaturePolicy ?? 'none', actionButtons: node.actionButtons,
    assigneeName: mockUsers.find(user => user.id === assigneeId)?.nickname ?? node.assigneeName ?? null,
    assigneeAvatar: null, status: 'pending', comment: null, actionAt: null, createdAt: now,
    activationId: null, slotId: null, taskKind: 'approval', waitReason: null, activatedAt: null, signPosition: null,
  }));
  if (rows.length) createMockActivation({ id: instanceId }, node, rows, { now });
  return rows;
}

export function mockWorkflowStarter(userId: number) {
  const user = mockUsers.find(row => row.id === userId);
  return { userId, deptIds: user?.departmentId == null ? [] : [user.departmentId], roleIds: user?.roles.map(role => role.id) ?? [], postIds: user?.positionIds ?? [] };
}

export function mockWorkflowSelectionCandidates(node: WorkflowFlowData['nodes'][number]['data']) {
  const scope = node.selectScopeIds ?? [];
  return mockUsers.filter(user => user.status === 'enabled' && (!scope.length || (node.selectScopeType === 'role'
    ? user.roles.some(role => scope.includes(role.id)) : node.selectScopeType === 'department'
      ? user.departmentId != null && scope.includes(user.departmentId) : node.selectScopeType === 'userGroup' ? false : scope.includes(user.id))));
}

export function resolveMockWorkflowAssignees(node: WorkflowFlowData['nodes'][number]['data'], initiatorId: number): number[] {
  const users = mockUsers.filter(user => user.status === 'enabled');
  if (node.type === 'start' || node.assigneeType === 'initiator') return users.filter(user => user.id === initiatorId).map(user => user.id);
  if (node.assigneeType === 'role') return users.filter(user => user.roles.some(role => node.roleIds?.includes(role.id))).map(user => user.id);
  if (node.assigneeType === 'deptMember') return users.filter(user => user.departmentId != null && node.deptMemberDeptIds?.includes(user.departmentId)).map(user => user.id);
  const configured = node.userIds?.length ? node.userIds : node.assigneeIds?.length ? node.assigneeIds : node.assigneeId == null ? [] : [node.assigneeId];
  return [...new Set(configured)].filter(id => users.some(user => user.id === id));
}

/** Excluded branches require no selection. An uncertain branch must be preselected before launch. */
export function applyMockInitiatorSelections(definition: WorkflowDefinition, formData: Record<string, unknown>, initiatorId: number, selected: Record<string, number[]> = {}): WorkflowFlowData | null {
  if (!definition.flowData) return null;
  const flow = structuredClone(definition.flowData);
  const plan = planWorkflowPath(flow, { formData, formFields: definition.formFields ?? [], starter: mockWorkflowStarter(initiatorId), recomputeDerivedValues: true });
  for (const node of flow.nodes) {
    if (!['initiatorSelect', 'initiatorSelectScope'].includes(node.data.assigneeType ?? '')) continue;
    if (plan.nodes.find(item => item.nodeKey === node.data.key)?.status === 'excluded') continue;
    const candidates = mockWorkflowSelectionCandidates(node.data), ids = [...new Set(selected[node.data.key] ?? [])];
    if (!ids.length || ids.some(id => !candidates.some(user => user.id === id))) throw new Error(`请选择节点「${node.data.label}」范围内的审批人`);
    node.data.userIds = ids; node.data.assigneeIds = ids; node.data.assigneeId = ids.length === 1 ? ids[0] : null;
  }
  return flow;
}

type MockGraphState = { nodes: Map<string, 'done' | 'excluded' | 'active'>; edges: Map<string, boolean>; roots?: string[]; priorActivations?: Set<string> };
const mockGraphStates = new WeakMap<WorkflowInstance, MockGraphState>();

export function resetMockWorkflowGraph(instance: WorkflowInstance, roots?: string[]): void {
  mockGraphStates.set(instance, { nodes: new Map(), edges: new Map(), roots, priorActivations: new Set(getMockApprovalActivations(instance.id).map(activation => activation.id)) });
}

/** Demo supports acyclic human/condition/parallel graphs. Unsupported effects stay explicitly suspended. */
export function advanceMockWorkflowGraph(instance: WorkflowInstance, now: string): void {
  if (instance.status !== 'running') return;
  const flow = instance.definitionSnapshot?.flowData ?? mockWorkflowDefinitions.find(def => def.id === instance.definitionId)?.flowData;
  if (!flow) { instance.status = 'suspended'; instance.suspendReason = 'Demo 无可执行流程图'; return; }
  let state = mockGraphStates.get(instance);
  if (!state) { state = { nodes: new Map(), edges: new Map() }; mockGraphStates.set(instance, state); }
  const graph = state;
  const edges = flow.edges.filter(edge => !edge.isException && flow.nodes.some(node => node.id === edge.target && node.data.type !== 'catchNode'));
  const incoming = (id: string) => edges.filter(edge => edge.target === id);
  const outgoing = (id: string) => edges.filter(edge => edge.source === id);
  const explicitRoots = graph.roots?.map(key => flow.nodes.find(node => node.data.key === key)?.id).filter((id): id is string => !!id);
  const roots = explicitRoots ?? flow.nodes.filter(node => node.data.type === 'start' || !incoming(node.id).length).map(node => node.id);
  const reachable = new Set<string>(), visiting = new Set<string>();
  let cyclic = false;
  const visit = (id: string) => {
    if (visiting.has(id)) { cyclic = true; return; }
    if (reachable.has(id)) return;
    reachable.add(id); visiting.add(id); outgoing(id).forEach(edge => visit(edge.target)); visiting.delete(id);
  };
  roots.forEach(visit);
  const suspend = (reason: string, key: string | null = null) => { instance.status = 'suspended'; instance.currentNodeKey = key; instance.suspendReason = reason; instance.updatedAt = now; };
  if (cyclic) { suspend('Demo 暂不执行循环流程，请在正式环境运行'); return; }
  const finish = (node: WorkflowFlowData['nodes'][number], excluded = false) => {
    const next = outgoing(node.id);
    const choices = selectWorkflowPathBranches(node.data, next, { formData: instance.formData ?? {}, starter: mockWorkflowStarter(instance.initiatorId ?? 1) });
    if (!excluded && choices.some(choice => choice.status === 'unknown')) {
      suspend(`Demo 等待条件确认：${choices.find(choice => choice.status === 'unknown')!.reason}`, node.data.key); return;
    }
    graph.nodes.set(node.id, excluded ? 'excluded' : 'done');
    next.forEach((edge, index) => graph.edges.set(edge.id, !excluded && choices[index].status === 'matched'));
  };
  for (let pass = 0; pass <= flow.nodes.length && instance.status === 'running'; pass++) {
    let changed = false;
    for (const node of flow.nodes) {
      if (!reachable.has(node.id) || ['done', 'excluded'].includes(graph.nodes.get(node.id) ?? '')) continue;
      const parents = incoming(node.id).filter(edge => reachable.has(edge.source));
      if (!roots.includes(node.id) && parents.some(edge => !graph.edges.has(edge.id))) continue;
      if (!roots.includes(node.id) && !parents.some(edge => graph.edges.get(edge.id))) { finish(node, true); changed = true; continue; }
      const config = node.data;
      if (['subProcess', 'trigger', 'delay', 'catchNode'].includes(config.type) || config.externalApproval?.enabled || (config.type === 'routeGateway' && config.decisionRuleKey)) {
        suspend(`Demo 暂不执行「${config.label}」的外部或自动处理，请在正式环境运行`, config.key); break;
      }
      if (config.type === 'approve' || config.type === 'handler') {
        if (config.approvalType === 'autoReject') { instance.status = 'rejected'; instance.currentNodeKey = null; break; }
        if (config.approvalType !== 'autoApprove' && config.approveMethod !== 'auto') {
          const activation = getMockApprovalActivations(instance.id).filter(item => item.nodeKey === config.key && item.status !== 'cancelled' && !graph.priorActivations?.has(item.id)).at(-1);
          if (activation?.status === 'rejected') { instance.status = 'rejected'; instance.currentNodeKey = null; break; }
          if (activation?.status !== 'approved') {
            if (!activation) {
              const tasks = buildMockApprovalTasks(config, instance.id, now, instance.initiatorId ?? 1);
              if (!tasks.length) { suspend(`Demo 无法确定「${config.label}」的审批人，请补充审批人配置`, config.key); break; }
              mockWorkflowTasks.push(...tasks); changed = true;
            }
            graph.nodes.set(node.id, 'active'); continue;
          }
        }
      } else if (config.type === 'ccNode') {
        for (const assigneeId of resolveMockWorkflowAssignees(config, instance.initiatorId ?? 1)) mockWorkflowTasks.push({
          id: getNextTaskId(), instanceId: instance.id, nodeKey: config.key, nodeName: config.label, nodeType: 'ccNode', assigneeId,
          assigneeName: mockUsers.find(user => user.id === assigneeId)?.nickname ?? null, assigneeAvatar: null, status: 'approved', taskKind: 'cc',
          activationId: null, slotId: null, waitReason: null, signPosition: null, activatedAt: now, actionAt: now, comment: null, createdAt: now,
        });
      }
      finish(node); changed = true;
    }
    if (!changed) break;
  }
  instance.tasks = mockWorkflowTasks.filter(task => task.instanceId === instance.id);
  instance.updatedAt = now;
  if (instance.status !== 'running') return;
  const active = getMockApprovalActivations(instance.id).filter(item => item.status === 'active');
  instance.currentNodeKey = active[0]?.nodeKey ?? null;
  const externalPending = instance.tasks.some(task => task.taskKind === 'system' && (task.status === 'pending' || task.status === 'waiting'));
  if (!active.length && !externalPending && [...reachable].every(id => graph.nodes.get(id) === 'done' || graph.nodes.get(id) === 'excluded')) instance.status = 'approved';
  else if (!active.length) suspend('Demo 流程未到达结束，存在未完成的分支');
}

// ─── 流程定义历史版本 ─────────────────────────────────────────────────────

export const mockWorkflowDefinitionVersions: WorkflowDefinitionVersion[] = [
  {
    id: 1,
    definitionId: 1,
    version: 1,
    name: '请假申请',
    description: '初版',
    flowData: LEAVE_FLOW_DATA,
    formId: 1,
    formName: '请假申请表',
    formFields: cloneWorkflowFormFields(1),
    formType: 'designer',
    customForm: null,
    publishedAt: '2026-01-10 08:00:00',
    publishedBy: 1,
    publishedByName: '张三',
    tenantId: 1,
  },
  {
    id: 2,
    definitionId: 1,
    version: 2,
    name: '请假申请',
    description: '调整审批人',
    flowData: LEAVE_FLOW_DATA,
    formId: 1,
    formName: '请假申请表',
    formFields: cloneWorkflowFormFields(1),
    formType: 'designer',
    customForm: null,
    publishedAt: '2026-01-25 10:00:00',
    publishedBy: 1,
    publishedByName: '张三',
    tenantId: 1,
  },
  {
    id: 3,
    definitionId: 1,
    version: 3,
    name: '请假申请',
    description: '增加 HR 节点',
    flowData: LEAVE_FLOW_DATA,
    formId: 1,
    formName: '请假申请表',
    formFields: cloneWorkflowFormFields(1),
    formType: 'designer',
    customForm: null,
    publishedAt: '2026-02-15 10:30:00',
    publishedBy: 1,
    publishedByName: '张三',
    tenantId: 1,
  },
  {
    id: 4,
    definitionId: 2,
    version: 1,
    name: '费用报销',
    description: '初版',
    flowData: EXPENSE_FLOW_DATA,
    formId: 2,
    formName: '报销申请表',
    formFields: cloneWorkflowFormFields(2),
    formType: 'designer',
    customForm: null,
    publishedAt: '2026-01-15 09:00:00',
    publishedBy: 1,
    publishedByName: '张三',
    tenantId: 1,
  },
  {
    id: 5,
    definitionId: 2,
    version: 2,
    name: '费用报销',
    description: '增加票据校验',
    flowData: EXPENSE_FLOW_DATA,
    formId: 2,
    formName: '报销申请表',
    formFields: cloneWorkflowFormFields(2),
    formType: 'designer',
    customForm: null,
    publishedAt: '2026-03-01 14:00:00',
    publishedBy: 1,
    publishedByName: '张三',
    tenantId: 1,
  },
];

let nextDefinitionVersionId = mockWorkflowDefinitionVersions.length + 1;
export function getNextDefinitionVersionId() { return nextDefinitionVersionId++; }
