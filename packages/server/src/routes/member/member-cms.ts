/**
 * 前台会员投稿 API（/api/member/cms/*）：memberAuthMiddleware 鉴权，
 * 全部按 currentMemberId 过滤防越权；提交走 CMS 统一审核管道。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { memberCmsContract } from '@zenith/shared/cms';
import { memberAuthMiddleware } from '../../middleware/member-auth';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listContributableChannels, listMyContributions, getMyContribution,
  createContribution, updateMyContribution, deleteMyContribution,
} from '../../services/cms/cms-contribution.service';
import {
  likeContent, unlikeContent, favoriteContent, unfavoriteContent, getInteractionState,
  recordMemberView, listMyFavorites, listMyViewHistory, clearMyViewHistory,
  submitMemberComment, listMyComments, deleteMyComment,
} from '../../services/cms/cms-member-interaction.service';
import {
  getPublicCmsInteractionById,
  submitCmsInteraction,
} from '../../services/cms/cms-interactions.service';
import { triggerContentStaticRefresh } from '../../services/cms/cms-static.service';
import { currentMemberId } from '../../lib/member-context';
import { getClientIp } from '../../lib/request-helpers';
import {
  cancelMyCmsSubscription,
  getMyCmsSubscriptionStatus,
  listMyCmsSubscriptions,
  subscribeCmsSubject,
  updateMyCmsSubscription,
} from '../../services/cms/cms-subscriptions.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const member = [memberAuthMiddleware] as const;

const channelsRoute = defineContractRoute(memberCmsContract.channels, {
  middleware: member,
  handler: async (c) => c.json(okBody(await listContributableChannels()), 200),
});

const listRoute = defineContractRoute(memberCmsContract.contributions, {
  middleware: member,
  handler: async (c) => c.json(okBody(await listMyContributions(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(memberCmsContract.contribution, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getMyContribution(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(memberCmsContract.createContribution, {
  middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => c.json(okBody(await createContribution(c.req.valid('json')), '投稿已提交，等待审核'), 200),
});

const updateRouteDef = defineContractRoute(memberCmsContract.updateContribution, {
  middleware: member,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateMyContribution(id, c.req.valid('json')), '已重新提交，等待审核'), 200);
  },
});

const deleteRouteDef = defineContractRoute(memberCmsContract.removeContribution, {
  middleware: member,
  handler: async (c) => {
    await deleteMyContribution(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 会员互动：点赞 / 收藏 / 浏览历史 ─────────────────────────────────────────
const interactionStateRoute = defineContractRoute(memberCmsContract.interactionState, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getInteractionState(c.req.valid('param').id)), 200),
});

const likeRoute = defineContractRoute(memberCmsContract.like, {
  middleware: member,
  handler: async (c) => c.json(okBody(await likeContent(c.req.valid('param').id), '已点赞'), 200),
});

const unlikeRoute = defineContractRoute(memberCmsContract.unlike, {
  middleware: member,
  handler: async (c) => c.json(okBody(await unlikeContent(c.req.valid('param').id), '已取消点赞'), 200),
});

const favoriteRoute = defineContractRoute(memberCmsContract.favorite, {
  middleware: member,
  handler: async (c) => c.json(okBody(await favoriteContent(c.req.valid('param').id), '已收藏'), 200),
});

const unfavoriteRoute = defineContractRoute(memberCmsContract.unfavorite, {
  middleware: member,
  handler: async (c) => c.json(okBody(await unfavoriteContent(c.req.valid('param').id), '已取消收藏'), 200),
});

const viewRoute = defineContractRoute(memberCmsContract.recordView, {
  middleware: member,
  handler: async (c) => {
    await recordMemberView(c.req.valid('param').id);
    return c.json(okBody(null, '已记录'), 200);
  },
});

const favoritesListRoute = defineContractRoute(memberCmsContract.favorites, {
  middleware: member,
  handler: async (c) => {
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listMyFavorites(page, pageSize)), 200);
  },
});

const historyListRoute = defineContractRoute(memberCmsContract.viewHistory, {
  middleware: member,
  handler: async (c) => {
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listMyViewHistory(page, pageSize)), 200);
  },
});

const clearHistoryRoute = defineContractRoute(memberCmsContract.clearViewHistory, {
  middleware: member,
  handler: async (c) => {
    const count = await clearMyViewHistory();
    return c.json(okBody(null, `已清空 ${count} 条浏览记录`), 200);
  },
});

// ─── 会员订阅：全部按 currentMemberId() 归属校验 ─────────────────────────────
const subscriptionsRoute = defineContractRoute(memberCmsContract.subscriptions, {
  middleware: member,
  handler: async (c) => c.json(okBody(await listMyCmsSubscriptions(c.req.valid('query'))), 200),
});

const subscriptionStatusRoute = defineContractRoute(memberCmsContract.subscriptionStatus, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getMyCmsSubscriptionStatus(c.req.valid('query'))), 200),
});

const subscribeRoute = defineContractRoute(memberCmsContract.subscribe, {
  middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => c.json(okBody(await subscribeCmsSubject(c.req.valid('json')), '订阅成功'), 200),
});

const updateSubscriptionRoute = defineContractRoute(memberCmsContract.updateSubscription, {
  middleware: member,
  handler: async (c) => c.json(okBody(await updateMyCmsSubscription(
    c.req.valid('param').id,
    c.req.valid('json').notificationEnabled,
  ), '订阅已更新'), 200),
});

const cancelSubscriptionRoute = defineContractRoute(memberCmsContract.cancelSubscription, {
  middleware: member,
  handler: async (c) => c.json(okBody(
    await cancelMyCmsSubscription(c.req.valid('param').id),
    '已取消订阅',
  ), 200),
});

// ─── 评论会员化：会员提交评论 / 我的评论 ──────────────────────────────────────
const commentSubmitRoute = defineContractRoute(memberCmsContract.submitComment, {
  middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 5 })],
  handler: async (c) => {
    const ip = getClientIp(c);
    await submitMemberComment(c.req.valid('param').id, c.req.valid('json'), {
      ip, userAgent: c.req.header('user-agent')?.slice(0, 255) ?? null,
    });
    return c.json(okBody(null, '评论已提交，审核通过后显示'), 200);
  },
});

const myCommentsRoute = defineContractRoute(memberCmsContract.comments, {
  middleware: member,
  handler: async (c) => {
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listMyComments(page, pageSize)), 200);
  },
});

const deleteMyCommentRoute = defineContractRoute(memberCmsContract.removeComment, {
  middleware: member,
  handler: async (c) => {
    const contentId = await deleteMyComment(c.req.valid('param').id);
    if (contentId) triggerContentStaticRefresh(contentId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 统一互动问卷：会员提交 ──────────────────────────────────────────────────
const interactionSubmitRoute = defineContractRoute(memberCmsContract.submitInteraction, {
  middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const interaction = await getPublicCmsInteractionById(c.req.valid('param').id, c.req.valid('query').siteId);
    if (!interaction) throw new HTTPException(404, { message: '互动问卷不存在' });
    const result = await submitCmsInteraction(interaction, c.req.valid('json'), {
      memberId: currentMemberId(),
      ip: getClientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
      idempotencyKey: c.req.header('x-idempotency-key') ?? null,
    });
    return c.json(okBody(result, result.message), 200);
  },
});

router.openapiRoutes([
  channelsRoute, listRoute, detailRoute, createRouteDef, updateRouteDef, deleteRouteDef,
  interactionStateRoute, likeRoute, unlikeRoute, favoriteRoute, unfavoriteRoute, viewRoute,
  favoritesListRoute, historyListRoute, clearHistoryRoute,
  subscriptionsRoute, subscriptionStatusRoute, subscribeRoute, updateSubscriptionRoute, cancelSubscriptionRoute,
  commentSubmitRoute, myCommentsRoute, deleteMyCommentRoute, interactionSubmitRoute,
] as const);

export default router;
