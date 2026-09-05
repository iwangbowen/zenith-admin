import { OpenAPIHono } from '@hono/zod-openapi';
import { driveTagContract } from '@zenith/shared/drive';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { createDriveTag, deleteDriveTag, listDriveTags, updateDriveTag } from '../../services/drive/drive-extras.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const edit = [authMiddleware, guard({ permission: 'drive:node:edit' })] as const;

const listRoute = defineContractRoute(driveTagContract.list, {
  middleware: [authMiddleware, guard({ permission: 'drive:node:list' })],
  handler: async (c) => c.json(okBody(await listDriveTags(c.req.valid('query').spaceId)), 200),
});

const createRoute = defineContractRoute(driveTagContract.create, {
  middleware: edit,
  handler: async (c) => c.json(okBody(await createDriveTag(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(driveTagContract.update, {
  middleware: edit,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateDriveTag(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(driveTagContract.remove, {
  middleware: edit,
  handler: async (c) => {
    await deleteDriveTag(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, createRoute, updateRoute, deleteRoute] as const);

export default router;
