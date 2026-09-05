import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsCommentContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsComments, auditCmsComments, deleteCmsComments, countPendingComments,
} from '../../services/cms/cms-comments.service';
import { triggerContentStaticRefresh } from '../../services/cms/cms-static.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:comment:list' })] as const;

const listRoute = defineContractRoute(cmsCommentContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsComments(c.req.valid('query'))), 200),
});

const pendingCountRoute = defineContractRoute(cmsCommentContract.pendingCount, {
  middleware: read,
  handler: async (c) => c.json(okBody({ count: await countPendingComments(c.req.valid('query').siteId) }), 200),
});

const approveRoute = defineContractRoute(cmsCommentContract.approve, {
  middleware: [authMiddleware, guard({ permission: 'cms:comment:audit', audit: { description: 'CMS 评论审核通过', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const contentIds = await auditCmsComments(ids, 'approved');
    for (const contentId of contentIds) triggerContentStaticRefresh(contentId);
    return c.json(okBody(null, `已通过 ${ids.length} 条评论`), 200);
  },
});

const rejectRoute = defineContractRoute(cmsCommentContract.reject, {
  middleware: [authMiddleware, guard({ permission: 'cms:comment:audit', audit: { description: 'CMS 评论拒绝', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const contentIds = await auditCmsComments(ids, 'rejected');
    for (const contentId of contentIds) triggerContentStaticRefresh(contentId);
    return c.json(okBody(null, `已拒绝 ${ids.length} 条评论`), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsCommentContract.batchDelete, {
  middleware: [authMiddleware, guard({ permission: 'cms:comment:delete', audit: { description: 'CMS 评论删除', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const contentIds = await deleteCmsComments(ids);
    for (const contentId of contentIds) triggerContentStaticRefresh(contentId);
    return c.json(okBody(null, `已删除 ${ids.length} 条评论`), 200);
  },
});

router.openapiRoutes([listRoute, pendingCountRoute, approveRoute, rejectRoute, deleteRouteDef] as const);

export default router;
