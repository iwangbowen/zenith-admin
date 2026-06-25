import { http, HttpResponse } from 'msw';
import type { WorkflowDefinition, WorkflowDefinitionVersion, WorkflowFormField, WorkflowInstance, WorkflowInstanceFormSnapshot, WorkflowTask, WorkflowTaskUrge } from '@zenith/shared';
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
import { mockWorkflowForms } from '@/mocks/data/workflow-forms';
import { mockDateTime } from '@/mocks/utils/date';

function ok<T>(data: T, message = 'ok') {
  return HttpResponse.json({ code: 0, message, data });
}

function err(message: string, code = 400) {
  return HttpResponse.json({ code, message });
}

function cloneFormFields(fields: WorkflowFormField[] | null | undefined): WorkflowFormField[] | null {
  return fields ? JSON.parse(JSON.stringify(fields)) as WorkflowFormField[] : null;
}

function isBusinessFormType(formType: WorkflowDefinition['formType'] | undefined) {
  return formType === 'custom' || formType === 'external';
}

function resolveWorkflowDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  const form = definition.formId != null ? mockWorkflowForms.find((item) => item.id === definition.formId) : undefined;
  return {
    ...definition,
    formName: form?.name ?? null,
    formFields: cloneFormFields(form?.schema?.fields ?? null),
    formSettings: form?.schema?.settings ?? null,
  };
}

function resolveWorkflowDefinitionVersion(version: WorkflowDefinitionVersion): WorkflowDefinitionVersion {
  const form = version.formId != null ? mockWorkflowForms.find((item) => item.id === version.formId) : undefined;
  return {
    ...version,
    formName: form?.name ?? version.formName ?? null,
    formFields: cloneFormFields(form?.schema?.fields ?? version.formFields ?? null),
  };
}

function resolveDefinitionFormFields(definition: WorkflowDefinition): WorkflowFormField[] | null {
  const form = definition.formId != null ? mockWorkflowForms.find((item) => item.id === definition.formId) : undefined;
  return cloneFormFields(form?.schema?.fields ?? null);
}

function resolveDefinitionFormSnapshot(definition: WorkflowDefinition): WorkflowInstanceFormSnapshot | null {
  if (definition.formType === 'designer') {
    const form = definition.formId != null ? mockWorkflowForms.find((item) => item.id === definition.formId) : undefined;
    if (!form) return null;
    return {
      formType: 'designer',
      formId: definition.formId ?? null,
      formName: form.name,
      fields: cloneFormFields(form.schema?.fields ?? null) ?? [],
      settings: form.schema?.settings ?? null,
      customForm: null,
    };
  }
  return {
    formType: definition.formType,
    formId: null,
    formName: null,
    fields: [],
    settings: null,
    customForm: definition.customForm,
  };
}

function withDefinitionSnapshot(instance: WorkflowInstance): WorkflowInstance {
  const def = mockWorkflowDefinitions.find((item) => item.id === instance.definitionId);
  if (!def) return instance;
  const formSnapshot = instance.formSnapshot ?? resolveDefinitionFormSnapshot(def);
  return {
    ...instance,
    formSnapshot,
    definitionSnapshot: {
      id: def.id,
      name: def.name,
      description: def.description,
      categoryId: def.categoryId,
      categoryName: def.categoryName ?? null,
      categoryColor: def.categoryColor ?? null,
      categoryIcon: def.categoryIcon ?? null,
      flowData: def.flowData,
      formId: def.formId,
      formName: resolveWorkflowDefinition(def).formName ?? null,
      formFields: resolveWorkflowDefinition(def).formFields ?? null,
      formSettings: resolveWorkflowDefinition(def).formSettings ?? null,
      formType: def.formType,
      customForm: def.customForm,
      status: def.status,
      version: def.version,
      tenantId: def.tenantId,
    },
  };
}

