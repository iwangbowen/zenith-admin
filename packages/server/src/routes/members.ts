import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  ErrorResponse, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, okBody, IdParam, PaginationQuery, okExcel, excelStreamBody, BatchIdsBody,
} from '../lib/openapi-schemas';
import { MemberDTO, MemberOverviewDTO } from '../lib/openapi-dtos';
import {
  listMembers, getMemberDetail, getMemberOverview, createMember, updateMember,
  setMemberStatus, batchSetMemberStatus, batchSetMemberLevel,
  resetMemberPasswordByAdmin, deleteMember, exportMembers,
} from '../services/admin-members.service';
import { ensureMemberExists } from '../services/member-auth.service';

const membersRouter = new OpenAPIHono({ defaultHook: validationHook });

const phoneRegex = /^1[3-9]\d{9}$/;
const statusEnum = z.enum(['active', 'inactive', 'banned']);

const batchStatusSchema = z.object({ ids: BatchIdsBody.shape.ids, status: statusEnum });
const batchLevelSchema = z.object({ ids: BatchIdsBody.shape.ids, levelId: z.number().int().positive().nullable() });

const listQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
  status: statusEnum.optional(),
  levelId: z.coerce.number().int().positive().optional(),
});
const exportQuery = z.object({
  keyword: z.string().optional(),
  status: statusEnum.optional(),
  levelId: z.coerce.number().int().positive().optional(),
});
const createMemberSchema = z.object({
  username: z.string().min(2).max(32).optional(),
  phone: z.string().regex(phoneRegex).optional(),
  email: z.email().optional(),
  password: z.string().min(6).max(64).optional(),
  nickname: z.string().min(1).max(32),
  gender: z.string().max(20).nullable().optional(),
  status: statusEnum.optional(),
  levelId: z.number().int().positive().nullable().optional(),
  remark: z.string().max(256).nullable().optional(),
});
const updateMemberSchema = z.object({
  nickname: z.string().min(1).max(32).optional(),
  phone: z.string().regex(phoneRegex).nullable().optional(),
  email: z.email().nullish(),
  gender: z.string().max(20).nullable().optional(),
  avatar: z.string().max(256).nullish(),
  status: statusEnum.optional(),
  levelId: z.number().int().positive().nullable().optional(),
  remark: z.string().max(256).nullable().optional(),
});
const setStatusSchema = z.object({ status: statusEnum });
const resetPwdSchema = z.object({ newPassword: z.string().min(6).max(64) });

// ─── PUT /batch-status — 批量更改状态 ────────────────────────────────────────
const batchStatusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/batch-status', tags: ['会员管理'], summary: '批量更改会员状态',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:update', audit: { description: '批量更改会员状态', module: '会员管理' } })] as const,
    request: { body: { content: jsonContent(batchStatusSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已更新') },
  }),
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const count = await batchSetMemberStatus(ids, status);
    return c.json(okBody(null, `已更新 ${count} 名会员状态`), 200);
  },
});

// ─── PUT /batch-level — 批量调整等级 ─────────────────────────────────────────
const batchLevelRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/batch-level', tags: ['会员管理'], summary: '批量调整会员等级',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:update', audit: { description: '批量调整会员等级', module: '会员管理' } })] as const,
    request: { body: { content: jsonContent(batchLevelSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已更新') },
  }),
  handler: async (c) => {
    const { ids, levelId } = c.req.valid('json');
    const count = await batchSetMemberLevel(ids, levelId);
    return c.json(okBody(null, `已调整 ${count} 名会员等级`), 200);
  },
});

// ─── GET /{id}/overview — 会员概览（详情侧滑）────────────────────────────────
const overviewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/overview', tags: ['会员管理'], summary: '会员概览（详情侧滑）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(MemberOverviewDTO, 'ok'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await getMemberOverview(c.req.valid('param').id)), 200),
});

// ─── GET / — 会员列表 ────────────────────────────────────────────────────────
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['会员管理'], summary: '会员列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:list' })] as const,
    request: { query: listQuery },
    responses: { ...commonErrorResponses, ...okPaginated(MemberDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMembers(c.req.valid('query'))), 200),
});

// ─── GET /export — 导出（必须在 /{id} 之前注册）──────────────────────────────
const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['会员管理'], summary: '导出会员',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:list' })] as const,
    request: { query: exportQuery },
    responses: { ...commonErrorResponses, ...okExcel('会员 Excel') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportMembers(c.req.valid('query'));
    return excelStreamBody(c, stream, filename);
  },
});

// ─── GET /{id} — 会员详情 ────────────────────────────────────────────────────
const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['会员管理'], summary: '会员详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(MemberDTO, 'ok'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await getMemberDetail(c.req.valid('param').id)), 200),
});

// ─── POST / — 创建会员 ───────────────────────────────────────────────────────
const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['会员管理'], summary: '创建会员',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:create', audit: { description: '创建会员', module: '会员管理' } })] as const,
    request: { body: { content: jsonContent(createMemberSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createMember(c.req.valid('json')), '创建成功'), 200),
});

// ─── PUT /{id} — 更新会员 ────────────────────────────────────────────────────
const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['会员管理'], summary: '更新会员',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:update', audit: { description: '更新会员', module: '会员管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateMemberSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberDTO, '更新成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureMemberExists(id);
    const { password: _pw, ...safeBefore } = before;
    setAuditBeforeData(c, safeBefore);
    return c.json(okBody(await updateMember(id, c.req.valid('json')), '更新成功'), 200);
  },
});

// ─── PUT /{id}/status — 启用/禁用/封禁 ───────────────────────────────────────
const setStatusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/status', tags: ['会员管理'], summary: '设置会员状态',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:update', audit: { description: '设置会员状态', module: '会员管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(setStatusSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberDTO, '已更新') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('json');
    return c.json(okBody(await setMemberStatus(id, status), '已更新'), 200);
  },
});

// ─── POST /{id}/reset-password — 重置密码 ────────────────────────────────────
const resetPwdRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/reset-password', tags: ['会员管理'], summary: '重置会员密码',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:update', audit: { description: '重置会员密码', module: '会员管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(resetPwdSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('密码已重置') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await resetMemberPasswordByAdmin(id, c.req.valid('json').newPassword);
    return c.json(okBody(null, '密码已重置'), 200);
  },
});

// ─── DELETE /{id} — 删除会员 ─────────────────────────────────────────────────
const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['会员管理'], summary: '删除会员',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:delete', audit: { description: '删除会员', module: '会员管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureMemberExists(id);
    const { password: _pw, ...safeBefore } = before;
    setAuditBeforeData(c, safeBefore);
    await deleteMember(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

membersRouter.openapiRoutes([
  batchStatusRoute, batchLevelRoute, overviewRoute,
  listRoute, exportRoute, getOneRoute, createRoute_, updateRoute_, setStatusRoute, resetPwdRoute, deleteRoute_,
] as const);

export default membersRouter;
