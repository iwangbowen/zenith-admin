import { http, HttpResponse } from 'msw';
import { createWorkflowFormSchema, updateWorkflowFormSchema, type WorkflowForm } from '@zenith/shared';
import { mockWorkflowForms, getNextWorkflowFormId } from '@/mocks/data/workflow-forms';
import { mockWorkflowDefinitions } from '@/mocks/data/workflow';
import { mockDateTime } from '@/mocks/utils/date';

function ok<T>(data: T, message = 'success') {
  return HttpResponse.json({ code: 0, message, data });
}

function fail(message: string, code = 400) {
  return HttpResponse.json({ code, message, data: null }, { status: code });
}

function usageCount(formId: number) {
  return mockWorkflowDefinitions.filter((definition) => definition.formId === formId).length;
}

function withUsage(form: WorkflowForm): WorkflowForm {
  return { ...form, usageCount: usageCount(form.id) };
}

function validationErrorMessage(error: { issues: Array<{ message: string }> }) {
  return error.issues[0]?.message ?? '参数错误';
}

export const workflowFormsHandlers = [
  http.get('/api/workflows/forms', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const keyword = (url.searchParams.get('keyword') ?? '').toLowerCase();
    const status = url.searchParams.get('status') ?? '';
    const categoryId = url.searchParams.get('categoryId');

    let list = [...mockWorkflowForms];
    if (keyword) list = list.filter((form) => form.name.toLowerCase().includes(keyword));
    if (status) list = list.filter((form) => form.status === status);
    if (categoryId) list = list.filter((form) => form.categoryId === Number(categoryId));

    list = list.sort((a, b) => b.id - a.id).map(withUsage);
    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize);
    return ok({ list: paged, total, page, pageSize });
  }),

  http.get('/api/workflows/forms/enabled', () => {
    const list = mockWorkflowForms
      .filter((form) => form.status === 'enabled')
      .sort((a, b) => a.name.localeCompare(b.name) || b.id - a.id)
      .map(withUsage);
    return ok(list);
  }),

  http.get('/api/workflows/forms/:id', ({ params }) => {
    const form = mockWorkflowForms.find((item) => item.id === Number(params.id));
    if (!form) return fail('表单不存在', 404);
    return ok(withUsage(form));
  }),

  http.post('/api/workflows/forms', async ({ request }) => {
    const parsed = createWorkflowFormSchema.safeParse(await request.json());
    if (!parsed.success) return fail(validationErrorMessage(parsed.error), 400);
    const body = parsed.data;
    const tenantId = 1;
    if (body.code && mockWorkflowForms.some((form) => form.tenantId === tenantId && form.code === body.code)) {
      return fail('表单编码已存在', 400);
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
      status: body.status ?? 'enabled',
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
    return ok(withUsage(form));
  }),

  http.post('/api/workflows/forms/:id/duplicate', ({ params }) => {
    const src = mockWorkflowForms.find((item) => item.id === Number(params.id));
    if (!src) return fail('表单不存在', 404);
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

  http.put('/api/workflows/forms/:id', async ({ params, request }) => {
    const form = mockWorkflowForms.find((item) => item.id === Number(params.id));
    if (!form) return fail('表单不存在', 404);
    const parsed = updateWorkflowFormSchema.safeParse(await request.json());
    if (!parsed.success) return fail(validationErrorMessage(parsed.error), 400);
    const body = parsed.data;
    // 乐观锁：客户端持有的版本与当前不一致时返回 409（与服务端语义一致）
    if (body.expectedRevision != null && body.expectedRevision !== form.revision) {
      return fail('表单已被其他人更新，请刷新后重试', 409);
    }
    if (body.code && body.code !== form.code && mockWorkflowForms.some((item) => item.tenantId === form.tenantId && item.code === body.code)) {
      return fail('表单编码已存在', 400);
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
    return ok(withUsage(form));
  }),

  http.delete('/api/workflows/forms/:id', ({ params }) => {
    const id = Number(params.id);
    const index = mockWorkflowForms.findIndex((form) => form.id === id);
    if (index === -1) return fail('表单不存在', 404);
    if (usageCount(id) > 0) return fail('该表单已被流程引用，无法删除', 400);
    mockWorkflowForms.splice(index, 1);
    return ok(null, '删除成功');
  }),
];
