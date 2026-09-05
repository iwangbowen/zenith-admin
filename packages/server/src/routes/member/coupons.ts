import { OpenAPIHono } from '@hono/zod-openapi';
import { couponContract } from '@zenith/shared/member';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCoupons, getCoupon, createCoupon, updateCoupon, deleteCoupon, ensureCouponExists,
  issueCoupon, listMemberCoupons, revokeCoupon, getMemberCouponBeforeAudit,
  getMemberCouponByCode, redeemCoupon,
} from '../../services/member/coupons.service';

const couponsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'member:coupon:list' })] as const;

const listRoute = defineContractRoute(couponContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCoupons(c.req.valid('query'))), 200),
});

const recordsRoute = defineContractRoute(couponContract.records, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listMemberCoupons(c.req.valid('query'))), 200),
});

const revokeRoute = defineContractRoute(couponContract.revokeRecord, {
  middleware: [authMiddleware, guard({ permission: 'member:coupon:revoke', audit: { description: '作废优惠券', module: '优惠券' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMemberCouponBeforeAudit(id));
    await revokeCoupon(id);
    setAuditAfterData(c, await getMemberCouponBeforeAudit(id));
    return c.json(okBody(null, '已作废'), 200);
  },
});

const byCodeRoute = defineContractRoute(couponContract.byCode, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getMemberCouponByCode(c.req.valid('param').code)), 200),
});

const redeemRoute = defineContractRoute(couponContract.redeem, {
  middleware: [authMiddleware, guard({ permission: 'member:coupon:update', audit: { description: '核销优惠券', module: '优惠券' } }), idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { code, remark } = c.req.valid('json');
    setAuditBeforeData(c, await getMemberCouponByCode(code));
    const redeemed = await redeemCoupon(code, { bizType: 'manual_redeem', bizId: remark });
    setAuditAfterData(c, await getMemberCouponByCode(code));
    return c.json(okBody(redeemed, '核销成功'), 200);
  },
});

const detailRoute = defineContractRoute(couponContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCoupon(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(couponContract.create, {
  middleware: [authMiddleware, guard({ permission: 'member:coupon:create', audit: { description: '创建优惠券', module: '优惠券' } })],
  handler: async (c) => c.json(okBody(await createCoupon(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(couponContract.update, {
  middleware: [authMiddleware, guard({ permission: 'member:coupon:update', audit: { description: '更新优惠券', module: '优惠券' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureCouponExists(id));
    return c.json(okBody(await updateCoupon(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const issueRoute = defineContractRoute(couponContract.issue, {
  middleware: [authMiddleware, guard({ permission: 'member:coupon:issue', audit: { description: '发放优惠券', module: '优惠券' } }), idempotencyGuard({ ttlSeconds: 10 })],
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

const deleteRouteDef = defineContractRoute(couponContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'member:coupon:delete', audit: { description: '删除优惠券', module: '优惠券' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureCouponExists(id));
    await deleteCoupon(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// /records、/code/{code}、/redeem 必须在 /{id} 之前注册
couponsRouter.openapiRoutes([
  listRoute, recordsRoute, revokeRoute, byCodeRoute, redeemRoute, detailRoute, createRouteDef, updateRouteDef, issueRoute, deleteRouteDef,
] as const);

export default couponsRouter;
