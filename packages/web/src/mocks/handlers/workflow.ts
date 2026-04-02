import { http, HttpResponse } from 'msw';
import type { WorkflowDefinition, WorkflowInstance, WorkflowTask } from '@zenith/shared';
import {
  mockWorkflowDefinitions,
  mockWorkflowInstances,
  mockWorkflowTasks,
  getNextInstanceId,
  getNextTaskId,
  getNextDefinitionId,
} from '@/mocks/data/workflow';

function ok<T>(data: T) {
  return HttpResponse.json({ code: 0, message: 'ok', data });
}

function err(message: string, code = 400) {
  return HttpResponse.json({ code, message });
}

// ─── 流程定义 Handler ──────────────────────────────────────────────────────

export const workflowHandlers = [
  // 获取流程定义列表（分页 + 搜索 + 状态筛选）
  http.get('/api/workflows/definitions', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';

    let list = [...mockWorkflowDefinitions];
    if (keyword) list = list.filter(d => d.name.includes(keyword) || (d.description ?? '').includes(keyword));
    if (status) list = list.filter(d => d.status === status);

    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize);
    return ok({ list: paged, total, page, pageSize });
  }),

  // 获取已发布的流程定义列表（发起申请时使用）
  http.get('/api/workflows/definitions/published', () => {
    const list = mockWorkflowDefinitions.filter(d => d.status === 'published');
    return ok({ list, total: list.length, page: 1, pageSize: 100 });
  }),

  // 获取单个流程定义
  http.get('/api/workflows/definitions/:id', ({ params }) => {
    const def = mockWorkflowDefinitions.find(d => d.id === Number(params.id));
    if (!def) return err('流程定义不存在', 404);
    return ok(def);
  }),

  // 创建流程定义
  http.post('/api/workflows/definitions', async ({ request }) => {
    const body = await request.json() as Partial<WorkflowDefinition>;
    const now = new Date().toISOString();
    const newDef: WorkflowDefinition = {
      id: getNextDefinitionId(),
      name: body.name ?? '新流程',
      description: body.description ?? null,
      flowData: body.flowData ?? null,
      formFields: body.formFields ?? null,
      status: 'draft',
      version: 1,
      tenantId: 1,
      createdBy: 1,
      createdByName: '张三',
      createdAt: now,
      updatedAt: now,
    };
    mockWorkflowDefinitions.push(newDef);
    return ok(newDef);
  }),

  // 更新流程定义
  http.put('/api/workflows/definitions/:id', async ({ params, request }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    const body = await request.json() as Partial<WorkflowDefinition>;
    const updated = {
      ...mockWorkflowDefinitions[idx],
      ...body,
      id: mockWorkflowDefinitions[idx].id,
      status: mockWorkflowDefinitions[idx].status,
      version: mockWorkflowDefinitions[idx].version + 1,
      updatedAt: new Date().toISOString(),
    };
    mockWorkflowDefinitions[idx] = updated;
    return ok(updated);
  }),

  // 发布流程定义
  http.post('/api/workflows/definitions/:id/publish', ({ params }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    if (!mockWorkflowDefinitions[idx].flowData) return err('流程图不能为空，请先设计流程');
    mockWorkflowDefinitions[idx] = {
      ...mockWorkflowDefinitions[idx],
      status: 'published',
      updatedAt: new Date().toISOString(),
    };
    return ok(mockWorkflowDefinitions[idx]);
  }),

  // 禁用流程定义
  http.post('/api/workflows/definitions/:id/disable', ({ params }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    mockWorkflowDefinitions[idx] = {
      ...mockWorkflowDefinitions[idx],
      status: 'disabled',
      updatedAt: new Date().toISOString(),
    };
    return ok(mockWorkflowDefinitions[idx]);
  }),

  // 删除流程定义
  http.delete('/api/workflows/definitions/:id', ({ params }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    mockWorkflowDefinitions.splice(idx, 1);
    return ok(null);
  }),

  // ─── 流程实例 Handler ──────────────────────────────────────────────────────

  // 我的申请列表（当前用户 initiatorId=1）
  http.get('/api/workflows/instances', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const status = url.searchParams.get('status') ?? '';

    let list = mockWorkflowInstances.filter(i => i.initiatorId === 1);
    if (status) list = list.filter(i => i.status === status);
    list = [...list].sort((a, b) => b.id - a.id);

    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize).map(i => ({
      ...i,
      tasks: undefined, // 列表不返回 tasks
    }));
    return ok({ list: paged, total, page, pageSize });
  }),

  // 待我审批列表（assigneeId=1 且 status=pending 的任务所对应的实例）
  http.get('/api/workflows/instances/pending-mine', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;

    const pendingTaskIds = mockWorkflowTasks
      .filter(t => t.assigneeId === 1 && t.status === 'pending')
      .map(t => ({ instanceId: t.instanceId, taskId: t.id }));

    const list = pendingTaskIds.map(({ instanceId, taskId }) => {
      const inst = mockWorkflowInstances.find(i => i.id === instanceId);
      return inst ? { ...inst, pendingTaskId: taskId, tasks: undefined } : null;
    }).filter(Boolean) as (WorkflowInstance & { pendingTaskId: number })[];

    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize);
    return ok({ list: paged, total, page, pageSize });
  }),

  // 全局流程监控（管理员看板）— 必须在 /instances/:id 之前注册，避免被参数路由捕获
  http.get('/api/workflows/instances/all', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';

    const stats = {
      total: mockWorkflowInstances.length,
      running:   mockWorkflowInstances.filter(i => i.status === 'running').length,
      approved:  mockWorkflowInstances.filter(i => i.status === 'approved').length,
      rejected:  mockWorkflowInstances.filter(i => i.status === 'rejected').length,
      withdrawn: mockWorkflowInstances.filter(i => i.status === 'withdrawn').length,
    };

    let list = [...mockWorkflowInstances];
    if (keyword) list = list.filter(i => i.title.includes(keyword) || (i.definitionName ?? '').includes(keyword));
    if (status) list = list.filter(i => i.status === status);

    const total = list.length;
    const paged = list
      .slice()
      .sort((a, b) => b.id - a.id)
      .slice((page - 1) * pageSize, page * pageSize)
      .map(i => ({ ...i, tasks: undefined }));

    return ok({ stats, list: paged, total, page, pageSize });
  }),

  // 获取流程实例详情（含任务列表）
  http.get('/api/workflows/instances/:id', ({ params }) => {
    const inst = mockWorkflowInstances.find(i => i.id === Number(params.id));
    if (!inst) return err('流程实例不存在', 404);
    const tasks = mockWorkflowTasks.filter(t => t.instanceId === inst.id)
      .sort((a, b) => a.id - b.id);
    return ok({ ...inst, tasks });
  }),

  // 发起流程申请
  http.post('/api/workflows/instances', async ({ request }) => {
    const body = await request.json() as { definitionId: number; title: string; formData: Record<string, unknown> };
    const def = mockWorkflowDefinitions.find(d => d.id === body.definitionId);
    if (!def) return err('流程定义不存在');
    if (def.status !== 'published') return err('该流程未发布，无法发起申请');

    const now = new Date().toISOString();
    const instanceId = getNextInstanceId();

    // 创建初始审批任务（取第一个 approve 节点）
    const firstApproveNode = def.flowData?.nodes.find(n => n.data.type === 'approve');
    const newTasks: WorkflowTask[] = [];
    if (firstApproveNode) {
      newTasks.push({
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
      });
    }

    const newInstance: WorkflowInstance = {
      id: instanceId,
      definitionId: body.definitionId,
      definitionName: def.name,
      title: body.title,
      formData: body.formData,
      status: 'running',
      currentNodeKey: firstApproveNode?.data.key ?? null,
      initiatorId: 1,
      initiatorName: '张三',
      initiatorAvatar: null,
      tenantId: 1,
      tasks: newTasks,
      createdAt: now,
      updatedAt: now,
    };

    mockWorkflowInstances.push(newInstance);
    for (const task of newTasks) mockWorkflowTasks.push(task);

    return ok(newInstance);
  }),

  // 撤回流程实例
  http.post('/api/workflows/instances/:id/withdraw', ({ params }) => {
    const idx = mockWorkflowInstances.findIndex(i => i.id === Number(params.id));
    if (idx === -1) return err('流程实例不存在', 404);
    if (mockWorkflowInstances[idx].status !== 'running') return err('只有审批中的流程才能撤回');
    mockWorkflowInstances[idx] = {
      ...mockWorkflowInstances[idx],
      status: 'withdrawn',
      updatedAt: new Date().toISOString(),
    };
    // 将所有 pending 任务设为 skipped
    mockWorkflowTasks
      .filter(t => t.instanceId === Number(params.id) && t.status === 'pending')
      .forEach(t => {
        t.status = 'skipped';
        t.actionAt = new Date().toISOString();
      });
    return ok(mockWorkflowInstances[idx]);
  }),

  // ─── 审批任务 Handler ──────────────────────────────────────────────────────

  // 审批通过
  http.post('/api/workflows/tasks/:taskId/approve', async ({ params, request }) => {
    const body = await request.json() as { comment?: string };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    if (mockWorkflowTasks[taskIdx].status !== 'pending') return err('该任务已处理');

    const now = new Date().toISOString();
    mockWorkflowTasks[taskIdx] = {
      ...mockWorkflowTasks[taskIdx],
      status: 'approved',
      comment: body.comment ?? null,
      actionAt: now,
    };

    const instanceId = mockWorkflowTasks[taskIdx].instanceId;
    const inst = mockWorkflowInstances.find(i => i.id === instanceId);
    if (inst) {
      // 检查是否还有 pending 任务
      const remainingPending = mockWorkflowTasks.filter(
        t => t.instanceId === instanceId && t.status === 'pending' && t.id !== mockWorkflowTasks[taskIdx].id
      );
      if (remainingPending.length === 0) {
        // 流程完成
        const instIdx = mockWorkflowInstances.findIndex(i => i.id === instanceId);
        if (instIdx !== -1) {
          mockWorkflowInstances[instIdx] = {
            ...mockWorkflowInstances[instIdx],
            status: 'approved',
            currentNodeKey: null,
            updatedAt: now,
          };
        }
      }
    }

    return ok(mockWorkflowTasks[taskIdx]);
  }),

  // 审批驳回
  http.post('/api/workflows/tasks/:taskId/reject', async ({ params, request }) => {
    const body = await request.json() as { comment?: string };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    if (mockWorkflowTasks[taskIdx].status !== 'pending') return err('该任务已处理');

    const now = new Date().toISOString();
    mockWorkflowTasks[taskIdx] = {
      ...mockWorkflowTasks[taskIdx],
      status: 'rejected',
      comment: body.comment ?? null,
      actionAt: now,
    };

    const instanceId = mockWorkflowTasks[taskIdx].instanceId;
    const instIdx = mockWorkflowInstances.findIndex(i => i.id === instanceId);
    if (instIdx !== -1) {
      mockWorkflowInstances[instIdx] = {
        ...mockWorkflowInstances[instIdx],
        status: 'rejected',
        currentNodeKey: null,
        updatedAt: now,
      };
      // 将其他 pending 任务设为 skipped
      mockWorkflowTasks
        .filter(t => t.instanceId === instanceId && t.status === 'pending')
        .forEach(t => {
          t.status = 'skipped';
          t.actionAt = now;
        });
    }

    return ok(mockWorkflowTasks[taskIdx]);
  }),
];
