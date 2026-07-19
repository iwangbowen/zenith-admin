/**
 * 前台会员投稿 API（/api/member/cms/*）：memberAuthMiddleware 鉴权，
 * 全部按 currentMemberId 过滤防越权；提交走 CMS 统一审核管道。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { memberAuthMiddleware } from '../../middleware/member-auth';
import { idempotencyGuard } from '../../middleware/idempotency';
import {
  jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, okBody, PaginationQuery, IdParam,
} from '../../lib/openapi-schemas';
import { CmsContributionDTO, CmsContribChannelsDTO } from '../../lib/openapi-dtos';
import {
  listContributableChannels, listMyContributions, getMyContribution,
  createContribution, updateMyContribution, deleteMyContribution,
} from '../../services/cms/cms-contribution.service';

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

router.openapiRoutes([channelsRoute, listRoute, detailRoute, createRouteDef, updateRouteDef, deleteRouteDef] as const);

export default router;
