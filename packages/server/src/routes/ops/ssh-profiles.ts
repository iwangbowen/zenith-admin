import { OpenAPIHono } from '@hono/zod-openapi';
import { sshProfileContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { currentUser } from '../../lib/context';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listSshProfiles,
  getSshProfile,
  createSshProfile,
  updateSshProfile,
  deleteSshProfile,
} from '../../services/ops/ssh-profiles.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const PERM = 'system:terminal:execute';

const read = [authMiddleware, guard({ permission: PERM })] as const;

const listRoute = defineContractRoute(sshProfileContract.list, {
  middleware: read,
  handler: async (c) => {
    const user = currentUser();
    return c.json(okBody(await listSshProfiles(user.userId)), 200);
  },
});

const getRoute = defineContractRoute(sshProfileContract.detail, {
  middleware: read,
  handler: async (c) => {
    const user = currentUser();
    return c.json(okBody(await getSshProfile(Number(c.req.valid('param').id), user.userId)), 200);
  },
});

const createRoute_ = defineContractRoute(sshProfileContract.create, {
  middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '创建 SSH 配置', module: 'Web 终端' } })],
  handler: async (c) => {
    const user = currentUser();
    const body = c.req.valid('json');
    return c.json(okBody(await createSshProfile(user.userId, body)), 200);
  },
});

const updateRoute = defineContractRoute(sshProfileContract.update, {
  middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '更新 SSH 配置', module: 'Web 终端' } })],
  handler: async (c) => {
    const user = currentUser();
    const body = c.req.valid('json');
    return c.json(okBody(await updateSshProfile(Number(c.req.valid('param').id), user.userId, body)), 200);
  },
});

const deleteRoute = defineContractRoute(sshProfileContract.remove, {
  middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '删除 SSH 配置', module: 'Web 终端' } })],
  handler: async (c) => {
    const user = currentUser();
    await deleteSshProfile(Number(c.req.valid('param').id), user.userId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, createRoute_, getRoute, updateRoute, deleteRoute] as const);

export default router;
