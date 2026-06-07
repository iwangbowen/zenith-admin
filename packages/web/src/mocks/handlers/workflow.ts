import { http, HttpResponse } from 'msw';
import type { WorkflowDefinition, WorkflowInstance, WorkflowTask, WorkflowTaskUrge } from '@zenith/shared';
import {
  mockWorkflowDefinitions,
  mockWorkflowInstances,
  mockWorkflowTasks,
  mockWorkflowDefinitionVersions,
  getNextInstanceId,
  getNextTaskId,
  getNextDefinitionId,
  getNextDefinitionVersionId,
} from '@/mocks/data/workflow';
import { mockDateTime } from '@/mocks/utils/date';

function ok<T>(data: T) {
  return HttpResponse.json({ code: 0, message: 'ok', data });
}

function err(message: string, code = 400) {
  return HttpResponse.json({ code, message });
}

// 催办流水（内存）
const mockWorkflowUrges: WorkflowTaskUrge[] = [];
let urgeIdSeq = 1;
const URGE_MIN_INTERVAL_MS = 5 * 60 * 1000;

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
    const now = mockDateTime();
    const newDef: WorkflowDefinition = {
      id: getNextDefinitionId(),
      name: body.name ?? '新流程',
      description: body.description ?? null,
      categoryId: body.categoryId ?? null,
      initiatorScopeType: body.initiatorScopeType ?? 'all',
      initiatorScopeIds: body.initiatorScopeType === 'all' ? null : (body.initiatorScopeIds ?? []),
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
    const prev = mockWorkflowDefinitions[idx];
    // 已发布的流程保存后自动转为草稿
    const nextStatus = prev.status === 'published' && body.status === undefined ? 'draft' : prev.status;
    const updated = {
      ...prev,
      ...body,
      id: prev.id,
      status: nextStatus,
      version: prev.version,
      updatedAt: mockDateTime(),
    };
    mockWorkflowDefinitions[idx] = updated;
    return ok(updated);
  }),

  // 发布流程定义
  http.post('/api/workflows/definitions/:id/publish', ({ params }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    if (!mockWorkflowDefinitions[idx].flowData) return err('流程图不能为空，请先设计流程');
    const cur = mockWorkflowDefinitions[idx];
    const newVersion = cur.version + 1;
    const now = mockDateTime();
    // 生成快照
    mockWorkflowDefinitionVersions.push({
      id: getNextDefinitionVersionId(),
      definitionId: cur.id,
      version: newVersion,
      name: cur.name,
      description: cur.description,
      flowData: cur.flowData,
      formFields: cur.formFields,
      publishedAt: now,
      publishedBy: 1,
      publishedByName: '张三',
      tenantId: cur.tenantId,
    });
    mockWorkflowDefinitions[idx] = {
      ...cur,
      status: 'published',
      version: newVersion,
      updatedAt: now,
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
      updatedAt: mockDateTime(),
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

  // 流程定义历史版本列表
  http.get('/api/workflows/definitions/:id/versions', ({ params }) => {
    const definitionId = Number(params.id);
    if (!mockWorkflowDefinitions.some(d => d.id === definitionId)) return err('流程定义不存在', 404);
    const list = mockWorkflowDefinitionVersions
      .filter(v => v.definitionId === definitionId)
      .sort((a, b) => b.version - a.version);
    return ok(list);
  }),

  // 恢复历史版本
  http.post('/api/workflows/definitions/:id/versions/:versionId/restore', ({ params }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    const ver = mockWorkflowDefinitionVersions.find(v => v.id === Number(params.versionId) && v.definitionId === Number(params.id));
    if (!ver) return err('历史版本不存在', 404);
    mockWorkflowDefinitions[idx] = {
      ...mockWorkflowDefinitions[idx],
      name: ver.name,
      description: ver.description,
      flowData: ver.flowData,
      formFields: ver.formFields,
      status: 'draft',
      updatedAt: mockDateTime(),
    };
    return ok(mockWorkflowDefinitions[idx]);
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
    const keyword = url.searchParams.get('keyword') ?? '';
    const definitionIdStr = url.searchParams.get('definitionId') ?? '';
    const definitionId = definitionIdStr ? Number(definitionIdStr) : null;

    const pendingTaskIds = mockWorkflowTasks
      .filter(t => t.assigneeId === 1 && t.status === 'pending')
      .map(t => ({ instanceId: t.instanceId, taskId: t.id }));

    let list = pendingTaskIds.map(({ instanceId, taskId }) => {
      const inst = mockWorkflowInstances.find(i => i.id === instanceId);
      return inst ? { ...inst, pendingTaskId: taskId, tasks: undefined } : null;
    }).filter(Boolean) as (WorkflowInstance & { pendingTaskId: number })[];

    if (keyword) list = list.filter(i => i.title?.includes(keyword));
    if (definitionId !== null) list = list.filter(i => i.definitionId === definitionId);

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
    const categoryIdStr = url.searchParams.get('categoryId') ?? '';
    const initiatorKeyword = url.searchParams.get('initiatorKeyword') ?? '';

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
    if (categoryIdStr) list = list.filter(i => i.categoryId === Number(categoryIdStr));
    if (initiatorKeyword) list = list.filter(i => (i.initiatorName ?? '').includes(initiatorKeyword));

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

    const now = mockDateTime();
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
      updatedAt: mockDateTime(),
    };
    // 将所有 pending 任务设为 skipped
    mockWorkflowTasks
      .filter(t => t.instanceId === Number(params.id) && t.status === 'pending')
      .forEach(t => {
        t.status = 'skipped';
        t.actionAt = mockDateTime();
      });
    return ok(mockWorkflowInstances[idx]);
  }),

  // ─── 审批任务 Handler ──────────────────────────────────────────────────────

  // 审批通过
  http.post('/api/workflows/tasks/:taskId/approve', async ({ params, request }) => {
    const body = await request.json() as { comment?: string; attachments?: Array<{ name: string; url: string; size?: number }> };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    if (mockWorkflowTasks[taskIdx].status !== 'pending') return err('该任务已处理');

    const now = mockDateTime();
    const attachSuffix = body.attachments && body.attachments.length > 0
      ? `\n[附件]${body.attachments.map(a => a.name).join(', ')}`
      : '';
    const current = mockWorkflowTasks[taskIdx];

    // 委派回执：仅关闭当前任务、为原委派人生成新 pending，不推进流程
    if (current.delegatedFromId) {
      const receiptComment = `[委派回执] ${current.assigneeName ?? '审批人'} 建议同意：${body.comment ?? ''}${attachSuffix}`;
      mockWorkflowTasks[taskIdx] = { ...current, status: 'approved', comment: receiptComment, actionAt: now };
      const newTask: WorkflowTask = {
        id: getNextTaskId(),
        instanceId: current.instanceId,
        nodeKey: current.nodeKey,
        nodeName: current.nodeName,
        nodeType: current.nodeType,
        assigneeId: current.delegatedFromId,
        assigneeName: `用户${current.delegatedFromId}`,
        status: 'pending',
        comment: receiptComment,
        actionAt: null,
        originalAssigneeId: current.delegatedFromId,
        transferChain: [],
        delegatedFromId: null,
        actionButtons: current.actionButtons,
        createdAt: now,
      };
      mockWorkflowTasks.push(newTask);
      return HttpResponse.json({ code: 0, message: '已提交委派回执，等待原审批人确认', data: newTask });
    }

    mockWorkflowTasks[taskIdx] = {
      ...current,
      status: 'approved',
      comment: (body.comment ?? '') + attachSuffix || null,
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

    const now = mockDateTime();
    const current = mockWorkflowTasks[taskIdx];

    // 委派回执：仅关闭当前任务、为原委派人生成新 pending，不驳回流程
    if (current.delegatedFromId) {
      const receiptComment = `[委派回执] ${current.assigneeName ?? '审批人'} 建议拒绝：${body.comment ?? ''}`;
      mockWorkflowTasks[taskIdx] = { ...current, status: 'rejected', comment: receiptComment, actionAt: now };
      const newTask: WorkflowTask = {
        id: getNextTaskId(),
        instanceId: current.instanceId,
        nodeKey: current.nodeKey,
        nodeName: current.nodeName,
        nodeType: current.nodeType,
        assigneeId: current.delegatedFromId,
        assigneeName: `用户${current.delegatedFromId}`,
        status: 'pending',
        comment: receiptComment,
        actionAt: null,
        originalAssigneeId: current.delegatedFromId,
        transferChain: [],
        delegatedFromId: null,
        actionButtons: current.actionButtons,
        createdAt: now,
      };
      mockWorkflowTasks.push(newTask);
      return HttpResponse.json({ code: 0, message: '已提交委派回执，等待原审批人确认', data: newTask });
    }

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

  // 转办
  http.post('/api/workflows/tasks/:taskId/transfer', async ({ params, request }) => {
    const body = await request.json() as { targetUserId: number; comment?: string };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    const current = mockWorkflowTasks[taskIdx];
    if (current.status !== 'pending') return err('该任务已处理');
    if (body.targetUserId === current.assigneeId) return err('转办人不能是当前处理人');
    const chain = current.transferChain ?? [];
    const original = current.originalAssigneeId ?? current.assigneeId;
    if (chain.includes(body.targetUserId) || body.targetUserId === original) {
      return err('禁止将任务转回曾经经手的处理人');
    }
    mockWorkflowTasks[taskIdx] = {
      ...current,
      assigneeId: body.targetUserId,
      assigneeName: `用户${body.targetUserId}`,
      comment: `[转办] ${body.comment ?? ''}`,
      originalAssigneeId: current.originalAssigneeId ?? current.assigneeId,
      transferChain: current.assigneeId ? [...chain, current.assigneeId] : chain,
    };
    return ok(mockWorkflowTasks[taskIdx]);
  }),

  // 委派
  http.post('/api/workflows/tasks/:taskId/delegate', async ({ params, request }) => {
    const body = await request.json() as { targetUserId: number; comment?: string };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    const current = mockWorkflowTasks[taskIdx];
    if (current.status !== 'pending') return err('该任务已处理');
    if (body.targetUserId === current.assigneeId) return err('委派人不能是当前处理人');
    const chain = current.transferChain ?? [];
    const original = current.originalAssigneeId ?? current.assigneeId;
    if (chain.includes(body.targetUserId) || body.targetUserId === original) {
      return err('禁止将任务委派给曾经经手的处理人');
    }
    mockWorkflowTasks[taskIdx] = {
      ...current,
      assigneeId: body.targetUserId,
      assigneeName: `用户${body.targetUserId}`,
      comment: `[委派] ${body.comment ?? ''}`,
      originalAssigneeId: current.originalAssigneeId ?? current.assigneeId,
      transferChain: current.assigneeId ? [...chain, current.assigneeId] : chain,
      delegatedFromId: current.delegatedFromId ?? current.assigneeId,
    };
    return ok(mockWorkflowTasks[taskIdx]);
  }),

  // 加签
  http.post('/api/workflows/tasks/:taskId/add-sign', async ({ params, request }) => {
    const body = await request.json() as { targetUserIds: number[]; position: 'before' | 'after' | 'parallel'; comment?: string };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    const current = mockWorkflowTasks[taskIdx];
    if (current.status !== 'pending') return err('该任务已处理');
    const now = mockDateTime();
    if (body.position === 'before') {
      mockWorkflowTasks[taskIdx] = { ...current, status: 'waiting' };
    }
    body.targetUserIds.forEach(uid => {
      mockWorkflowTasks.push({
        id: getNextTaskId(),
        instanceId: current.instanceId,
        nodeKey: current.nodeKey,
        nodeName: current.nodeName,
        nodeType: current.nodeType,
        assigneeId: uid,
        assigneeName: `用户${uid}`,
        assigneeAvatar: null,
        status: 'pending',
        comment: `[加签] ${body.comment ?? ''}`,
        actionAt: null,
        actionButtons: null,
        createdAt: now,
      });
    });
    return HttpResponse.json({ code: 0, message: `已加签 ${body.targetUserIds.length} 人`, data: null });
  }),

  // 减签
  http.post('/api/workflows/tasks/:taskId/reduce-sign', async ({ params, request }) => {
    const body = await request.json() as { targetTaskIds: number[]; comment?: string };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    if (mockWorkflowTasks[taskIdx].status !== 'pending') return err('该任务已处理');
    if (body.targetTaskIds.includes(Number(params.taskId))) return err('不能减去自己');
    const now = mockDateTime();
    const suffix = body.comment ? `：${body.comment}` : '';
    let removed = 0;
    body.targetTaskIds.forEach((tid) => {
      const idx = mockWorkflowTasks.findIndex((t) => t.id === tid);
      if (idx === -1) return;
      const t = mockWorkflowTasks[idx];
      if (t.status !== 'pending' && t.status !== 'waiting') return;
      if (!t.comment?.includes('[加签')) return;
      mockWorkflowTasks[idx] = { ...t, status: 'skipped', actionAt: now, comment: `[减签]${suffix}` };
      removed += 1;
    });
    return HttpResponse.json({ code: 0, message: `已减签 ${removed} 人`, data: null });
  }),

  // 催办：单任务
  http.post('/api/workflows/tasks/:taskId/urge', async ({ params, request }) => {
    const body = await request.json().catch(() => ({})) as { message?: string };
    const taskId = Number(params.taskId);
    const task = mockWorkflowTasks.find(t => t.id === taskId);
    if (!task) return err('任务不存在', 404);
    if (task.status !== 'pending') return err('该任务已处理');
    const inst = mockWorkflowInstances.find(i => i.id === task.instanceId);
    if (!inst) return err('流程不存在', 404);
    if (inst.status !== 'running') return err('流程已结束，无需催办');
    const last = mockWorkflowUrges.filter(u => u.taskId === taskId).sort((a, b) => b.id - a.id)[0];
    if (last && Date.now() - new Date(last.createdAt).getTime() < URGE_MIN_INTERVAL_MS) {
      const wait = Math.ceil((URGE_MIN_INTERVAL_MS - (Date.now() - new Date(last.createdAt).getTime())) / 1000);
      return err(`催办过于频繁，请 ${wait}s 后再试`, 429);
    }
    const row: WorkflowTaskUrge = {
      id: urgeIdSeq++,
      taskId,
      instanceId: inst.id,
      urgerId: 1,
      urgerName: 'admin',
      message: body.message?.trim() || null,
      createdAt: mockDateTime(),
    };
    mockWorkflowUrges.push(row);
    return HttpResponse.json({ code: 0, message: '已催办', data: row });
  }),

  // 催办：单任务历史
  http.get('/api/workflows/tasks/:taskId/urges', ({ params }) => {
    const taskId = Number(params.taskId);
    const list = mockWorkflowUrges.filter(u => u.taskId === taskId).sort((a, b) => b.id - a.id);
    return ok(list);
  }),

  // 催办：实例历史
  http.get('/api/workflows/instances/:id/urges', ({ params }) => {
    const instId = Number(params.id);
    const list = mockWorkflowUrges.filter(u => u.instanceId === instId).sort((a, b) => b.id - a.id);
    return ok(list);
  }),

  // 催办：实例批量
  http.post('/api/workflows/instances/:id/urge', async ({ params, request }) => {
    const body = await request.json().catch(() => ({})) as { message?: string };
    const instId = Number(params.id);
    const inst = mockWorkflowInstances.find(i => i.id === instId);
    if (!inst) return err('流程不存在', 404);
    if (inst.status !== 'running') return err('流程已结束，无需催办');
    const pendings = mockWorkflowTasks.filter(t => t.instanceId === instId && t.status === 'pending');
    if (pendings.length === 0) return err('没有待办任务可催办');
    const now = mockDateTime();
    const nowMs = Date.now();
    const created: WorkflowTaskUrge[] = [];
    let skipped = 0;
    pendings.forEach((task) => {
      const last = mockWorkflowUrges.filter(u => u.taskId === task.id).sort((a, b) => b.id - a.id)[0];
      if (last && nowMs - new Date(last.createdAt).getTime() < URGE_MIN_INTERVAL_MS) {
        skipped += 1;
        return;
      }
      const row: WorkflowTaskUrge = {
        id: urgeIdSeq++,
        taskId: task.id,
        instanceId: instId,
        urgerId: 1,
        urgerName: 'admin',
        message: body.message?.trim() || null,
        createdAt: now,
      };
      mockWorkflowUrges.push(row);
      created.push(row);
    });
    const msg = skipped > 0
      ? `已催办 ${created.length} 人，${skipped} 人催办过于频繁已跳过`
      : `已催办 ${created.length} 人`;
    return HttpResponse.json({ code: 0, message: msg, data: created });
  }),

  // 动态补加抄送
  http.post('/api/workflows/instances/:id/cc/add', async ({ params, request }) => {
    const body = await request.json().catch(() => ({})) as { nodeKey?: string; userIds?: number[] };
    const instId = Number(params.id);
    const inst = mockWorkflowInstances.find(i => i.id === instId);
    if (!inst) return err('流程不存在', 404);
    if (inst.status !== 'running') return err('流程已结束，无法补加抄送');
    if (!body.nodeKey) return err('请选择抄送节点');
    if (!Array.isArray(body.userIds) || body.userIds.length === 0) return err('请选择抄送人');

    // 去重：过滤掉当前实例 + 节点已经抄送过的用户
    const existingSet = new Set(
      mockWorkflowTasks
        .filter(t => t.instanceId === instId && t.nodeKey === body.nodeKey && t.nodeType === 'ccNode')
        .map(t => t.assigneeId)
        .filter((v): v is number => typeof v === 'number'),
    );
    const toAdd = Array.from(new Set(body.userIds)).filter(uid => !existingSet.has(uid));
    if (toAdd.length === 0) {
      return HttpResponse.json({ code: 0, message: '所选用户均已抄送，无需重复添加', data: [] });
    }
    const now = mockDateTime();
    const sample = mockWorkflowTasks.find(t => t.instanceId === instId && t.nodeKey === body.nodeKey);
    const inserted = toAdd.map((uid) => {
      const task = {
        id: getNextTaskId(),
        instanceId: instId,
        nodeKey: body.nodeKey!,
        nodeName: sample?.nodeName ?? '抄送',
        nodeType: 'ccNode' as const,
        assigneeId: uid,
        status: 'skipped' as const,
        comment: null,
        actionAt: null,
        createdAt: now,
      };
      mockWorkflowTasks.push(task);
      return task;
    });
    return HttpResponse.json({ code: 0, message: `已补加 ${inserted.length} 人抄送`, data: inserted });
  }),

  // 退回
  http.post('/api/workflows/tasks/:taskId/return', async ({ params, request }) => {
    const body = await request.json() as { targetNodeKeys: string[]; comment: string };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    if (mockWorkflowTasks[taskIdx].status !== 'pending') return err('该任务已处理');
    if (!Array.isArray(body.targetNodeKeys) || body.targetNodeKeys.length === 0) return err('请选择退回节点');
    const firstNodeKey = body.targetNodeKeys[0];
    const now = mockDateTime();
    const current = mockWorkflowTasks[taskIdx];
    const tag = body.targetNodeKeys.length > 1
      ? `[退回多节点: ${body.targetNodeKeys.join('、')}]`
      : `[退回至 ${firstNodeKey}]`;
    mockWorkflowTasks[taskIdx] = {
      ...current,
      status: 'rejected',
      comment: `${tag} ${body.comment}`,
      actionAt: now,
    };
    const instIdx = mockWorkflowInstances.findIndex(i => i.id === current.instanceId);
    if (instIdx !== -1) {
      mockWorkflowInstances[instIdx] = {
        ...mockWorkflowInstances[instIdx],
        currentNodeKey: firstNodeKey,
        updatedAt: now,
      };
    }
    return ok(mockWorkflowInstances[instIdx] ?? null);
  }),
];
