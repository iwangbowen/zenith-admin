import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { currentUser } from '../lib/context';
import {
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  okBody,
  jsonContent,
  IdParam,
} from '../lib/openapi-schemas';
import { SshProfileDTO } from '../lib/openapi-dtos';
import {
  listSshProfiles,
  getSshProfile,
  createSshProfile,
  updateSshProfile,
  deleteSshProfile,
} from '../services/ssh-profiles.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const PERM = 'system:terminal:execute';

const SshProfileBody = z.object({
  name: z.string().min(1).max(128),
  host: z.string().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).default(22),
  username: z.string().min(1).max(128),
  authType: z.enum(['password', 'key_path', 'key_content', 'agent']),
  password: z.string().max(512).nullable().optional(),
  keyPath: z.string().max(512).nullable().optional(),
  keyContent: z.string().max(16384).nullable().optional(),
  keyPassphrase: z.string().max(512).nullable().optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  groupName: z.string().max(128).nullable().optional(),
  tags: z.array(z.string().max(32)).max(20).optional(),
  orderNum: z.coerce.number().int().optional(),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['SshProfiles'], summary: '我的 SSH 配置列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    responses: { ...commonErrorResponses, ...ok(SshProfileDTO.array(), 'SSH 配置列表') },
  }),
  handler: async (c) => {
    const user = currentUser();
    return c.json(okBody(await listSshProfiles(user.userId)), 200);
  },
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:id', tags: ['SshProfiles'], summary: '获取 SSH 配置详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(SshProfileDTO, 'SSH 配置详情') },
  }),
  handler: async (c) => {
    const user = currentUser();
    return c.json(okBody(await getSshProfile(Number(c.req.valid('param').id), user.userId)), 200);
  },
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['SshProfiles'], summary: '创建 SSH 配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '创建 SSH 配置', module: 'Web 终端' } })] as const,
    request: { body: { content: jsonContent(SshProfileBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(SshProfileDTO, '创建成功') },
  }),
  handler: async (c) => {
    const user = currentUser();
    const body = c.req.valid('json');
    return c.json(okBody(await createSshProfile(user.userId, body)), 200);
  },
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/:id', tags: ['SshProfiles'], summary: '更新 SSH 配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '更新 SSH 配置', module: 'Web 终端' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(SshProfileBody.partial()), required: true } },
    responses: { ...commonErrorResponses, ...ok(SshProfileDTO, '更新成功') },
  }),
  handler: async (c) => {
    const user = currentUser();
    const body = c.req.valid('json');
    return c.json(okBody(await updateSshProfile(Number(c.req.valid('param').id), user.userId, body)), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/:id', tags: ['SshProfiles'], summary: '删除 SSH 配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '删除 SSH 配置', module: 'Web 终端' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const user = currentUser();
    await deleteSshProfile(Number(c.req.valid('param').id), user.userId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, createRoute_, getRoute, updateRoute, deleteRoute] as const);

export default router;
