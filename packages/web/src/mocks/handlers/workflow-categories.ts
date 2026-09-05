import { workflowCategoryContract } from '@zenith/shared/workflow';
import type { WorkflowCategory } from '@zenith/shared/workflow';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockWorkflowCategories, getNextCategoryId } from '@/mocks/data/workflow-categories';
import { mockDateTime } from '@/mocks/utils/date';

export const workflowCategoriesHandlers = [
  // 全量列表（useWorkflowCategories hook 使用）
  mock(workflowCategoryContract.all, ({ ok }) => ok([...mockWorkflowCategories].sort((a, b) => a.sort - b.sort))),

  mock(workflowCategoryContract.list, ({ query, ok, paginate }) => {
    let list = [...mockWorkflowCategories];
    if (query.keyword) list = list.filter((c) => c.name.includes(query.keyword!) || (c.code ?? '').includes(query.keyword!));
    return ok(paginate(list.toSorted((a, b) => a.sort - b.sort)));
  }),

  mock(workflowCategoryContract.create, ({ body, ok }) => {
    if (!body.name.trim()) return badRequest('分类名称不能为空', { status: 400 });
    if (mockWorkflowCategories.some((c) => c.code && c.code === body.code)) {
      return badRequest('分类编码已存在', { status: 400 });
    }
    const now = mockDateTime();
    const newCategory: WorkflowCategory = {
      id: getNextCategoryId(),
      name: body.name,
      code: body.code ?? null,
      icon: body.icon ?? null,
      color: body.color ?? null,
      sort: body.sort ?? mockWorkflowCategories.length + 1,
      description: body.description ?? null,
      tenantId: null,
      createdAt: now,
      updatedAt: now,
    };
    mockWorkflowCategories.push(newCategory);
    return ok(newCategory);
  }),

  mock(workflowCategoryContract.update, ({ params, body, ok }) => {
    const idx = mockWorkflowCategories.findIndex((c) => c.id === params.id);
    if (idx === -1) return notFound('分类不存在', { status: 404 });
    if (body.code && body.code !== mockWorkflowCategories[idx].code) {
      if (mockWorkflowCategories.some((c) => c.code === body.code)) return badRequest('分类编码已存在', { status: 400 });
    }
    const updated: WorkflowCategory = {
      ...mockWorkflowCategories[idx],
      ...body,
      id: params.id,
      updatedAt: mockDateTime(),
    };
    mockWorkflowCategories[idx] = updated;
    return ok(updated);
  }),

  mock(workflowCategoryContract.remove, ({ params, ok }) => {
    const idx = mockWorkflowCategories.findIndex((c) => c.id === params.id);
    if (idx === -1) return notFound('分类不存在', { status: 404 });
    mockWorkflowCategories.splice(idx, 1);
    return ok(null);
  }),
];