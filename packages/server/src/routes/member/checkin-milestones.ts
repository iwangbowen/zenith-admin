import { OpenAPIHono } from '@hono/zod-openapi';
import { checkinMilestoneContract } from '@zenith/shared/member';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCheckinMilestones,
  createCheckinMilestone,
  updateCheckinMilestone,
  deleteCheckinMilestone,
  ensureMilestoneExists,
} from '../../services/member/checkin-milestones.service';

const checkinMilestonesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(checkinMilestoneContract.list, {
  middleware: [authMiddleware, guard({ permission: 'member:checkin:milestone:list' })],
  handler: async (c) => c.json(okBody(await listCheckinMilestones()), 200),
});

const createMilestoneRoute = defineContractRoute(checkinMilestoneContract.create, {
  middleware: [authMiddleware, guard({ permission: 'member:checkin:milestone:create', audit: { module: '会员签到', description: '创建签到里程碑' } })],
  handler: async (c) => c.json(okBody(await createCheckinMilestone(c.req.valid('json')), '创建成功'), 200),
});

const updateMilestoneRoute = defineContractRoute(checkinMilestoneContract.update, {
  middleware: [authMiddleware, guard({ permission: 'member:checkin:milestone:update', audit: { module: '会员签到', description: '更新签到里程碑' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureMilestoneExists(id));
    return c.json(okBody(await updateCheckinMilestone(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteMilestoneRoute = defineContractRoute(checkinMilestoneContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'member:checkin:milestone:delete', audit: { module: '会员签到', description: '删除签到里程碑' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureMilestoneExists(id));
    await deleteCheckinMilestone(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

checkinMilestonesRouter.openapiRoutes([listRoute, createMilestoneRoute, updateMilestoneRoute, deleteMilestoneRoute] as const);

export default checkinMilestonesRouter;
