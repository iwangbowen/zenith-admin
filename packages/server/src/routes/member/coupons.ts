import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import {
  ErrorResponse, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, okBody, IdParam, PaginationQuery,
} from '../../lib/openapi-schemas';
import { CouponDTO, MemberCouponDTO } from '../../lib/openapi-dtos';
import {
  listCoupons, getCoupon, createCoupon, updateCoupon, deleteCoupon, ensureCouponExists,
  issueCoupon, listMemberCoupons, revokeCoupon, getMemberCouponBeforeAudit,
  getMemberCouponByCode, redeemCoupon,
} from '../../services/member/coupons.service';

const couponsRouter = new OpenAPIHono({ defaultHook: validationHook });

const couponTypeEnum = z.enum(['amount', 'percent']);
const couponValidTypeEnum = z.enum(['fixed', 'relative']);
const couponStatusEnum = z.enum(['draft', 'active', 'paused', 'expired']);
const memberCouponStatusEnum = z.enum(['unused', 'used', 'expired', 'frozen']);

const listQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
  status: couponStatusEnum.optional(),
  type: couponTypeEnum.optional(),
});
const recordsQuery = PaginationQuery.extend({
  memberKeyword: z.string().optional(),
  couponId: z.coerce.number().int().positive().optional(),
  status: memberCouponStatusEnum.optional(),
});
const createCouponSchema = z.object({
  name: z.string().min(1).max(64),
  type: couponTypeEnum,
  faceValue: z.number().int().min(1),
  threshold: z.number().int().min(0).optional(),
  maxDiscount: z.number().int().min(0).nullable().optional(),
  totalQuantity: z.number().int().min(0).optional(),
  perLimit: z.number().int().min(0).optional(),
  validType: couponValidTypeEnum,
  validStart: z.string().optional(),
  validEnd: z.string().optional(),
  validDays: z.number().int().min(1).nullable().optional(),
  exchangePoints: z.number().int().min(0).optional(),
  status: couponStatusEnum.optional(),
  description: z.string().max(256).nullable().optional(),
});
const updateCouponSchema = createCouponSchema.partial();
const issueSchema = z.object({ memberId: z.number().int().positive() });

// ─── GET / — 优惠券模板列表 ──────────────────────────────────────────────────
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['优惠券'], summary: '优惠券模板列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:coupon:list' })] as const,
    request: { query: listQuery },
    responses: { ...commonErrorResponses, ...okPaginated(CouponDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listCoupons(c.req.valid('query'))), 200),
});

// ─── GET /records — 领券记录（在 /{id} 之前注册）────────────────────────────
const recordsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/records', tags: ['优惠券'], summary: '领券记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:coupon:list' })] as const,
    request: { query: recordsQuery },
    responses: { ...commonErrorResponses, ...okPaginated(MemberCouponDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMemberCoupons(c.req.valid('query'))), 200),
});

// ─── POST /records/{id}/revoke — 作废券码 ────────────────────────────────────
const revokeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/records/{id}/revoke', tags: ['优惠券'], summary: '作废券码',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:coupon:revoke', audit: { description: '作废优惠券', module: '优惠券' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已作废') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMemberCouponBeforeAudit(id));
    await revokeCoupon(id);
    setAuditAfterData(c, await getMemberCouponBeforeAudit(id));
    return c.json(okBody(null, '已作废'), 200);
  },
});

// ─── GET /{id} — 优惠券详情 ──────────────────────────────────────────────────
const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['优惠券'], summary: '优惠券详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:coupon:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CouponDTO, 'ok'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await getCoupon(c.req.valid('param').id)), 200),
});

// ─── POST / — 创建优惠券 ─────────────────────────────────────────────────────
const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['优惠券'], summary: '创建优惠券',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:coupon:create', audit: { description: '创建优惠券', module: '优惠券' } })] as const,
    request: { body: { content: jsonContent(createCouponSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CouponDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCoupon(c.req.valid('json')), '创建成功'), 200),
});

// ─── PUT /{id} — 更新优惠券 ──────────────────────────────────────────────────
const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['优惠券'], summary: '更新优惠券',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:coupon:update', audit: { description: '更新优惠券', module: '优惠券' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCouponSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CouponDTO, '更新成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureCouponExists(id));
    return c.json(okBody(await updateCoupon(id, c.req.valid('json')), '更新成功'), 200);
  },
});

// ─── GET /code/{code} — 按券码查询（核销预览，在 /{id} 之前注册）──────────────
const codeQueryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/code/{code}', tags: ['优惠券'], summary: '按券码查询券详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:coupon:list' })] as const,
    request: { params: z.object({ code: z.string().min(4).max(32) }) },
    responses: { ...commonErrorResponses, ...ok(MemberCouponDTO, 'ok'), 404: { content: jsonContent(ErrorResponse), description: '券码不存在' } },
  }),
  handler: async (c) => c.json(okBody(await getMemberCouponByCode(c.req.valid('param').code)), 200),
});

// ─── POST /redeem — 核销券码 ─────────────────────────────────────────────────
const redeemRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/redeem', tags: ['优惠券'], summary: '核销券码',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:coupon:update', audit: { description: '核销优惠券', module: '优惠券' } }), idempotencyGuard({ ttlSeconds: 10 })] as const,
    request: { body: { content: jsonContent(z.object({ code: z.string().min(4).max(32), remark: z.string().max(128).optional() })), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberCouponDTO, '核销成功') },
  }),
  handler: async (c) => {
    const { code, remark } = c.req.valid('json');
    setAuditBeforeData(c, await getMemberCouponByCode(code));
    const redeemed = await redeemCoupon(code, { bizType: 'manual_redeem', bizId: remark });
    setAuditAfterData(c, await getMemberCouponByCode(code));
    return c.json(okBody(redeemed, '核销成功'), 200);
  },
});

// ─── POST /{id}/issue — 发券给会员 ───────────────────────────────────────────
const issueRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/issue', tags: ['优惠券'], summary: '发券给会员',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:coupon:issue', audit: { description: '发放优惠券', module: '优惠券' } }), idempotencyGuard({ ttlSeconds: 10 })] as const,
    request: { params: IdParam, body: { content: jsonContent(issueSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberCouponDTO, '发放成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { memberId } = c.req.valid('json');
    setAuditBeforeData(c, await ensureCouponExists(id));
    const issued = await issueCoupon(id, memberId);
    setAuditAfterData(c, {
      coupon: await ensureCouponExists(id),
      issued,
    });
    return c.json(okBody(issued, '发放成功'), 200);
  },
});

// ─── DELETE /{id} — 删除优惠券 ───────────────────────────────────────────────
const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['优惠券'], summary: '删除优惠券',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:coupon:delete', audit: { description: '删除优惠券', module: '优惠券' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureCouponExists(id));
    await deleteCoupon(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

couponsRouter.openapiRoutes([
  listRoute, recordsRoute, revokeRoute, codeQueryRoute, redeemRoute, getOneRoute, createRoute_, updateRoute_, issueRoute, deleteRoute_,
] as const);

export default couponsRouter;
