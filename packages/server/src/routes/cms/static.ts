import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { commonErrorResponses, jsonContent, ok, okBody, validationHook } from '../../lib/openapi-schemas';
import { AsyncTaskDTO } from '../../lib/openapi-dtos';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { ensureCmsStaticBuildAccess } from '../../services/cms/cms-static.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const buildRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/build',
    tags: ['CMS-静态化'], summary: '提交全站静态化任务（任务中心执行）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:static:build', audit: { description: 'CMS 全站静态化', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(z.object({ siteId: z.number().int().positive() })), required: true } },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '任务已提交') },
  }),
  handler: async (c) => {
    const { siteId } = c.req.valid('json');
    const site = await ensureCmsStaticBuildAccess(siteId);
    const row = await submitAsyncTask({
      taskType: 'cms-static-build',
      title: `CMS 全站静态化（${site.name}）`,
      payload: { siteId },
    });
    return c.json(okBody(mapAsyncTask(row), '任务已提交，可在任务中心查看进度'), 200);
  },
});

router.openapiRoutes([buildRoute] as const);

export default router;
