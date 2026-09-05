import { OpenAPIHono } from '@hono/zod-openapi';
import { reportDashboardOpsContract } from '@zenith/shared/report';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
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
import { dashboardConflictResponse } from './report-dashboards';

const router = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

// ── 版本 ──
const listVersionsRoute = defineContractRoute(reportDashboardOpsContract.versions, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  handler: async (c) => c.json(okBody(await listVersions(c.req.valid('param').id)), 200),
});

const createVersionRoute = defineContractRoute(reportDashboardOpsContract.createVersion, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '保存仪表盘版本', module: '报表仪表盘' } })],
  handler: async (c) => c.json(okBody(await createVersion(c.req.valid('param').id, c.req.valid('json')), '已保存版本'), 200),
});

const diffVersionRoute = defineContractRoute(reportDashboardOpsContract.versionDiff, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const query = c.req.valid('query');
    return c.json(okBody(await diffVersion(id, query.left, query.right)), 200);
  },
});

const restoreVersionRoute = defineContractRoute(reportDashboardOpsContract.restoreVersion, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '恢复仪表盘版本', module: '报表仪表盘' } })],
  responses: { ...notFound, ...dashboardConflictResponse },
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
const favoriteRoute = defineContractRoute(reportDashboardOpsContract.favorite, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  handler: async (c) => c.json(okBody(await toggleFavorite(c.req.valid('param').id)), 200),
});

// ── 分享 ──
const listSharesRoute = defineContractRoute(reportDashboardOpsContract.shares, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update' })],
  handler: async (c) => c.json(okBody(await listShares(c.req.valid('param').id)), 200),
});

const createShareRoute = defineContractRoute(reportDashboardOpsContract.createShare, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '创建报表分享链接', module: '报表仪表盘', recordResponseBody: false } })],
  handler: async (c) => c.json(okBody(await createShare(c.req.valid('param').id, c.req.valid('json')), '创建成功'), 200),
});

const updateShareRoute = defineContractRoute(reportDashboardOpsContract.updateShare, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '更新报表分享链接', module: '报表仪表盘', recordResponseBody: false } })],
  responses: notFound,
  handler: async (c) => c.json(okBody(await updateShare(c.req.valid('param').shareId, c.req.valid('json')), '更新成功'), 200),
});

const deleteShareRoute = defineContractRoute(reportDashboardOpsContract.removeShare, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '删除报表分享链接', module: '报表仪表盘' } })],
  responses: notFound,
  handler: async (c) => {
    await deleteShare(c.req.valid('param').shareId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ── Scoped Embed Token ──
const listEmbedTokensRoute = defineContractRoute(reportDashboardOpsContract.embedTokens, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update' })],
  handler: async (c) => c.json(okBody(await listEmbedTokens(c.req.valid('param').id)), 200),
});

const createEmbedTokenRoute = defineContractRoute(reportDashboardOpsContract.createEmbedToken, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '创建仪表盘嵌入令牌', module: '报表仪表盘', recordResponseBody: false } })],
  handler: async (c) => c.json(okBody(await createEmbedToken(c.req.valid('param').id, c.req.valid('json')), '创建成功'), 200),
});

const revokeEmbedTokenRoute = defineContractRoute(reportDashboardOpsContract.revokeEmbedToken, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '撤销仪表盘嵌入令牌', module: '报表仪表盘' } })],
  handler: async (c) => {
    await revokeEmbedToken(c.req.valid('param').embedTokenId);
    return c.json(okBody(null, '撤销成功'), 200);
  },
});

// ── 评论 ──
const listCommentsRoute = defineContractRoute(reportDashboardOpsContract.comments, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  handler: async (c) => c.json(okBody(await listComments(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const createCommentRoute = defineContractRoute(reportDashboardOpsContract.createComment, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  handler: async (c) => c.json(okBody(await createComment(c.req.valid('param').id, c.req.valid('json')), '已发表'), 200),
});

const updateCommentRoute = defineContractRoute(reportDashboardOpsContract.updateComment, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  handler: async (c) => {
    const { id, commentId } = c.req.valid('param');
    return c.json(okBody(await updateComment(id, commentId, c.req.valid('json')), '更新成功'), 200);
  },
});

const resolveCommentRoute = defineContractRoute(reportDashboardOpsContract.resolveComment, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  handler: async (c) => {
    const { id, commentId } = c.req.valid('param');
    return c.json(okBody(await resolveComment(id, commentId, c.req.valid('json')), '操作成功'), 200);
  },
});

const deleteCommentRoute = defineContractRoute(reportDashboardOpsContract.removeComment, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  responses: notFound,
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
