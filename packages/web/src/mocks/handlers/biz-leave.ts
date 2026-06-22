import { http, HttpResponse } from 'msw';
import type { BizLeave, WorkflowInstance, WorkflowTask } from '@zenith/shared';
import { mockBizLeaves, getNextLeaveId } from '@/mocks/data/biz-leave';
import {
  getNextInstanceId,
  getNextTaskId,
  mockWorkflowDefinitions,
  mockWorkflowInstances,
  mockWorkflowTasks,
} from '@/mocks/data/workflow';
import { mockDateTime } from '@/mocks/utils/date';

export const bizLeaveHandlers = [
  // 列表（我的请假）
  http.get('/api/biz/leaves', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 10);
    const status = url.searchParams.get('status') ?? '';
    const keyword = (url.searchParams.get('keyword') ?? '').trim().toLowerCase();
    let list = [...mockBizLeaves].sort((a, b) => b.id - a.id);
    if (status) list = list.filter((l) => l.status === status);
    if (keyword) list = list.filter((l) => (l.reason ?? '').toLowerCase().includes(keyword));
    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list: paged, total, page, pageSize } });
  }),

  // 审批查看详情（供工作流参与者）
  http.get('/api/biz/leaves/:id/detail', ({ params }) => {
    const leave = mockBizLeaves.find((l) => l.id === Number(params.id));
    if (!leave) return HttpResponse.json({ code: 404, message: '请假单不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: leave });
  }),

  // 提交审批：发起并关联工作流（mock 简化：置 pending + 关联一个实例 id）
  http.post('/api/biz/leaves/:id/submit', ({ params }) => {
    const leave = mockBizLeaves.find((l) => l.id === Number(params.id));
    if (!leave) return HttpResponse.json({ code: 404, message: '请假单不存在', data: null });
    if (leave.status !== 'draft') return HttpResponse.json({ code: 400, message: '该请假单已提交，无法重复提交', data: null });
    const def = mockWorkflowDefinitions.find((item) => item.name === '请假审批' && item.formType === 'external' && item.status === 'published');
    if (!def) return HttpResponse.json({ code: 400, message: '未找到已发布的「请假审批」业务系统主导流程定义', data: null });
    const now = mockDateTime();
    const instanceId = getNextInstanceId();
    const firstApproveNode = def.flowData?.nodes.find((node) => node.data.type === 'approve');
    const tasks: WorkflowTask[] = firstApproveNode ? [{
      id: getNextTaskId(),
      instanceId,
      nodeKey: firstApproveNode.data.key,
      nodeName: firstApproveNode.data.label,
      nodeType: 'approve',
      assigneeId: firstApproveNode.data.assigneeId ?? null,
      assigneeName: firstApproveNode.data.assigneeName ?? null,
      assigneeAvatar: null,
      status: 'pending',
      comment: null,
      actionAt: null,
      createdAt: now,
    }] : [];
    const instance: WorkflowInstance = {
      id: instanceId,
      definitionId: def.id,
      definitionName: def.name,
      title: `请假申请 - ${leave.applicantName ?? '管理员'} - ${leave.startDate}`,
      formData: { days: leave.days, leaveType: leave.leaveType },
      formSnapshot: { formType: 'external', formId: null, formName: null, fields: [], settings: null, customForm: def.customForm },
      definitionSnapshot: {
        id: def.id,
        name: def.name,
        description: def.description,
        categoryId: def.categoryId,
        flowData: def.flowData,
        formId: null,
        formName: null,
        formFields: [],
        formSettings: null,
        formType: 'external',
        customForm: def.customForm,
        status: def.status,
        version: def.version,
        tenantId: def.tenantId,
      },
      status: 'running',
      currentNodeKey: firstApproveNode?.data.key ?? null,
      initiatorId: leave.applicantId ?? 1,
      initiatorName: leave.applicantName ?? '管理员',
      initiatorAvatar: null,
      tenantId: leave.tenantId,
      bizType: 'biz_leave',
      bizId: String(leave.id),
      tasks,
      createdAt: now,
      updatedAt: now,
    };
    mockWorkflowInstances.push(instance);
    mockWorkflowTasks.push(...tasks);
    leave.status = 'pending';
    leave.workflowInstanceId = instanceId;
    leave.workflowStatus = 'running';
    leave.updatedAt = now;
    return HttpResponse.json({ code: 0, message: '已提交审批', data: leave });
  }),

  // 详情
  http.get('/api/biz/leaves/:id', ({ params }) => {
    const leave = mockBizLeaves.find((l) => l.id === Number(params.id));
    if (!leave) return HttpResponse.json({ code: 404, message: '请假单不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: leave });
  }),

  // 新建（草稿）
  http.post('/api/biz/leaves', async ({ request }) => {
    const body = await request.json() as Partial<BizLeave>;
    const now = mockDateTime();
    const leave: BizLeave = {
      id: getNextLeaveId(),
      leaveType: body.leaveType ?? 'annual',
      startDate: body.startDate ?? '',
      endDate: body.endDate ?? '',
      days: body.days ?? 1,
      reason: body.reason ?? null,
      status: 'draft',
      workflowInstanceId: null,
      workflowStatus: null,
      applicantId: 1,
      applicantName: '管理员',
      tenantId: 1,
      createdAt: now,
      updatedAt: now,
    };
    mockBizLeaves.unshift(leave);
    return HttpResponse.json({ code: 0, message: '创建成功', data: leave });
  }),

  // 编辑（仅草稿）
  http.put('/api/biz/leaves/:id', async ({ params, request }) => {
    const leave = mockBizLeaves.find((l) => l.id === Number(params.id));
    if (!leave) return HttpResponse.json({ code: 404, message: '请假单不存在', data: null });
    if (leave.status !== 'draft') return HttpResponse.json({ code: 400, message: '仅草稿状态可编辑', data: null });
    const body = await request.json() as Partial<BizLeave>;
    Object.assign(leave, {
      leaveType: body.leaveType ?? leave.leaveType,
      startDate: body.startDate ?? leave.startDate,
      endDate: body.endDate ?? leave.endDate,
      days: body.days ?? leave.days,
      reason: body.reason ?? leave.reason,
      updatedAt: mockDateTime(),
    });
    return HttpResponse.json({ code: 0, message: '更新成功', data: leave });
  }),

  // 删除（仅草稿）
  http.delete('/api/biz/leaves/:id', ({ params }) => {
    const idx = mockBizLeaves.findIndex((l) => l.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '请假单不存在', data: null });
    if (mockBizLeaves[idx].status !== 'draft') return HttpResponse.json({ code: 400, message: '仅草稿状态可删除', data: null });
    mockBizLeaves.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '已删除', data: null });
  }),
];
