import { OpenAPIHono } from '@hono/zod-openapi';
import { memberSelfContract } from '@zenith/shared/member';
import { memberAuthMiddleware } from '../../middleware/member-auth';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { currentMemberId } from '../../lib/member-context';
import { getClientInfo } from '../../lib/request-helpers';
import { getMyPointAccount, listMyPointTransactions } from '../../services/member/member-points.service';
import { getMyWallet, listMyWalletTransactions, rechargeWallet } from '../../services/member/member-wallet.service';
import { getEnabledLevels } from '../../services/member/member-levels.service';
import { listMyCoupons, getAvailableCoupons, receiveCoupon, getExchangeableCoupons, exchangePointsForCoupon } from '../../services/member/coupons.service';
import { doCheckin, getMemberCheckinStatus, getMyCheckinHistory, doMyMakeupCheckin, getMyMilestones } from '../../services/member/member-checkin.service';
import { getMyBenefits } from '../../services/member/member-benefits.service';
import { listMyNotifications, getMyUnreadCount, markMyNotificationRead, markAllMyNotificationsRead } from '../../services/member/member-notifications.service';
import { getMyInviteSummary } from '../../services/member/member-invite.service';
import { listMyLoginLogs } from '../../services/member/member-auth.service';
import { listMemberPaymentOptions } from '../../services/member/member-payment-options.service';

const memberSelf = new OpenAPIHono({ defaultHook: validationHook });

const member = [memberAuthMiddleware] as const;

const pointAccountRoute = defineContractRoute(memberSelfContract.pointAccount, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getMyPointAccount()), 200),
});

const pointTxRoute = defineContractRoute(memberSelfContract.pointTransactions, {
  middleware: member,
  handler: async (c) => c.json(okBody(await listMyPointTransactions(c.req.valid('query'))), 200),
});

const walletRoute = defineContractRoute(memberSelfContract.wallet, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getMyWallet()), 200),
});

const paymentOptionsRoute = defineContractRoute(memberSelfContract.paymentOptions, {
  middleware: member,
  handler: async (c) => c.json(okBody(await listMemberPaymentOptions()), 200),
});

const walletTxRoute = defineContractRoute(memberSelfContract.walletTransactions, {
  middleware: member,
  handler: async (c) => c.json(okBody(await listMyWalletTransactions(c.req.valid('query'))), 200),
});

const rechargeRoute = defineContractRoute(memberSelfContract.recharge, {
  middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { applicationId, amount, payMethod, memberCouponId } = c.req.valid('json');
    const { ip } = getClientInfo(c);
    const result = await rechargeWallet(currentMemberId(), applicationId, amount, payMethod, ip, memberCouponId);
    return c.json(okBody(result, '已创建充值订单'), 200);
  },
});

const levelsRoute = defineContractRoute(memberSelfContract.levels, {
  middleware: [] as const,
  handler: async (c) => c.json(okBody(await getEnabledLevels()), 200),
});

const myCouponsRoute = defineContractRoute(memberSelfContract.coupons, {
  middleware: member,
  handler: async (c) => c.json(okBody(await listMyCoupons(c.req.valid('query'))), 200),
});

const availableCouponsRoute = defineContractRoute(memberSelfContract.availableCoupons, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getAvailableCoupons()), 200),
});

const receiveCouponRoute = defineContractRoute(memberSelfContract.receiveCoupon, {
  middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 5 })],
  handler: async (c) => c.json(okBody(await receiveCoupon(c.req.valid('json').couponId), '领取成功'), 200),
});

const exchangeableCouponsRoute = defineContractRoute(memberSelfContract.exchangeableCoupons, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getExchangeableCoupons()), 200),
});

const exchangeCouponRoute = defineContractRoute(memberSelfContract.exchangeCoupon, {
  middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 5 })],
  handler: async (c) => c.json(okBody(await exchangePointsForCoupon(c.req.valid('json').couponId), '兑换成功'), 200),
});

const checkinStatusRoute = defineContractRoute(memberSelfContract.checkinStatus, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getMemberCheckinStatus()), 200),
});

const checkinRoute = defineContractRoute(memberSelfContract.checkin, {
  middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 5 })],
  handler: async (c) => c.json(okBody(await doCheckin(), '签到成功'), 200),
});

const checkinHistoryRoute = defineContractRoute(memberSelfContract.checkinHistory, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getMyCheckinHistory(c.req.valid('query'))), 200),
});

const checkinMakeupRoute = defineContractRoute(memberSelfContract.makeupCheckin, {
  middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 5 })],
  handler: async (c) => c.json(okBody(await doMyMakeupCheckin(c.req.valid('json').date), '补签成功'), 200),
});

const checkinMilestonesRoute = defineContractRoute(memberSelfContract.checkinMilestones, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getMyMilestones()), 200),
});

const loginLogsRoute = defineContractRoute(memberSelfContract.loginLogs, {
  middleware: member,
  handler: async (c) => c.json(okBody(await listMyLoginLogs(c.req.valid('query'))), 200),
});

const benefitsRoute = defineContractRoute(memberSelfContract.benefits, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getMyBenefits()), 200),
});

const notificationsRoute = defineContractRoute(memberSelfContract.notifications, {
  middleware: member,
  handler: async (c) => c.json(okBody(await listMyNotifications(c.req.valid('query'))), 200),
});

const unreadCountRoute = defineContractRoute(memberSelfContract.unreadCount, {
  middleware: member,
  handler: async (c) => c.json(okBody({ count: await getMyUnreadCount() }), 200),
});

const markReadRoute = defineContractRoute(memberSelfContract.markRead, {
  middleware: member,
  handler: async (c) => {
    await markMyNotificationRead(c.req.valid('param').id);
    return c.json(okBody(null, '已读'), 200);
  },
});

const markAllReadRoute = defineContractRoute(memberSelfContract.markAllRead, {
  middleware: member,
  handler: async (c) => {
    const n = await markAllMyNotificationsRead();
    return c.json(okBody(null, `已读 ${n} 条`), 200);
  },
});

const inviteSummaryRoute = defineContractRoute(memberSelfContract.inviteSummary, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getMyInviteSummary()), 200),
});

// 静态段（/coupons/available、/notifications/read-all 等）先于同级动态段注册
memberSelf.openapiRoutes([
  pointAccountRoute,
  pointTxRoute,
  walletRoute,
  paymentOptionsRoute,
  walletTxRoute,
  rechargeRoute,
  levelsRoute,
  benefitsRoute,
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
  notificationsRoute,
  unreadCountRoute,
  markAllReadRoute,
  markReadRoute,
  inviteSummaryRoute,
] as const);

export default memberSelf;
