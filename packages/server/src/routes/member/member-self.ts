import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { memberAuthMiddleware } from '../../middleware/member-auth';
import { idempotencyGuard } from '../../middleware/idempotency';
import {
  jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okBody, PaginationQuery,
} from '../../lib/openapi-schemas';
import {
  MemberPointAccountDTO,
  MemberPointTransactionDTO,
  MemberWalletDTO,
  MemberWalletTransactionDTO,
  MemberWalletRechargeResultDTO,
  MemberLevelDTO,
  MemberCouponDTO,
  CouponDTO,
  MemberLoginLogDTO,
  MemberCheckinStatusDTO,
  MemberCheckinDTO,
  MemberMilestoneStatusDTO,
  MakeupCheckinResultDTO,
} from '../../lib/openapi-dtos';
import { currentMemberId } from '../../lib/member-context';
import { getClientInfo } from '../../services/identity/auth.service';
import { getMyPointAccount, listMyPointTransactions } from '../../services/member/member-points.service';
import { getMyWallet, listMyWalletTransactions, rechargeWallet } from '../../services/member/member-wallet.service';
import { getEnabledLevels } from '../../services/member/member-levels.service';
import { listMyCoupons, getAvailableCoupons, receiveCoupon, getExchangeableCoupons, exchangePointsForCoupon } from '../../services/member/coupons.service';
import { doCheckin, getMemberCheckinStatus, getMyCheckinHistory, doMyMakeupCheckin, getMyMilestones } from '../../services/member/member-checkin.service';
import { db } from '../../db';
import { memberLoginLogs } from '../../db/schema';
import { desc, eq } from 'drizzle-orm';
import { formatDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';

const memberSelf = new OpenAPIHono({ defaultHook: validationHook });

const pointTypeEnum = z.enum(['earn', 'redeem', 'expire', 'adjust', 'refund']);
const walletTypeEnum = z.enum(['recharge', 'consume', 'refund', 'adjust']);
const memberCouponStatusEnum = z.enum(['unused', 'used', 'expired', 'frozen']);
const payMethodEnum = z.enum(['wechat_native', 'wechat_jsapi', 'wechat_h5', 'alipay_page', 'alipay_wap', 'alipay_app', 'unionpay_qr']);

const rechargeSchema = z.object({
  amount: z.number().int().positive('充值金额必须大于 0'),
  payMethod: payMethodEnum,
});
const receiveCouponSchema = z.object({ couponId: z.number().int().positive() });
const checkinResultSchema = z.object({
  consecutiveDays: z.number().int(),
  points: z.number().int(),
  experience: z.number().int(),
  checkinDate: z.string(),
});

// ─── GET /points/account — 我的积分账户 ──────────────────────────────────────
const pointAccountRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/points/account', tags: ['MemberSelf'], summary: '我的积分账户',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(MemberPointAccountDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getMyPointAccount()), 200),
});

// ─── GET /points/transactions — 我的积分流水 ─────────────────────────────────
const pointTxRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/points/transactions', tags: ['MemberSelf'], summary: '我的积分流水',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { query: PaginationQuery.extend({ type: pointTypeEnum.optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(MemberPointTransactionDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyPointTransactions(c.req.valid('query'))), 200),
});

// ─── GET /wallet — 我的钱包 ──────────────────────────────────────────────────
const walletRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/wallet', tags: ['MemberSelf'], summary: '我的钱包',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(MemberWalletDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getMyWallet()), 200),
});

// ─── GET /wallet/transactions — 钱包流水 ─────────────────────────────────────
const walletTxRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/wallet/transactions', tags: ['MemberSelf'], summary: '我的钱包流水',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { query: PaginationQuery.extend({ type: walletTypeEnum.optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(MemberWalletTransactionDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyWalletTransactions(c.req.valid('query'))), 200),
});

// ─── POST /wallet/recharge — 发起充值 ────────────────────────────────────────
const rechargeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/wallet/recharge', tags: ['MemberSelf'], summary: '发起钱包充值',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 10 })] as const,
    request: { body: { content: jsonContent(rechargeSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberWalletRechargeResultDTO, '已创建充值订单') },
  }),
  handler: async (c) => {
    const { amount, payMethod } = c.req.valid('json');
    const { ip } = getClientInfo(c.req.raw.headers);
    const result = await rechargeWallet(currentMemberId(), amount, payMethod, ip);
    return c.json(okBody(result, '已创建充值订单'), 200);
  },
});

// ─── GET /levels — 会员等级权益 ──────────────────────────────────────────────
const levelsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/levels', tags: ['MemberSelf'], summary: '会员等级权益列表',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(MemberLevelDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getEnabledLevels()), 200),
});

// ─── GET /coupons — 我的优惠券 ───────────────────────────────────────────────
const myCouponsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/coupons', tags: ['MemberSelf'], summary: '我的优惠券',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { query: PaginationQuery.extend({ status: memberCouponStatusEnum.optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(MemberCouponDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyCoupons(c.req.valid('query'))), 200),
});

// ─── GET /coupons/available — 可领取优惠券 ───────────────────────────────────
const availableCouponsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/coupons/available', tags: ['MemberSelf'], summary: '可领取的优惠券',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(CouponDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getAvailableCoupons()), 200),
});

