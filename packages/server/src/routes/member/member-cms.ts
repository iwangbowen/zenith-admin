/**
 * 前台会员投稿 API（/api/member/cms/*）：memberAuthMiddleware 鉴权，
 * 全部按 currentMemberId 过滤防越权；提交走 CMS 统一审核管道。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { submitCmsSurveySchema, memberSubmitCmsCommentSchema } from '@zenith/shared';
import { memberAuthMiddleware } from '../../middleware/member-auth';
import { idempotencyGuard } from '../../middleware/idempotency';
import {
  jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, okBody, PaginationQuery, IdParam,
} from '../../lib/openapi-schemas';
import { CmsContributionDTO, CmsContribChannelsDTO, CmsInteractionStateDTO, CmsMemberContentItemDTO, CmsMemberCommentDTO } from '../../lib/openapi-dtos';
import {
  listContributableChannels, listMyContributions, getMyContribution,
  createContribution, updateMyContribution, deleteMyContribution,
} from '../../services/cms/cms-contribution.service';
import {
  likeContent, unlikeContent, favoriteContent, unfavoriteContent, getInteractionState,
  recordMemberView, listMyFavorites, listMyViewHistory, clearMyViewHistory,
  submitMemberComment, listMyComments, deleteMyComment,
} from '../../services/cms/cms-member-interaction.service';
import { getPublishedSurveyById, submitCmsSurvey } from '../../services/cms/cms-surveys.service';
import { triggerContentStaticRefresh } from '../../services/cms/cms-static.service';
import { currentMemberId } from '../../lib/member-context';

const router = new OpenAPIHono({ defaultHook: validationHook });

const contributionBody = z.object({
  siteId: z.number().int().positive(),
  channelId: z.number().int().positive(),
  title: z.string().min(1, '请输入标题').max(255),
  summary: z.string().max(500).optional(),
  body: z.string().min(1, '请输入正文').max(50000),
});

const channelsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/channels', tags: ['MemberCms'], summary: '可投稿站点与栏目',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(CmsContribChannelsDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listContributableChannels()), 200),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/contributions', tags: ['MemberCms'], summary: '我的投稿列表',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: {
      query: PaginationQuery.extend({
        status: z.enum(['draft', 'pending', 'published', 'offline', 'rejected']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsContributionDTO, '投稿列表') },
  }),
  handler: async (c) => c.json(okBody(await listMyContributions(c.req.valid('query'))), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/contributions/{id}', tags: ['MemberCms'], summary: '投稿详情',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsContributionDTO, '投稿详情') },
  }),
  handler: async (c) => c.json(okBody(await getMyContribution(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/contributions', tags: ['MemberCms'], summary: '提交投稿（进入审核）',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 10 })] as const,
    request: { body: { content: jsonContent(contributionBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsContributionDTO, '投稿已提交') },
  }),
  handler: async (c) => c.json(okBody(await createContribution(c.req.valid('json')), '投稿已提交，等待审核'), 200),
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/contributions/{id}', tags: ['MemberCms'], summary: '修改投稿并重新提交',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(contributionBody.omit({ siteId: true })), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(CmsContributionDTO, '已重新提交') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateMyContribution(id, c.req.valid('json')), '已重新提交，等待审核'), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/contributions/{id}', tags: ['MemberCms'], summary: '删除投稿（草稿/被驳回）',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    await deleteMyContribution(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── P3 会员互动：点赞 / 收藏 / 浏览历史 ─────────────────────────────────────────
const interactionStateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/contents/{id}/interaction-state', tags: ['MemberCms'], summary: '我对内容的互动状态（点赞/收藏 + 计数）',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsInteractionStateDTO, '互动状态') },
  }),
  handler: async (c) => c.json(okBody(await getInteractionState(c.req.valid('param').id)), 200),
});

const likeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/contents/{id}/like', tags: ['MemberCms'], summary: '点赞内容',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsInteractionStateDTO, '已点赞') },
  }),
  handler: async (c) => c.json(okBody(await likeContent(c.req.valid('param').id), '已点赞'), 200),
});

const unlikeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/contents/{id}/like', tags: ['MemberCms'], summary: '取消点赞',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsInteractionStateDTO, '已取消点赞') },
  }),
  handler: async (c) => c.json(okBody(await unlikeContent(c.req.valid('param').id), '已取消点赞'), 200),
});

const favoriteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/contents/{id}/favorite', tags: ['MemberCms'], summary: '收藏内容',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsInteractionStateDTO, '已收藏') },
  }),
  handler: async (c) => c.json(okBody(await favoriteContent(c.req.valid('param').id), '已收藏'), 200),
});

const unfavoriteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/contents/{id}/favorite', tags: ['MemberCms'], summary: '取消收藏',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsInteractionStateDTO, '已取消收藏') },
  }),
  handler: async (c) => c.json(okBody(await unfavoriteContent(c.req.valid('param').id), '已取消收藏'), 200),
});

const viewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/contents/{id}/view', tags: ['MemberCms'], summary: '记录浏览历史（去重累计，保留最近 100 条）',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已记录') },
  }),
  handler: async (c) => {
    await recordMemberView(c.req.valid('param').id);
    return c.json(okBody(null, '已记录'), 200);
  },
});

const favoritesListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/favorites', tags: ['MemberCms'], summary: '我的收藏列表',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(CmsMemberContentItemDTO, '收藏列表') },
  }),
  handler: async (c) => {
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listMyFavorites(page, pageSize)), 200);
  },
});

const historyListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/view-history', tags: ['MemberCms'], summary: '我的浏览历史（最近浏览优先）',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(CmsMemberContentItemDTO, '浏览历史') },
  }),
  handler: async (c) => {
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listMyViewHistory(page, pageSize)), 200);
  },
});

const clearHistoryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/view-history', tags: ['MemberCms'], summary: '清空我的浏览历史',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    responses: { ...commonErrorResponses, ...okMsg('已清空') },
  }),
  handler: async (c) => {
    const count = await clearMyViewHistory();
    return c.json(okBody(null, `已清空 ${count} 条浏览记录`), 200);
  },
});

// ─── P3 问卷：会员提交（JSON；一人一份由 DB 唯一约束保证）────────────────────────
const surveySubmitRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/surveys/{id}/submit', tags: ['MemberCms'], summary: '提交问卷答卷（会员，一人一份）',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { params: IdParam, body: { content: jsonContent(submitCmsSurveySchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('提交成功') },
  }),
  handler: async (c) => {
    const survey = await getPublishedSurveyById(c.req.valid('param').id);
    if (!survey) throw new HTTPException(404, { message: '问卷不存在或未开放' });
    const forwarded = c.req.header('x-forwarded-for');
    const ip = forwarded?.split(',')[0].trim() || c.req.header('x-real-ip') || null;
    await submitCmsSurvey(survey, c.req.valid('json'), { memberId: currentMemberId(), ip });
    return c.json(okBody(null, '提交成功，感谢您的参与！'), 200);
  },
});

// ─── P1 评论会员化：会员提交评论 / 我的评论 ──────────────────────────────────────
const commentSubmitRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/contents/{id}/comments', tags: ['MemberCms'], summary: '会员提交评论（进入审核，昵称自动取会员资料）',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 5 })] as const,
    request: { params: IdParam, body: { content: jsonContent(memberSubmitCmsCommentSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('评论已提交') },
  }),
  handler: async (c) => {
    const forwarded = c.req.header('x-forwarded-for');
    const ip = forwarded?.split(',')[0].trim() || c.req.header('x-real-ip') || 'unknown';
    await submitMemberComment(c.req.valid('param').id, c.req.valid('json'), {
      ip, userAgent: c.req.header('user-agent')?.slice(0, 255) ?? null,
    });
    return c.json(okBody(null, '评论已提交，审核通过后显示'), 200);
  },
});

const myCommentsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/comments', tags: ['MemberCms'], summary: '我的评论列表',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(CmsMemberCommentDTO, '我的评论') },
  }),
  handler: async (c) => {
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listMyComments(page, pageSize)), 200);
  },
});

const deleteMyCommentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/comments/{id}', tags: ['MemberCms'], summary: '删除我的评论',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const contentId = await deleteMyComment(c.req.valid('param').id);
    if (contentId) triggerContentStaticRefresh(contentId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  channelsRoute, listRoute, detailRoute, createRouteDef, updateRouteDef, deleteRouteDef,
  interactionStateRoute, likeRoute, unlikeRoute, favoriteRoute, unfavoriteRoute, viewRoute,
  favoritesListRoute, historyListRoute, clearHistoryRoute, surveySubmitRoute,
  commentSubmitRoute, myCommentsRoute, deleteMyCommentRoute,
] as const);

export default router;
