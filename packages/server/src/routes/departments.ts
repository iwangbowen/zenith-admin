import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { createDepartmentSchema, updateDepartmentSchema } from '@zenith/shared';
import { jsonContent, validationHook, commonErrorResponses, ok, okMsg, IdParam, okBody, okExcel, excelStreamBody } from '../lib/openapi-schemas';
import { DepartmentDTO } from '../lib/openapi-dtos';
import {
  listDepartmentTree,
  listDepartmentsFlat,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  exportDepartments,
  getDepartmentBeforeAudit,
} from '../services/departments.service';

const departmentsRouter = new OpenAPIHono({ defaultHook: validationHook });

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
    const query = c.req.valid('query');
    return c.json(okBody(await listDepartmentTree(query)), 200);
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
    return c.json(okBody(await listDepartmentsFlat()), 200);
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
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');
    const dept = await createDepartment(data);
    return c.json(okBody(dept, '创建成功'), 200);
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
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const before = await getDepartmentBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const dept = await updateDepartment(id, data);
    return c.json(okBody(dept, '更新成功'), 200);
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
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDepartmentBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteDepartment(id);
    return c.json(okBody(null, '删除成功'), 200);
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
      ...okExcel('Excel 文件'),
    },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportDepartments();
    return excelStreamBody(c, stream, filename);
  },
});

departmentsRouter.openapiRoutes([listRoute, flatRoute, createRouteDef, updateRouteDef, deleteRouteDef, exportRouteDef] as const);

export default departmentsRouter;
