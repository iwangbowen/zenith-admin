import { http, HttpResponse } from 'msw';
import { mockDepartments, getNextDeptId } from '@/mocks/data/departments';
import type { Department } from '@zenith/shared';

function buildDeptTree(list: Department[], parentId: number = 0): Department[] {
  return list
    .filter((d) => d.parentId === parentId)
    .map((d) => {
      const children = buildDeptTree(list, d.id);
      return children.length > 0 ? { ...d, children } : { ...d };
    });
}

export const departmentsHandlers = [
  // 部门平铺列表（供下拉框使用）
  http.get('/api/departments/flat', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: mockDepartments });
  }),

  // 部门树
  http.get('/api/departments', ({ request }) => {
    const url = new URL(request.url);
    const flat = url.searchParams.get('flat');
    if (flat === 'true') {
      return HttpResponse.json({ code: 0, message: 'ok', data: mockDepartments });
    }
    return HttpResponse.json({ code: 0, message: 'ok', data: buildDeptTree(mockDepartments) });
  }),

  // 获取单个部门
  http.get('/api/departments/:id', ({ params }) => {
    const dept = mockDepartments.find((d) => d.id === Number(params.id));
    if (!dept) return HttpResponse.json({ code: 404, message: '部门不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: dept });
  }),

  // 新增部门
  http.post('/api/departments', async ({ request }) => {
    const body = await request.json() as Partial<Department>;
    const newDept: Department = {
      id: getNextDeptId(),
      name: body.name ?? '',
      code: body.code ?? '',
      parentId: body.parentId ?? 0,
      sort: body.sort ?? 0,
      status: body.status ?? 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockDepartments.push(newDept);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newDept });
  }),

  // 更新部门
  http.put('/api/departments/:id', async ({ params, request }) => {
    const dept = mockDepartments.find((d) => d.id === Number(params.id));
    if (!dept) return HttpResponse.json({ code: 404, message: '部门不存在', data: null });
    const body = await request.json() as Partial<Department>;
    Object.assign(dept, body, { updatedAt: new Date().toISOString() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: dept });
  }),

  // 删除部门
  http.delete('/api/departments/:id', ({ params }) => {
    const index = mockDepartments.findIndex((d) => d.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '部门不存在', data: null });
    mockDepartments.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
