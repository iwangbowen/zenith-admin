import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { asc, eq, and } from 'drizzle-orm';
import { db } from '../db';
import { departments, users } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { exportToExcel } from '../lib/excel-export';
import type { Department } from '@zenith/shared';
import { createDepartmentSchema, updateDepartmentSchema } from '@zenith/shared';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { ErrorResponse, jsonContent, validationHook, commonErrorResponses, ok, okMsg, IdParam } from '../lib/openapi-schemas';
import { DepartmentDTO } from '../lib/openapi-dtos';

const departmentsRouter = new OpenAPIHono({ defaultHook: validationHook });

function toDepartment(row: typeof departments.$inferSelect): Omit<Department, 'children'> {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    code: row.code,
    leader: row.leader ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    sort: row.sort,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildTree(list: Omit<Department, 'children'>[]): Department[] {
  const map = new Map<number, Department>();
  list.forEach((item) => map.set(item.id, { ...item }));
  const roots: Department[] = [];
  map.forEach((node) => {
    if (node.parentId === 0) { roots.push(node); return; }
    const parent = map.get(node.parentId);
    if (!parent) { roots.push(node); return; }
    parent.children = parent.children ?? [];
    parent.children.push(node);
  });
  const sortNodes = (nodes: Department[]) => {
    nodes.sort((a, b) => a.sort - b.sort || a.id - b.id);
    nodes.forEach((item) => item.children && sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}

function filterTree(nodes: Department[], keyword: string, status?: string) {
  return nodes.reduce<Department[]>((acc, node) => {
    const children = node.children ? filterTree(node.children, keyword, status) : [];
    const keywordMatched = !keyword || node.name.includes(keyword) || node.code.includes(keyword);
    const statusMatched = !status || node.status === status;
    if ((keywordMatched && statusMatched) || children.length > 0) {
      acc.push({ ...node, children: children.length > 0 ? children : undefined });
    }
    return acc;
  }, []);
}

async function ensureParentValid(parentId: number, currentId?: number) {
  if (parentId === 0) return null;
  const allDepartments = await db.select({ id: departments.id, parentId: departments.parentId }).from(departments);
  const parentExists = allDepartments.some((item) => item.id === parentId);
  if (!parentExists) return '上级部门不存在';
  if (!currentId) return null;
  if (parentId === currentId) return '上级部门不能选择自身';
  const descendants = new Set<number>();
  const queue = [currentId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const item of allDepartments) {
      if (item.parentId === current) { descendants.add(item.id); queue.push(item.id); }
    }
  }
  if (descendants.has(parentId)) return '上级部门不能选择子部门';
  return null;
}

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['Departments'],
    summary: '部门树',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:department:list' })] as const,
    request: { query: z.object({ keyword: z.string().optional(), status: z.string().optional() }) },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(DepartmentDTO), '部门树'),
    },
  }),
  handler: async (c) => {
    const { keyword = '', status } = c.req.valid('query');
    const user = c.get('user');
    const tc = tenantCondition(departments, user);
    const rows = await db.select().from(departments).where(tc).orderBy(asc(departments.sort), asc(departments.id));
    const tree = buildTree(rows.map(toDepartment));
    const data = keyword || status ? filterTree(tree, keyword, status) : tree;
    return c.json({ code: 0 as const, message: 'ok', data }, 200);
  },
});

const flatRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/flat',
    tags: ['Departments'],
    summary: '部门扁平列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:department:list' })] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(DepartmentDTO), '列表'),
    },
  }),
  handler: async (c) => {
    const tc = tenantCondition(departments, c.get('user'));
    const rows = await db.select().from(departments).where(tc).orderBy(asc(departments.sort), asc(departments.id));
    return c.json({ code: 0 as const, message: 'ok', data: rows.map(toDepartment) }, 200);
  },
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['Departments'],
    summary: '创建部门',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:department:create', audit: { description: '创建部门', module: '部门管理' } })] as const,
    request: { body: { content: jsonContent(createDepartmentSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(DepartmentDTO, '创建成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');
    const parentError = await ensureParentValid(data.parentId);
    if (parentError) return c.json({ code: 400, message: parentError, data: null }, 400);
    try {
      const [department] = await db.insert(departments).values({ ...data, tenantId: getCreateTenantId(c.get('user')) }).returning();
      return c.json({ code: 0 as const, message: '创建成功', data: toDepartment(department) }, 200);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') {
        return c.json({ code: 400, message: '部门编码已存在', data: null }, 400);
      }
      throw error;
    }
  },
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Departments'],
    summary: '更新部门',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:department:update', audit: { description: '更新部门', module: '部门管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateDepartmentSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(DepartmentDTO, '更新成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    if (data.parentId !== undefined) {
      const parentError = await ensureParentValid(data.parentId, id);
      if (parentError) return c.json({ code: 400, message: parentError, data: null }, 400);
    }
    try {
      const [department] = await db.update(departments)
        .set({ ...data })
        .where(and(eq(departments.id, id), tenantCondition(departments, c.get('user'))))
        .returning();
      if (!department) return c.json({ code: 404, message: '部门不存在', data: null }, 404);
      return c.json({ code: 0 as const, message: '更新成功', data: toDepartment(department) }, 200);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') {
        return c.json({ code: 400, message: '部门编码已存在', data: null }, 400);
      }
      throw error;
    }
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Departments'],
    summary: '删除部门',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:department:delete', audit: { description: '删除部门', module: '部门管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      400: { content: jsonContent(ErrorResponse), description: '不可删除' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const tc = tenantCondition(departments, c.get('user'));
    const [department] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, id), tc)).limit(1);
    if (!department) return c.json({ code: 404, message: '部门不存在', data: null }, 404);
    const [childDepartment] = await db.select({ id: departments.id }).from(departments).where(eq(departments.parentId, id)).limit(1);
    if (childDepartment) return c.json({ code: 400, message: '该部门存在子部门，无法删除', data: null }, 400);
    const [boundUser] = await db.select({ id: users.id }).from(users).where(eq(users.departmentId, id)).limit(1);
    if (boundUser) return c.json({ code: 400, message: '该部门下仍有关联用户，无法删除', data: null }, 400);
    await db.delete(departments).where(and(eq(departments.id, id), tc));
    return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
  },
});

const exportRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/export',
    tags: ['Departments'],
    summary: '导出部门',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:department:list' })] as const,
    responses: {
      ...commonErrorResponses,
      200: { content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.string() } }, description: 'Excel 文件' },
    },
  }),
  handler: async (c) => {
    const tc = tenantCondition(departments, c.get('user'));
    const rows = await db.select().from(departments).where(tc).orderBy(asc(departments.sort));
    const buffer = await exportToExcel(
      [
        { header: 'ID', key: 'id', width: 8 },
        { header: '部门名称', key: 'name', width: 20 },
        { header: '部门编码', key: 'code', width: 16 },
        { header: '负责人', key: 'leader', width: 14 },
        { header: '电话', key: 'phone', width: 16 },
        { header: '状态', key: 'status', width: 10, transform: (v) => v === 'active' ? '启用' : '禁用' },
        { header: '创建时间', key: 'createdAt', width: 22 },
      ],
      rows.map((r) => ({ ...r, leader: r.leader ?? '', phone: r.phone ?? '', createdAt: r.createdAt.toISOString() })),
      '部门列表',
    );
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', 'attachment; filename=departments.xlsx');
    return c.body(buffer) as never;
  },
});

departmentsRouter.openapiRoutes([listRoute, flatRoute, createRouteDef, updateRouteDef, deleteRouteDef, exportRouteDef] as const);

export default departmentsRouter;
