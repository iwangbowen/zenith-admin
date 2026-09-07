import { OpenAPIHono } from '@hono/zod-openapi';
import { driveCollaborationContract } from '@zenith/shared/drive';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getDriveNodeProfile, getDriveSubscription, listDriveSpaceActivities, saveDriveNodeProfile, setDriveSubscription } from '../../services/drive/drive-collaboration.service';
import { updateDriveNodeComment } from '../../services/drive/drive-extras.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const read = [authMiddleware, guard({ permission: 'drive:node:list' })] as const;

router.openapiRoutes([
  defineContractRoute(driveCollaborationContract.profile, {
    middleware: read,
    handler: async (c) => c.json(okBody(await getDriveNodeProfile(c.req.valid('param').id)), 200),
  }),
  defineContractRoute(driveCollaborationContract.saveProfile, {
    middleware: [authMiddleware, guard({ permission: 'drive:node:edit', audit: { module: '企业网盘', description: '更新文件说明与属性' } })],
    handler: async (c) => {
      const { id } = c.req.valid('param');
      setAuditBeforeData(c, await getDriveNodeProfile(id));
      return c.json(okBody(await saveDriveNodeProfile(id, c.req.valid('json'))), 200);
    },
  }),
  defineContractRoute(driveCollaborationContract.subscription, {
    middleware: read,
    handler: async (c) => c.json(okBody(await getDriveSubscription(c.req.valid('param').id)), 200),
  }),
  defineContractRoute(driveCollaborationContract.subscribe, {
    middleware: read,
    handler: async (c) => c.json(okBody(await setDriveSubscription(c.req.valid('param').id, c.req.valid('json').subscribed)), 200),
  }),
  defineContractRoute(driveCollaborationContract.editComment, {
    middleware: read,
    handler: async (c) => {
      const { id, commentId } = c.req.valid('param');
      return c.json(okBody(await updateDriveNodeComment(id, commentId, c.req.valid('json'))), 200);
    },
  }),
  defineContractRoute(driveCollaborationContract.spaceActivities, {
    middleware: read,
    handler: async (c) => c.json(okBody(await listDriveSpaceActivities(c.req.valid('param').id, c.req.valid('query'))), 200),
  }),
] as const);

export default router;
