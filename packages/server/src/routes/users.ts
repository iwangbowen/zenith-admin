import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody, okExcel, excelBody,
} from '../lib/openapi-schemas';
import { UserDTO, ImportResultDTO } from '../lib/openapi-dtos';
import {
  listAllUsers, listUsers, createUser, batchDeleteUsers, batchUpdateUserStatus,
  updateUser, deleteUser, updateUserPassword, unlockUserById,
  exportUsers, getUserImportTemplate, importUsers, getUserBeforeAudit,
} from '../services/users.service';

const usersRouter = new OpenAPIHono({ defaultHook: validationHook });

const createUserSchema = z.object({
  username: z.string().min(3).max(32),
  nickname: z.string().min(1).max(32),
  email: z.email(),
  password: z.string().min(6).max(64),
  phone: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^1[3-9]\d{9}$/).optional()),
  departmentId: z.number().int().positive().nullable().optional(),
  positionIds: z.array(z.number().int().positive()).default([]),
  roleIds: z.array(z.number().int()).default([]),
  status: z.enum(['active', 'disabled']).default('active'),
});
const updateUserSchema = z.object({
  username: z.string().min(3).max(32).optional(),
  nickname: z.string().min(1).max(32).optional(),
  email: z.email().optional(),
  phone: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^1[3-9]\d{9}$/).optional()),
  departmentId: z.number().int().positive().nullable().optional(),
  positionIds: z.array(z.number().int().positive()).optional(),
  roleIds: z.array(z.number().int()).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});
const resetUserPasswordSchema = z.object({ password: z.string().min(6).max(64) });
const batchIdsSchema = z.object({ ids: z.array(z.number().int()) });
const batchStatusSchema = z.object({ ids: z.array(z.number().int()), status: z.enum(['active', 'disabled']) });

const getAllUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/all', tags: ['Users'], summary: '全量用户（供下拉框）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:list' })] as const,
    request: {},
    responses: { ...commonErrorResponses, ...ok(z.array(UserDTO), '全量用户') },
  }),
  handler: async (c) => c.json(okBody(await listAllUsers(c.get('user'))), 200),
});

const listUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Users'], summary: '用户列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(), phone: z.string().optional(),
        departmentId: z.coerce.number().optional(), status: z.enum(['active', 'disabled']).optional(),
        startTime: z.string().optional(), endTime: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(UserDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listUsers(c.get('user'), c.req.valid('query'))), 200),
});

const createUserRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['Users'], summary: '创建用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:create', audit: { description: '创建用户', module: '用户管理' } })] as const,
    request: { body: { content: jsonContent(createUserSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(UserDTO, '创建成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => c.json(okBody(await createUser(c.get('user'), c.req.valid('json')), '创建成功'), 200),
});

const batchDeleteUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch', tags: ['Users'], summary: '批量删除用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:delete', audit: { description: '批量删除用户', module: '用户管理' } })] as const,
    request: { body: { content: jsonContent(batchIdsSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await batchDeleteUsers(c.get('user'), ids);
    return c.json(okBody(null, `已删除 ${count} 个用户`), 200);
  },
});

const batchStatusUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/batch-status', tags: ['Users'], summary: '批量修改用户状态',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:update', audit: { description: '批量修改用户状态', module: '用户管理' } })] as const,
    request: { body: { content: jsonContent(batchStatusSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    await batchUpdateUserStatus(c.get('user'), ids, status);
    return c.json(okBody(null, '状态已更新'), 200);
  },
});

const importTemplateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/import-template', tags: ['Users'], summary: '下载导入模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:import' })] as const,
    responses: { ...commonErrorResponses, ...okExcel() },
  }),
  handler: async (c) => excelBody(c, await getUserImportTemplate(), 'user_import_template.xlsx'),
});

const importUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/import', tags: ['Users'], summary: '导入用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:import', audit: { description: '导入用户', module: '用户管理' } })] as const,
    request: {
      body: { content: { 'multipart/form-data': { schema: z.object({ file: z.any() }) } }, required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(ImportResultDTO, 'ok'),
      400: { content: jsonContent(ErrorResponse), description: '文件无效' },
    },
  }),
  handler: async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) throw new Error('请上传文件');
    const result = await importUsers(c.get('user'), file);
    return c.json(okBody(result, '导入完成'), 200);
  },
});

const exportUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['Users'], summary: '导出用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:list' })] as const,
    responses: { ...commonErrorResponses, ...okExcel() },
  }),
  handler: async (c) => {
    const { buffer, filename } = await exportUsers(c.get('user'));
    return excelBody(c, buffer, filename);
  },
});

const updateUserPasswordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/password', tags: ['Users'], summary: '修改用户密码',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:update', audit: { description: '修改用户密码', module: '用户管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(resetUserPasswordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '用户不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { password } = c.req.valid('json');
    await updateUserPassword(c.get('user'), id, password);
    return c.json(okBody(null, '密码修改成功'), 200);
  },
});

const unlockUserRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/unlock', tags: ['Users'], summary: '解锁账号',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:update', audit: { description: '解除账号锁定', module: '用户管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      404: { content: jsonContent(ErrorResponse), description: '用户不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await unlockUserById(c.get('user'), id);
    return c.json(okBody(null, '解锁成功'), 200);
  },
});

const updateUserRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['Users'], summary: '更新用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:update', audit: { description: '更新用户', module: '用户管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateUserSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(UserDTO, '更新成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '用户不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getUserBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const updated = await updateUser(c.get('user'), id, c.req.valid('json'));
    return c.json(okBody(updated, '更新成功'), 200);
  },
});

const deleteUserRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['Users'], summary: '删除用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:delete', audit: { description: '删除用户', module: '用户管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '用户不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getUserBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteUser(c.get('user'), id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

usersRouter.openapiRoutes([
  getAllUsersRoute, listUsersRoute, createUserRoute, batchDeleteUsersRoute, batchStatusUsersRoute,
  importTemplateRoute, importUsersRoute, exportUsersRoute, updateUserPasswordRoute, unlockUserRoute,
  updateUserRoute, deleteUserRoute,
] as const);

export default usersRouter;
