import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, conflictResponse, ok, okPaginated, okMsg, IdParam, okBody } from '../../lib/openapi-schemas';
import { UserGroupDTO, UserGroupMemberDTO } from '../../lib/openapi-dtos';
import {
  listAllUserGroups,
  listUserGroups,
  getUserGroup,
  createUserGroup,
  updateUserGroup,
  deleteUserGroup,
  batchDeleteUserGroups,
  getUserGroupBeforeAudit,
  getUserGroupsBeforeAudit,
  listGroupMembers,
  setGroupMembers,
  addGroupMembers,
  removeGroupMembers,
  getUserGroupMembersBeforeAudit,
} from '../../services/identity/user-groups.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const createSchema = z.object({
  name: z.string().min(1).max(64),
  code: z.string().min(1).max(64).regex(/^\w+$/),
  description: z.string().max(256).optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});
const updateSchema = createSchema.partial();
const BatchDeleteBody = z.object({ ids: z.array(z.number()) });
const MembersBody = z.object({ userIds: z.array(z.number().int().positive()) });

const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/all', tags: ['UserGroups'], summary: '全量用户组（供下拉框）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user-groups:list' })] as const,
    request: {},
    responses: { ...ok(z.array(UserGroupDTO), '全量用户组'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listAllUserGroups()), 200),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['UserGroups'], summary: '用户组列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user-groups:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...okPaginated(UserGroupDTO, '用户组列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listUserGroups(c.req.valid('query'))), 200),
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['UserGroups'], summary: '获取用户组详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user-groups:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(UserGroupDTO, '用户组详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getUserGroup(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['UserGroups'], summary: '新增用户组',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user-groups:create', audit: { description: '创建用户组', module: '用户组管理' } })] as const,
    request: { body: { content: jsonContent(createSchema), required: true } },
    responses: { ...ok(UserGroupDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createUserGroup(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['UserGroups'], summary: '更新用户组',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user-groups:update', audit: { description: '更新用户组', module: '用户组管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateSchema), required: true } },
    responses: { ...ok(UserGroupDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getUserGroupBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateUserGroup(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const batchDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch', tags: ['UserGroups'], summary: '批量删除用户组',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user-groups:delete', audit: { description: '批量删除用户组', module: '用户组管理' } })] as const,
    request: { body: { content: jsonContent(BatchDeleteBody), required: true } },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses, ...conflictResponse },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getUserGroupsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const { count } = await batchDeleteUserGroups(ids);
    return c.json(okBody(null, `已删除 ${count} 个用户组`), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['UserGroups'], summary: '删除用户组',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user-groups:delete', audit: { description: '删除用户组', module: '用户组管理' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses, ...conflictResponse },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getUserGroupBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteUserGroup(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listMembersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/members', tags: ['UserGroups'], summary: '获取用户组成员',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user-groups:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(z.array(UserGroupMemberDTO), '成员列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listGroupMembers(c.req.valid('param').id)), 200),
});

const setMembersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/members', tags: ['UserGroups'], summary: '设置用户组成员（全量覆盖）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user-groups:assign', audit: { description: '设置用户组成员', module: '用户组管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(MembersBody), required: true } },
    responses: { ...okMsg('保存成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userIds } = c.req.valid('json');
    const before = await getUserGroupMembersBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await setGroupMembers(id, userIds);
    const after = await getUserGroupMembersBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

const addMembersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/members', tags: ['UserGroups'], summary: '添加用户组成员',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user-groups:assign', audit: { description: '添加用户组成员', module: '用户组管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(MembersBody), required: true } },
    responses: { ...okMsg('添加成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userIds } = c.req.valid('json');
    const before = await getUserGroupMembersBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await addGroupMembers(id, userIds);
    const after = await getUserGroupMembersBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '添加成功'), 200);
  },
});

const removeMembersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}/members', tags: ['UserGroups'], summary: '移除用户组成员',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user-groups:assign', audit: { description: '移除用户组成员', module: '用户组管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(MembersBody), required: true } },
    responses: { ...okMsg('移除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userIds } = c.req.valid('json');
    const before = await getUserGroupMembersBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await removeGroupMembers(id, userIds);
    const after = await getUserGroupMembersBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '移除成功'), 200);
  },
});

router.openapiRoutes([
  allRoute,
  listRoute,
  listMembersRoute,
  setMembersRoute,
  addMembersRoute,
  removeMembersRoute,
  getRoute,
  createRouteDef,
  updateRouteDef,
  batchDeleteRoute,
  deleteRoute,
] as const);

export default router;
