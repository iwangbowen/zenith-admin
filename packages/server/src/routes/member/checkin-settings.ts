import { OpenAPIHono } from '@hono/zod-openapi';
import { checkinSettingsContract } from '@zenith/shared/member';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getCheckinSettings, updateCheckinSettings, getCheckinSettingsBeforeAudit } from '../../services/member/checkin-settings.service';

const checkinSettingsRouter = new OpenAPIHono({ defaultHook: validationHook });

const getRoute = defineContractRoute(checkinSettingsContract.get, {
  middleware: [authMiddleware, guard({ permission: 'member:checkin:rule:list' })],
  handler: async (c) => c.json(okBody(await getCheckinSettings()), 200),
});

const updateRoute = defineContractRoute(checkinSettingsContract.update, {
  middleware: [authMiddleware, guard({ permission: 'member:checkin:setting:update', audit: { module: '会员签到', description: '更新签到设置' } })],
  handler: async (c) => {
    setAuditBeforeData(c, await getCheckinSettingsBeforeAudit());
    return c.json(okBody(await updateCheckinSettings(c.req.valid('json')), '更新成功'), 200);
  },
});

checkinSettingsRouter.openapiRoutes([getRoute, updateRoute] as const);

export default checkinSettingsRouter;
