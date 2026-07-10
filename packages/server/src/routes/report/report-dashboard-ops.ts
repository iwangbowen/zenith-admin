import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import {
  createReportCommentSchema,
  createReportEmbedTokenSchema,
  createReportShareSchema,
  createReportVersionSchema,
  reportCommentListQuerySchema,
  reportVersionDiffQuerySchema,
  resolveReportCommentSchema,
  restoreReportVersionSchema,
  updateReportCommentSchema,
  updateReportShareSchema,
} from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  ErrorResponse,
  commonErrorResponses,
  errBody,
  IdParam,
  jsonContent,
  ok,
  okBody,
  okMsg,
  okPaginated,
  validationHook,
} from '../../lib/openapi-schemas';
import {
  ReportDashboardCommentDTO,
  ReportDashboardDTO,
  ReportDashboardEmbedTokenDTO,
  ReportDashboardVersionDTO,
  ReportDashboardVersionDiffDTO,
  ReportDashboardShareDTO,
} from '../../lib/openapi-dtos';
import {
  createVersion,
  createShare,
  createEmbedToken,
  deleteShare,
  diffVersion,
  listEmbedTokens,
  listShares,
  listVersions,
  revokeEmbedToken,
  restoreVersion,
  toggleFavorite,
  updateShare,
} from '../../services/report/report-ops.service';
import {
  createComment,
  deleteComment,
  listComments,
  resolveComment,
  updateComment,
} from '../../services/report/report-comment.service';
import { DashboardRevisionConflictError } from '../../services/report/report-dashboard.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const ConflictResponse = z.object({
  code: z.literal(409),
  message: z.string(),
  data: z.object({
    currentRevision: z.number().int().positive(),
    dashboard: ReportDashboardDTO,
  }),
});

const RestoreParam = z.object({
  id: z.coerce.number().int().positive().openapi({ param: { name: 'id', in: 'path' }, example: 1 }),
  versionId: z.coerce.number().int().positive().openapi({ param: { name: 'versionId', in: 'path' }, example: 1 }),
});

const ShareIdParam = z.object({
  shareId: z.coerce.number().int().positive().openapi({ param: { name: 'shareId', in: 'path' }, example: 1 }),
});

const CommentIdParam = z.object({
  id: z.coerce.number().int().positive().openapi({ param: { name: 'id', in: 'path' }, example: 1 }),
  commentId: z.coerce.number().int().positive().openapi({ param: { name: 'commentId', in: 'path' }, example: 1 }),
});

const EmbedTokenIdParam = z.object({
  embedTokenId: z.coerce.number().int().positive().openapi({ param: { name: 'embedTokenId', in: 'path' }, example: 1 }),
});

// ── 版本 ──
const listVersionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/versions',
    tags: ['报表仪表盘'],
    summary: '版本列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(ReportDashboardVersionDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listVersions(c.req.valid('param').id)), 200),
});

const createVersionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/versions',
    tags: ['报表仪表盘'],
    summary: '保存版本快照',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '保存仪表盘版本', module: '报表仪表盘' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(createReportVersionSchema), required: false } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardVersionDTO, '已保存') },
  }),
  handler: async (c) => c.json(okBody(await createVersion(c.req.valid('param').id, c.req.valid('json')), '已保存版本'), 200),
});

const diffVersionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/versions/diff',
    tags: ['报表仪表盘'],
    summary: '版本差异比较',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { params: IdParam, query: reportVersionDiffQuerySchema },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardVersionDiffDTO, 'ok') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const query = c.req.valid('query');
    return c.json(okBody(await diffVersion(id, query.left, query.right)), 200);
  },
});

const restoreVersionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/versions/{versionId}/restore',
    tags: ['报表仪表盘'],
    summary: '恢复版本',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '恢复仪表盘版本', module: '报表仪表盘' } })] as const,
    request: { params: RestoreParam, body: { content: jsonContent(restoreReportVersionSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('已恢复'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
      409: { content: jsonContent(ConflictResponse), description: '版本冲突' },
    },
  }),
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    try {
      await restoreVersion(id, versionId, c.req.valid('json').expectedRevision);
      return c.json(okBody(null, '已恢复到该版本'), 200);
    } catch (err) {
      if (err instanceof DashboardRevisionConflictError) {
        return c.json({
          ...errBody(err.message, 409),
          data: { currentRevision: err.currentRevision, dashboard: err.currentDashboard },
        }, 409);
      }
      throw err;
    }
  },
});

// ── 收藏 ──
const favoriteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/favorite',
    tags: ['报表仪表盘'],
    summary: '收藏/取消收藏',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.object({ favorited: z.boolean() }), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await toggleFavorite(c.req.valid('param').id)), 200),
});

