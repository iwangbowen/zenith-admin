import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import {
  ErrorResponse, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, okBody, IdParam, PaginationQuery, BatchIdsBody,
} from '../../lib/openapi-schemas';
import { MemberDTO, MemberOverviewDTO, MemberOptionDTO, MemberLoginLogDTO, MakeupCheckinResultDTO } from '../../lib/openapi-dtos';
import {
  listMembers, getMemberDetail, getMemberOverview, getMemberOptions, listMemberLoginLogs, createMember, updateMember,
  setMemberStatus, batchSetMemberStatus, batchSetMemberLevel,
  resetMemberPasswordByAdmin, deleteMember,
  getMemberBeforeAudit, getMembersBeforeAudit,
} from '../../services/member/admin-members.service';
import { addGrowthValue } from '../../services/member/member-levels.service';
import { doMakeupCheckin, getMakeupCheckinBeforeAudit } from '../../services/member/member-checkin.service';

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
const adjustGrowthSchema = z.object({
  delta: z.number().int().refine((v) => v !== 0, '变动量不能为 0'),
  remark: z.string().max(256).optional(),
});

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
    const before = await getMembersBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await batchSetMemberStatus(ids, status);
    const after = await getMembersBeforeAudit(ids);
    if (after.length > 0) setAuditAfterData(c, after);
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
    const before = await getMembersBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await batchSetMemberLevel(ids, levelId);
    const after = await getMembersBeforeAudit(ids);
    if (after.length > 0) setAuditAfterData(c, after);
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

// ─── GET /options — 会员搜索下拉（轻量，必须在 /{id} 之前注册）────────────────
const optionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/options', tags: ['会员管理'], summary: '会员搜索下拉（轻量）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:list' })] as const,
    request: { query: z.object({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(MemberOptionDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getMemberOptions(c.req.valid('query').keyword)), 200),
});

// ─── GET /login-logs — 会员登录日志（跨会员，必须在 /{id} 之前注册）───────────
const loginLogQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
  status: z.enum(['success', 'fail']).optional(),
  dateStart: z.string().optional(),
  dateEnd: z.string().optional(),
});
const loginLogsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/login-logs', tags: ['会员管理'], summary: '会员登录日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:loginlog:list' })] as const,
    request: { query: loginLogQuery },
    responses: { ...commonErrorResponses, ...okPaginated(MemberLoginLogDTO, '会员登录日志') },
  }),
  handler: async (c) => {
    const { page = 1, pageSize = 20, ...rest } = c.req.valid('query');
    return c.json(okBody(await listMemberLoginLogs({ page, pageSize, ...rest })), 200);
  },
});

// ─── POST /{id}/checkin/makeup — 后台为会员补签 ───────────────────────────────
const makeupCheckinRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/checkin/makeup', tags: ['会员管理'], summary: '会员补签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:checkin:makeup', audit: { description: '会员补签', module: '会员签到' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ date: z.string().openapi({ example: '2026-06-18' }) })), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(MakeupCheckinResultDTO, '补签成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { date } = c.req.valid('json');
    setAuditBeforeData(c, await getMakeupCheckinBeforeAudit(id, date));
    const result = await doMakeupCheckin({ memberId: id, date, mode: 'admin' });
    setAuditAfterData(c, await getMakeupCheckinBeforeAudit(id, date));
    return c.json(okBody(result, '补签成功'), 200);
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
    setAuditBeforeData(c, await getMemberBeforeAudit(id));
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
    setAuditBeforeData(c, await getMemberBeforeAudit(id));
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
    setAuditBeforeData(c, await getMemberBeforeAudit(id));
    await resetMemberPasswordByAdmin(id, c.req.valid('json').newPassword);
    return c.json(okBody(null, '密码已重置'), 200);
  },
});

// ─── POST /{id}/growth — 调整成长值（自动按阈值重定级）──────────────────────
const adjustGrowthRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/growth', tags: ['会员管理'], summary: '调整会员成长值',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:update', audit: { description: '调整会员成长值', module: '会员管理' } }), idempotencyGuard({ ttlSeconds: 10 })] as const,
    request: { params: IdParam, body: { content: jsonContent(adjustGrowthSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberDTO, '已调整'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { delta, remark } = c.req.valid('json');
    setAuditBeforeData(c, await getMemberBeforeAudit(id));
    await addGrowthValue(id, delta);
    const after = await getMemberDetail(id);
    setAuditAfterData(c, { ...after, adjustRemark: remark ?? null });
    return c.json(okBody(after, '已调整'), 200);
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
    setAuditBeforeData(c, await getMemberBeforeAudit(id));
    await deleteMember(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

membersRouter.openapiRoutes([
  batchStatusRoute, batchLevelRoute, overviewRoute,
  listRoute, optionsRoute, loginLogsRoute, makeupCheckinRoute, adjustGrowthRoute, getOneRoute, createRoute_, updateRoute_, setStatusRoute, resetPwdRoute, deleteRoute_,
] as const);

export default membersRouter;