/** 从流程定义解析实例当前节点名称 */
function resolveCurrentNodeName(inst: WorkflowInstance): string | null {
  if (!inst.currentNodeKey) return null;
  const def = mockWorkflowDefinitions.find((d) => d.id === inst.definitionId);
  return def?.flowData?.nodes.find((n) => n.data.key === inst.currentNodeKey)?.data.label ?? null;
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
    const paged = list.slice((page - 1) * pageSize, page * pageSize).map(resolveWorkflowDefinition);
    return ok({ list: paged, total, page, pageSize });
  }),

  // 获取已发布的流程定义列表（发起申请时使用，返回数组而非分页对象）
  http.get('/api/workflows/definitions/published', () => {
    const list = mockWorkflowDefinitions.filter(d => d.status === 'published' && d.formType !== 'external').map(resolveWorkflowDefinition);
    return ok(list);
  }),

  // 获取单个流程定义
  http.get('/api/workflows/definitions/:id', ({ params }) => {
    const def = mockWorkflowDefinitions.find(d => d.id === Number(params.id));
    if (!def) return err('流程定义不存在', 404);
    return ok(resolveWorkflowDefinition(def));
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
      formId: isBusinessFormType(body.formType) ? null : (body.formId ?? null),
      formFields: null,
      formType: body.formType ?? 'designer',
      customForm: isBusinessFormType(body.formType) ? (body.customForm ?? null) : null,
      status: 'draft',
      version: 1,
      tenantId: 1,
      createdBy: 1,
      createdByName: '张三',
      createdAt: now,
      updatedAt: now,
    };
    mockWorkflowDefinitions.push(newDef);
    return ok(resolveWorkflowDefinition(newDef));
  }),

  // 更新流程定义
  http.put('/api/workflows/definitions/:id', async ({ params, request }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    const body = await request.json() as Partial<WorkflowDefinition>;
    const prev = mockWorkflowDefinitions[idx];
    // 已发布的流程保存后自动转为草稿
    const nextStatus = prev.status === 'published' && body.status === undefined ? 'draft' : prev.status;
    const nextFormType = body.formType ?? prev.formType;
    const updated: WorkflowDefinition = {
      ...prev,
      ...body,
      id: prev.id,
      formId: isBusinessFormType(nextFormType) ? null : (body.formId !== undefined ? body.formId : prev.formId),
      formName: null,
      formFields: null,
      formSettings: null,
      customForm: isBusinessFormType(nextFormType)
        ? (body.customForm !== undefined ? body.customForm ?? null : prev.customForm)
        : null,
      status: nextStatus,
      version: prev.version,
      updatedAt: mockDateTime(),
    };
    mockWorkflowDefinitions[idx] = updated;
    return ok(resolveWorkflowDefinition(updated));
  }),

  // 发布流程定义
  // 批量禁用流程定义（仅已发布）
  http.post('/api/workflows/definitions/batch-disable', async ({ request }) => {
    const { ids } = await request.json() as { ids: number[] };
    const now = mockDateTime();
    let updated = 0;
    for (const id of ids ?? []) {
      const idx = mockWorkflowDefinitions.findIndex(d => d.id === id);
      if (idx === -1 || mockWorkflowDefinitions[idx].status !== 'published') continue;
      mockWorkflowDefinitions[idx] = { ...mockWorkflowDefinitions[idx], status: 'disabled', updatedAt: now };
      updated++;
    }
    const skipped = (ids?.length ?? 0) - updated;
    return ok(null, skipped > 0 ? `成功禁用 ${updated} 条，${skipped} 条已跳过（非已发布状态）` : `成功禁用 ${updated} 条`);
  }),

  // 批量启用流程定义（仅已禁用）
  http.post('/api/workflows/definitions/batch-enable', async ({ request }) => {
    const { ids } = await request.json() as { ids: number[] };
    const now = mockDateTime();
    let updated = 0;
    for (const id of ids ?? []) {
      const idx = mockWorkflowDefinitions.findIndex(d => d.id === id);
      if (idx === -1 || mockWorkflowDefinitions[idx].status !== 'disabled') continue;
      mockWorkflowDefinitions[idx] = { ...mockWorkflowDefinitions[idx], status: 'published', updatedAt: now };
      updated++;
    }
    const skipped = (ids?.length ?? 0) - updated;
    return ok(null, skipped > 0 ? `成功启用 ${updated} 条，${skipped} 条已跳过（非已禁用状态）` : `成功启用 ${updated} 条`);
  }),

  // 批量删除流程定义（仅非已发布且无发起实例）
  http.post('/api/workflows/definitions/batch-delete', async ({ request }) => {
    const { ids } = await request.json() as { ids: number[] };
    let deleted = 0;
    for (const id of ids ?? []) {
      const idx = mockWorkflowDefinitions.findIndex(d => d.id === id);
      if (idx === -1) continue;
      if (mockWorkflowDefinitions[idx].status === 'published') continue;
      if (mockWorkflowInstances.some(i => i.definitionId === id)) continue;
      mockWorkflowDefinitions.splice(idx, 1);
      deleted++;
    }
    const skipped = (ids?.length ?? 0) - deleted;
    return ok(null, skipped > 0 ? `成功删除 ${deleted} 条，${skipped} 条已跳过（已发布或存在发起实例）` : `成功删除 ${deleted} 条`);
  }),

  http.post('/api/workflows/definitions/:id/publish', ({ params }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    if (!mockWorkflowDefinitions[idx].flowData) return err('流程图不能为空，请先设计流程');
    const cur = mockWorkflowDefinitions[idx];
    if (cur.formType === 'custom' && !cur.customForm?.createComponent?.trim()) {
      return err('请先在「表单」步骤配置自定义业务表单的创建页组件路径');
    }
    if (cur.formType === 'external' && !cur.customForm?.viewComponent?.trim()) {
      return err('请先在「表单」步骤配置业务系统主导流程的审批查看页组件路径');
    }
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
      formId: cur.formId,
      formName: resolveWorkflowDefinition(cur).formName,
      formFields: resolveDefinitionFormFields(cur),
      formType: cur.formType,
      customForm: cur.customForm,
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
    return ok(resolveWorkflowDefinition(mockWorkflowDefinitions[idx]));
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
    return ok(resolveWorkflowDefinition(mockWorkflowDefinitions[idx]));
  }),

  // 启用流程定义
  http.post('/api/workflows/definitions/:id/enable', ({ params }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    if (mockWorkflowDefinitions[idx].status !== 'disabled') return err('流程定义不存在或不处于禁用状态');
    mockWorkflowDefinitions[idx] = {
      ...mockWorkflowDefinitions[idx],
      status: 'published',
      updatedAt: mockDateTime(),
    };
    return ok(resolveWorkflowDefinition(mockWorkflowDefinitions[idx]));
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
      .sort((a, b) => b.version - a.version)
      .map(resolveWorkflowDefinitionVersion);
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
      formId: ver.formId,
      formType: ver.formType,
      customForm: ver.customForm,
      formName: null,
      formFields: null,
      formSettings: null,
      status: 'draft',
      updatedAt: mockDateTime(),
    };
    return ok(resolveWorkflowDefinition(mockWorkflowDefinitions[idx]));
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
      cancelled: mockWorkflowInstances.filter(i => i.status === 'cancelled').length,
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
      .map(i => ({ ...i, currentNodeName: resolveCurrentNodeName(i), tasks: undefined }));

    return ok({ stats, list: paged, total, page, pageSize });
  }),

  // 获取流程实例详情（含任务列表）
  http.get('/api/workflows/instances/:id', ({ params }) => {
    const inst = mockWorkflowInstances.find(i => i.id === Number(params.id));
    if (!inst) return err('流程实例不存在', 404);
    const tasks = mockWorkflowTasks.filter(t => t.instanceId === inst.id)
      .sort((a, b) => a.id - b.id);
    // 子流程：聚合本实例发起的子实例摘要
    const childInstances = mockWorkflowInstances
      .filter(i => i.parentInstanceId === inst.id)
      .map(c => ({ id: c.id, title: c.title, status: c.status, parentTaskNodeKey: null, createdAt: c.createdAt }));
    return ok({ ...withDefinitionSnapshot(inst), tasks, childInstances });
  }),

  // 发起流程申请（支持保存草稿 asDraft）
  http.post('/api/workflows/instances', async ({ request }) => {
    const body = await request.json() as { definitionId: number; title: string; formData: Record<string, unknown>; asDraft?: boolean; priority?: 'low' | 'normal' | 'high' | 'urgent'; ccUserIds?: number[] };
    const def = mockWorkflowDefinitions.find(d => d.id === body.definitionId);
    if (!def) return err('流程定义不存在');
    if (def.status !== 'published') return err('该流程未发布，无法发起申请');
    if (def.formType === 'external') return err('业务系统主导流程请从对应业务模块发起');

    const now = mockDateTime();
    const instanceId = getNextInstanceId();
    const isDraft = body.asDraft === true;

    // 业务编号：仅正式发起时生成
    const serialCfg = (def.flowData?.settings as { serialNo?: { enabled?: boolean; prefix?: string; seqLength?: number } } | undefined)?.serialNo;
    let serialNo: string | null = null;
    if (!isDraft && serialCfg?.enabled) {
      serialNo = `${serialCfg.prefix ?? ''}${String(instanceId).padStart(serialCfg.seqLength ?? 4, '0')}`;
    }

    // 创建初始审批任务（取第一个 approve 节点）；草稿不创建任务
    const firstApproveNode = def.flowData?.nodes.find(n => n.data.type === 'approve');
    const newTasks: WorkflowTask[] = [];
    if (!isDraft && firstApproveNode) {
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
      serialNo,
      priority: body.priority ?? 'normal',
      formData: body.formData,
      formSnapshot: resolveDefinitionFormSnapshot(def),
      status: isDraft ? 'draft' : 'running',
      currentNodeKey: isDraft ? null : (firstApproveNode?.data.key ?? null),
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

  // 取消流程实例（管理员强制终止）
  http.post('/api/workflows/instances/:id/cancel', ({ params }) => {
    const idx = mockWorkflowInstances.findIndex(i => i.id === Number(params.id));
    if (idx === -1) return err('流程实例不存在', 404);
    if (mockWorkflowInstances[idx].status !== 'running') return err('只能取消进行中的流程');
    mockWorkflowInstances[idx] = {
      ...mockWorkflowInstances[idx],
      status: 'cancelled',
      currentNodeKey: null,
      updatedAt: mockDateTime(),
    };
    mockWorkflowTasks
      .filter(t => t.instanceId === Number(params.id) && (t.status === 'pending' || t.status === 'waiting'))
      .forEach(t => {
        t.status = 'skipped';
        t.actionAt = mockDateTime();
      });
    return ok(mockWorkflowInstances[idx]);
  }),

  // 删除流程实例（仅终态可删，级联删除任务）
  http.delete('/api/workflows/instances/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = mockWorkflowInstances.findIndex(i => i.id === id);
    if (idx === -1) return err('流程实例不存在', 404);
    if (mockWorkflowInstances[idx].status === 'running' || mockWorkflowInstances[idx].status === 'draft') {
      return err('请先取消进行中的流程再删除');
    }
    mockWorkflowInstances.splice(idx, 1);
    for (let i = mockWorkflowTasks.length - 1; i >= 0; i--) {
      if (mockWorkflowTasks[i].instanceId === id) mockWorkflowTasks.splice(i, 1);
    }
    return ok(null);
  }),

  // ─── 审批任务 Handler ──────────────────────────────────────────────────────

  // 审批通过
  http.post('/api/workflows/tasks/:taskId/approve', async ({ params, request }) => {
    const body = await request.json() as { comment?: string; signature?: string; attachments?: Array<{ name: string; url: string; size?: number }>; selectedNextApprovers?: number[] };
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
      signature: body.signature ?? null,
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
