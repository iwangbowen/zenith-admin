import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsStaticContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { submitCmsPublishTask } from '../../services/cms/cms-publishing.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const buildRoute = defineContractRoute(cmsStaticContract.build, {
  middleware: [authMiddleware, guard({ permission: 'cms:publish:build', audit: { description: 'CMS 全站静态化', module: 'CMS内容管理' } }), idempotencyGuard({ ttlSeconds: 30 })],
  handler: async (c) => {
    const { siteId } = c.req.valid('json');
    const task = await submitCmsPublishTask({
      siteId,
      targetType: 'site',
      reason: '站点管理手动全站静态化',
    });
    return c.json(okBody(task, '任务已提交，可在发布中心或任务中心查看进度'), 200);
  },
});

router.openapiRoutes([buildRoute] as const);

export default router;
