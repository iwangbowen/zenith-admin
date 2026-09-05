import { workflowFormContract } from '@zenith/shared/workflow';
import type { WorkflowForm } from '@zenith/shared/workflow';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, conflict } from '@/mocks/utils/handlers';
import { mockWorkflowForms, getNextWorkflowFormId } from '@/mocks/data/workflow-forms';
import { mockWorkflowDefinitions } from '@/mocks/data/workflow';
import { mockDateTime } from '@/mocks/utils/date';

function usageCount(formId: number) {
  return mockWorkflowDefinitions.filter((definition) => definition.formId === formId).length;
}

function withUsage(form: WorkflowForm): WorkflowForm {
  return { ...form, usageCount: usageCount(form.id) };
}

export const workflowFormsHandlers = [
  mock(workflowFormContract.list, ({ query, ok, paginate }) => {
    const keyword = (query.keyword ?? '').toLowerCase();

    let list = [...mockWorkflowForms];
    if (keyword) list = list.filter((form) => form.name.toLowerCase().includes(keyword));
    if (query.status) list = list.filter((form) => form.status === query.status);
    if (query.categoryId) list = list.filter((form) => form.categoryId === query.categoryId);

    list = list.sort((a, b) => b.id - a.id).map(withUsage);
    return ok(paginate(list), 'success');
  }),

  mock(workflowFormContract.enabled, ({ ok }) => {
    const list = mockWorkflowForms
      .filter((form) => form.status === 'enabled')
      .sort((a, b) => a.name.localeCompare(b.name) || b.id - a.id)
      .map(withUsage);
    return ok(list, 'success');
  }),

  mock(workflowFormContract.detail, ({ params, ok }) => {
    const form = mockWorkflowForms.find((item) => item.id === params.id);
    if (!form) return notFound('表单不存在', { status: 404 });
    return ok(withUsage(form), 'success');
  }),

  mock(workflowFormContract.create, ({ body, ok }) => {
    const tenantId = 1;
    if (body.code && mockWorkflowForms.some((form) => form.tenantId === tenantId && form.code === body.code)) {
      return badRequest('表单编码已存在', { status: 400 });
    }
    const now = mockDateTime();
    const form: WorkflowForm = {
      id: getNextWorkflowFormId(),
      name: body.name ?? '未命名表单',
      code: body.code ?? null,
      description: body.description ?? null,
      categoryId: body.categoryId ?? null,
      categoryName: null,
      schema: body.schema ?? { fields: [] },
      status: body.status,
      revision: 1,
      usageCount: 0,
      tenantId,
      createdBy: 1,
      updatedBy: 1,
      createdByName: '张三',
      createdAt: now,
      updatedAt: now,
    };
    mockWorkflowForms.push(form);
    return ok(withUsage(form), 'success');
  }),

  mock(workflowFormContract.duplicate, ({ params, ok }) => {
    const src = mockWorkflowForms.find((item) => item.id === params.id);
    if (!src) return notFound('表单不存在', { status: 404 });
    const now = mockDateTime();
    const form: WorkflowForm = {
      ...src,
      id: getNextWorkflowFormId(),
      name: `${src.name} 副本`,
      code: null,
      schema: src.schema ? structuredClone(src.schema) : src.schema,
      revision: 1,
      usageCount: 0,
      createdBy: 1,
      updatedBy: 1,
      createdByName: '张三',
      createdAt: now,
      updatedAt: now,
    };
    mockWorkflowForms.push(form);
    return ok(withUsage(form), '复制成功');
  }),

  mock(workflowFormContract.update, ({ params, body, ok }) => {
    const form = mockWorkflowForms.find((item) => item.id === params.id);
    if (!form) return notFound('表单不存在', { status: 404 });
    // 乐观锁：客户端持有的版本与当前不一致时返回 409（与服务端语义一致）
    if (body.expectedRevision != null && body.expectedRevision !== form.revision) {
      return conflict('表单已被其他人更新，请刷新后重试', { status: 409 });
    }
    if (body.code && body.code !== form.code && mockWorkflowForms.some((item) => item.tenantId === form.tenantId && item.code === body.code)) {
      return badRequest('表单编码已存在', { status: 400 });
    }
    // renamedKeys 级联（重写引用定义 flowData）仅服务端实现，Demo 模式下忽略
    Object.assign(form, {
      name: body.name ?? form.name,
      code: body.code !== undefined ? body.code : form.code,
      description: body.description !== undefined ? body.description : form.description,
      categoryId: body.categoryId !== undefined ? body.categoryId : form.categoryId,
      schema: body.schema !== undefined ? body.schema : form.schema,
      status: body.status ?? form.status,
      revision: form.revision + 1,
      updatedBy: 1,
      updatedAt: mockDateTime(),
    });
    return ok(withUsage(form), 'success');
  }),

  mock(workflowFormContract.remove, ({ params, ok }) => {
    const index = mockWorkflowForms.findIndex((form) => form.id === params.id);
    if (index === -1) return notFound('表单不存在', { status: 404 });
    if (usageCount(params.id) > 0) return badRequest('该表单已被流程引用，无法删除', { status: 400 });
    mockWorkflowForms.splice(index, 1);
    return ok(null, '删除成功');
  }),
];