// ── 分享 ──
const listSharesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/shares',
    tags: ['报表仪表盘'],
    summary: '分享链接列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(ReportDashboardShareDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listShares(c.req.valid('param').id)), 200),
});

const createShareRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/shares',
    tags: ['报表仪表盘'],
    summary: '创建分享链接',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '创建报表分享链接', module: '报表仪表盘', recordResponseBody: false } })] as const,
    request: { params: IdParam, body: { content: jsonContent(createReportShareSchema), required: false } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardShareDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createShare(c.req.valid('param').id, c.req.valid('json') ?? { enabled: true }), '创建成功'), 200),
});

const updateShareRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/shares/{shareId}',
    tags: ['报表仪表盘'],
    summary: '更新分享链接',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '更新报表分享链接', module: '报表仪表盘', recordResponseBody: false } })] as const,
    request: { params: ShareIdParam, body: { content: jsonContent(updateReportShareSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardShareDTO, '更新成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await updateShare(c.req.valid('param').shareId, c.req.valid('json')), '更新成功'), 200),
});

const deleteShareRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/shares/{shareId}',
    tags: ['报表仪表盘'],
    summary: '删除分享链接',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '删除报表分享链接', module: '报表仪表盘' } })] as const,
    request: { params: ShareIdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    await deleteShare(c.req.valid('param').shareId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ── Scoped Embed Token ──
const listEmbedTokensRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/embed-tokens',
    tags: ['报表仪表盘'],
    summary: '嵌入令牌列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(ReportDashboardEmbedTokenDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listEmbedTokens(c.req.valid('param').id)), 200),
});

const createEmbedTokenRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/embed-tokens',
    tags: ['报表仪表盘'],
    summary: '创建嵌入令牌',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '创建仪表盘嵌入令牌', module: '报表仪表盘', recordResponseBody: false } })] as const,
    request: { params: IdParam, body: { content: jsonContent(createReportEmbedTokenSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardEmbedTokenDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createEmbedToken(c.req.valid('param').id, c.req.valid('json')), '创建成功'), 200),
});

const revokeEmbedTokenRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/embed-tokens/{embedTokenId}/revoke',
    tags: ['报表仪表盘'],
    summary: '撤销嵌入令牌',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '撤销仪表盘嵌入令牌', module: '报表仪表盘' } })] as const,
    request: { params: EmbedTokenIdParam },
    responses: { ...commonErrorResponses, ...okMsg('撤销成功') },
  }),
  handler: async (c) => {
    await revokeEmbedToken(c.req.valid('param').embedTokenId);
    return c.json(okBody(null, '撤销成功'), 200);
  },
});

// ── 评论 ──
const listCommentsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/comments',
    tags: ['报表仪表盘'],
    summary: '评论列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { params: IdParam, query: reportCommentListQuerySchema },
    responses: { ...commonErrorResponses, ...okPaginated(ReportDashboardCommentDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listComments(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const createCommentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/comments',
    tags: ['报表仪表盘'],
    summary: '发表评论',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { params: IdParam, body: { content: jsonContent(createReportCommentSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardCommentDTO, '已发表') },
  }),
  handler: async (c) => c.json(okBody(await createComment(c.req.valid('param').id, c.req.valid('json')), '已发表'), 200),
});

const updateCommentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}/comments/{commentId}',
    tags: ['报表仪表盘'],
    summary: '编辑评论',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { params: CommentIdParam, body: { content: jsonContent(updateReportCommentSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardCommentDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id, commentId } = c.req.valid('param');
    return c.json(okBody(await updateComment(id, commentId, c.req.valid('json')), '更新成功'), 200);
  },
});

const resolveCommentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/comments/{commentId}/resolve',
    tags: ['报表仪表盘'],
    summary: '解决/重新打开评论',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { params: CommentIdParam, body: { content: jsonContent(resolveReportCommentSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardCommentDTO, '操作成功') },
  }),
  handler: async (c) => {
    const { id, commentId } = c.req.valid('param');
    return c.json(okBody(await resolveComment(id, commentId, c.req.valid('json')), '操作成功'), 200);
  },
});

const deleteCommentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}/comments/{commentId}',
    tags: ['报表仪表盘'],
    summary: '删除评论',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { params: CommentIdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id, commentId } = c.req.valid('param');
    await deleteComment(id, commentId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  listVersionsRoute,
  createVersionRoute,
  diffVersionRoute,
  restoreVersionRoute,
  favoriteRoute,
  listSharesRoute,
  createShareRoute,
  updateShareRoute,
  deleteShareRoute,
  listEmbedTokensRoute,
  createEmbedTokenRoute,
  revokeEmbedTokenRoute,
  listCommentsRoute,
  createCommentRoute,
  updateCommentRoute,
  resolveCommentRoute,
  deleteCommentRoute,
] as const);

export default router;