// ─── POST /coupons/receive — 领取优惠券 ──────────────────────────────────────
const receiveCouponRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/coupons/receive', tags: ['MemberSelf'], summary: '领取优惠券',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 5 })] as const,
    request: { body: { content: jsonContent(receiveCouponSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberCouponDTO, '领取成功') },
  }),
  handler: async (c) => {
    const { couponId } = c.req.valid('json');
    const r = await receiveCoupon(couponId);
    return c.json(okBody(r, '领取成功'), 200);
  },
});

// ─── GET /coupons/exchangeable — 可积分兑换的优惠券 ──────────────────────────
const exchangeableCouponsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/coupons/exchangeable', tags: ['MemberSelf'], summary: '可积分兑换的优惠券',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(CouponDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getExchangeableCoupons()), 200),
});

// ─── POST /coupons/exchange — 积分兑换优惠券 ─────────────────────────────────
const exchangeCouponRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/coupons/exchange', tags: ['MemberSelf'], summary: '积分兑换优惠券',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 5 })] as const,
    request: { body: { content: jsonContent(receiveCouponSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberCouponDTO, '兑换成功') },
  }),
  handler: async (c) => {
    const { couponId } = c.req.valid('json');
    const r = await exchangePointsForCoupon(couponId);
    return c.json(okBody(r, '兑换成功'), 200);
  },
});

// ─── GET /checkin/status — 今日签到状态 ────────────────────────────────────────
const checkinStatusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/checkin/status', tags: ['MemberSelf'], summary: '今日签到状态',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(MemberCheckinStatusDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getMemberCheckinStatus()), 200),
});

// ─── POST /checkin — 执行签到 ────────────────────────────────────────────────
const checkinRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/checkin', tags: ['MemberSelf'], summary: '执行签到',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 5 })] as const,
    responses: { ...commonErrorResponses, ...ok(checkinResultSchema, '签到成功') },
  }),
  handler: async (c) => c.json(okBody(await doCheckin(), '签到成功'), 200),
});

// ─── GET /checkin/history — 我的签到历史 ──────────────────────────────────────
const checkinHistoryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/checkin/history', tags: ['MemberSelf'], summary: '我的签到历史',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: {
      query: PaginationQuery.extend({
        dateStart: z.string().optional().openapi({ param: { name: 'dateStart', in: 'query' }, example: '2026-06-01' }),
        dateEnd: z.string().optional().openapi({ param: { name: 'dateEnd', in: 'query' }, example: '2026-06-30' }),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(MemberCheckinDTO, '签到历史') },
  }),
  handler: async (c) => c.json(okBody(await getMyCheckinHistory(c.req.valid('query'))), 200),
});

// ─── POST /checkin/makeup — 自助补签（消耗积分）─────────────────────────────────
const checkinMakeupRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/checkin/makeup', tags: ['MemberSelf'], summary: '自助补签',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 5 })] as const,
    request: { body: { content: jsonContent(z.object({ date: z.string().openapi({ example: '2026-06-18' }) })), required: true } },
    responses: { ...commonErrorResponses, ...ok(MakeupCheckinResultDTO, '补签成功') },
  }),
  handler: async (c) => c.json(okBody(await doMyMakeupCheckin(c.req.valid('json').date), '补签成功'), 200),
});

// ─── GET /checkin/milestones — 我的里程碑 ─────────────────────────────────────
const checkinMilestonesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/checkin/milestones', tags: ['MemberSelf'], summary: '我的签到里程碑',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(MemberMilestoneStatusDTO, '里程碑达成情况') },
  }),
  handler: async (c) => c.json(okBody(await getMyMilestones()), 200),
});

// ─── GET /login-logs — 我的登录历史 ──────────────────────────────────────────
const loginLogsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/login-logs', tags: ['MemberSelf'], summary: '我的登录历史',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(MemberLoginLogDTO, '登录历史') },
  }),
  handler: async (c) => {
    const memberId = currentMemberId();
    const { page = 1, pageSize = 20 } = c.req.valid('query');
    const [list, total] = await Promise.all([
      db.select().from(memberLoginLogs)
        .where(eq(memberLoginLogs.memberId, memberId))
        .orderBy(desc(memberLoginLogs.createdAt))
        .limit(pageSize)
        .offset(pageOffset(page, pageSize)),
      db.$count(memberLoginLogs, eq(memberLoginLogs.memberId, memberId)),
    ]);
    return c.json(okBody({
      list: list.map(r => ({
        id: r.id,
        memberId: r.memberId,
        ip: r.ip,
        location: r.location,
        browser: r.browser,
        os: r.os,
        userAgent: r.userAgent,
        status: r.status,
        message: r.message,
        createdAt: formatDateTime(r.createdAt),
      })),
      total,
      page,
      pageSize,
    }), 200);
  },
});

memberSelf.openapiRoutes([
  pointAccountRoute,
  pointTxRoute,
  walletRoute,
  walletTxRoute,
  rechargeRoute,
  levelsRoute,
  checkinStatusRoute,
  checkinRoute,
  checkinHistoryRoute,
  checkinMakeupRoute,
  checkinMilestonesRoute,
  availableCouponsRoute,
  exchangeableCouponsRoute,
  myCouponsRoute,
  receiveCouponRoute,
  exchangeCouponRoute,
  loginLogsRoute,
] as const);

export default memberSelf;
