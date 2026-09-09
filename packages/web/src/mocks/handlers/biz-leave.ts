import { bizLeaveContract } from '@zenith/shared/biz';
import type { BizLeave } from '@zenith/shared/biz';
import type { WorkflowInstance, WorkflowTask } from '@zenith/shared/workflow';
import { mock } from '@/mocks/utils/contract';
import { removeByIds, requireItem } from '@/mocks/utils/crud';
import { badRequest } from '@/mocks/utils/handlers';
import { mockBizLeaves, getNextLeaveId } from '@/mocks/data/biz-leave';
import {
  buildFirstApproveTask,
  getNextInstanceId,
  mockWorkflowDefinitions,
  mockWorkflowInstances,
  mockWorkflowTasks,
} from '@/mocks/data/workflow';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';

export const bizLeaveHandlers = [
  // 列表（我的请假）
  mock(bizLeaveContract.list, ({ query, ok, paginate }) => {
    const keyword = (query.keyword ?? '').trim().toLowerCase();
    let list = [...mockBizLeaves].sort((a, b) => b.id - a.id);
    if (query.status) list = list.filter((l) => l.status === query.status);
    if (keyword) list = filterByKeyword(list, keyword, [(l) => l.reason], { caseInsensitive: true });
    return ok(paginate(list));
  }),

  // 审批查看详情（供工作流参与者）
  mock(bizLeaveContract.approvalDetail, ({ params, ok }) => {
    const leave = requireItem(mockBizLeaves, params.id, '请假单不存在');
    return ok(leave);
  }),

  // 提交审批：发起并关联工作流（mock 简化：置 pending + 关联一个实例 id）
  mock(bizLeaveContract.submit, ({ params, ok }) => {
    const leave = requireItem(mockBizLeaves, params.id, '请假单不存在');
    if (leave.status !== 'draft') return badRequest('该请假单已提交，无法重复提交');
    const def = mockWorkflowDefinitions.find((item) => item.name === '请假审批' && item.formType === 'external' && item.status === 'published');
    if (!def) return badRequest('未找到已发布的「请假审批」业务系统主导流程定义');
    const now = mockDateTime();
    const instanceId = getNextInstanceId();
    const firstTask = buildFirstApproveTask(def, instanceId, now);
    const tasks: WorkflowTask[] = firstTask ? [firstTask] : [];
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
      currentNodeKey: firstTask?.nodeKey ?? null,
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
    return ok(leave, '已提交审批');
  }),

  // 重新编辑：驳回/取消 → 草稿（旧实例已终态，重新提交将发起新流程）
  mock(bizLeaveContract.reopen, ({ params, ok }) => {
    const leave = requireItem(mockBizLeaves, params.id, '请假单不存在');
    if (leave.status !== 'rejected' && leave.status !== 'cancelled') {
      return badRequest('仅已驳回或已取消的请假单可重新编辑');
    }
    leave.status = 'draft';
    leave.workflowInstanceId = null;
    leave.workflowStatus = null;
    leave.updatedAt = mockDateTime();
    return ok(leave, '已转为草稿');
  }),

  // 详情
  mock(bizLeaveContract.detail, ({ params, ok }) => {
    const leave = requireItem(mockBizLeaves, params.id, '请假单不存在');
    return ok(leave);
  }),

  // 新建（草稿）：body 即 CreateBizLeaveInput（已校验、已补默认值）
  mock(bizLeaveContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const leave: BizLeave = {
      id: getNextLeaveId(),
      leaveType: body.leaveType,
      startDate: body.startDate,
      endDate: body.endDate,
      days: body.days,
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
    return ok(leave, '创建成功');
  }),

  // 编辑（仅草稿）
  mock(bizLeaveContract.update, ({ params, body, ok }) => {
    const leave = requireItem(mockBizLeaves, params.id, '请假单不存在');
    if (leave.status !== 'draft') return badRequest('仅草稿状态可编辑');
    Object.assign(leave, {
      leaveType: body.leaveType ?? leave.leaveType,
      startDate: body.startDate ?? leave.startDate,
      endDate: body.endDate ?? leave.endDate,
      days: body.days ?? leave.days,
      reason: body.reason ?? leave.reason,
      updatedAt: mockDateTime(),
    });
    return ok(leave, '更新成功');
  }),

  // 删除（仅草稿）
  mock(bizLeaveContract.remove, ({ params, ok }) => {
    const item = requireItem(mockBizLeaves, params.id, '请假单不存在');
    if (item.status !== 'draft') return badRequest('仅草稿状态可删除');
    removeByIds(mockBizLeaves, [params.id]);
    return ok(null, '已删除');
  }),
];
