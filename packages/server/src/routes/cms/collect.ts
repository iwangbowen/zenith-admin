import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsCollectContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCollectRules, createCollectRule, updateCollectRule, deleteCollectRule,
  ensureCollectRuleRunnable, listCollectItems,
} from '../../services/cms/cms-collect.service';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { currentUser } from '../../lib/context';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:collect:list' })] as const;

const listRoute = defineContractRoute(cmsCollectContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCollectRules(c.req.valid('query'))), 200),
});

const createRouteDef = defineContractRoute(cmsCollectContract.create, {
  middleware: [authMiddleware, guard({ permission: 'cms:collect:create', audit: { description: '创建 CMS 采集规则', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCollectRule(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(cmsCollectContract.update, {
  middleware: [authMiddleware, guard({ permission: 'cms:collect:update', audit: { description: '更新 CMS 采集规则', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateCollectRule(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsCollectContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'cms:collect:delete', audit: { description: '删除 CMS 采集规则', module: 'CMS内容管理' } })],
  handler: async (c) => {
    await deleteCollectRule(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const runRoute = defineContractRoute(cmsCollectContract.run, {
  middleware: [authMiddleware, guard({ permission: 'cms:collect:run', audit: { description: '执行 CMS 采集', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const rule = await ensureCollectRuleRunnable(id);
    const user = currentUser();
    const task = await submitAsyncTask({
      taskType: 'cms-collect-run',
      title: `CMS 采集：${rule.name}`,
      payload: { ruleId: rule.id, operatorId: user.userId },
    });
    return c.json(okBody(mapAsyncTask(task), '任务已提交，可在下方查看进度与明细'), 200);
  },
});

const itemsRoute = defineContractRoute(cmsCollectContract.items, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listCollectItems({ ...c.req.valid('query'), ruleId: id })), 200);
  },
});

router.openapiRoutes([listRoute, createRouteDef, updateRouteDef, deleteRouteDef, runRoute, itemsRoute] as const);

export default router;
