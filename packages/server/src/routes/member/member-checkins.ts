import { OpenAPIHono } from '@hono/zod-openapi';
import { memberCheckinContract } from '@zenith/shared/member';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getCheckinCalendar, listMemberCheckins } from '../../services/member/member-checkin.service';

const memberCheckinsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'member:checkin:log:list' })] as const;

const listRoute = defineContractRoute(memberCheckinContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listMemberCheckins(c.req.valid('query'))), 200),
});

const calendarRoute = defineContractRoute(memberCheckinContract.calendar, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCheckinCalendar(c.req.valid('query').month)), 200),
});

memberCheckinsRouter.openapiRoutes([listRoute, calendarRoute] as const);

export default memberCheckinsRouter;
