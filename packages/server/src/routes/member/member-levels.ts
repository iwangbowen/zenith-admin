import { OpenAPIHono } from '@hono/zod-openapi';
import { memberLevelContract } from '@zenith/shared/member';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listLevels, getLevel, createLevel, updateLevel, deleteLevel, ensureLevelExists,
} from '../../services/member/member-levels.service';

const levelsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'member:level:list' })] as const;

const listRoute = defineContractRoute(memberLevelContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listLevels()), 200),
});

const detailRoute = defineContractRoute(memberLevelContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getLevel(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(memberLevelContract.create, {
  middleware: [authMiddleware, guard({ permission: 'member:level:create', audit: { description: '创建会员等级', module: '会员等级' } })],
  handler: async (c) => c.json(okBody(await createLevel(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(memberLevelContract.update, {
  middleware: [authMiddleware, guard({ permission: 'member:level:update', audit: { description: '更新会员等级', module: '会员等级' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureLevelExists(id));
    return c.json(okBody(await updateLevel(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(memberLevelContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'member:level:delete', audit: { description: '删除会员等级', module: '会员等级' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureLevelExists(id));
    await deleteLevel(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

levelsRouter.openapiRoutes([listRoute, detailRoute, createRouteDef, updateRouteDef, deleteRouteDef] as const);

export default levelsRouter;
