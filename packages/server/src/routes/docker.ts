import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  okBody,
} from '../lib/openapi-schemas';
import {
  listContainers,
  startContainer,
  stopContainer,
  restartContainer,
  getContainerLogs,
  getContainerStats,
  inspectContainer,
  listImages,
  removeImage,
  pullImage,
  listNetworks,
  removeNetwork,
  createNetwork,
  listVolumes,
  removeVolume,
  createVolume,
  listContainerFiles,
  readContainerFile,
} from '../services/docker.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const PERM = 'system:process:view';

const ContainerDTO = z.object({
  id: z.string(),
  shortId: z.string(),
  names: z.array(z.string()),
  image: z.string(),
  imageId: z.string(),
  command: z.string(),
  created: z.number(),
  state: z.string(),
  status: z.string(),
  ports: z.array(z.object({
    privatePort: z.number(),
    publicPort: z.number().optional(),
    type: z.string(),
  })),
  composeProject: z.string().nullable(),
  composeService: z.string().nullable(),
});

const ContainerIdParam = z.object({ id: z.string().min(1) });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Docker'], summary: '容器列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    responses: { ...commonErrorResponses, ...ok(ContainerDTO.array(), '容器列表') },
  }),
  handler: async (c) => {
    try {
      return c.json(okBody(await listContainers()), 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HTTPException(503, { message: `Docker 不可用: ${msg}` });
    }
  },
});

const startRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/:id/start', tags: ['Docker'], summary: '启动容器',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '启动 Docker 容器', module: '系统运维' } })] as const,
    request: { params: ContainerIdParam },
    responses: { ...commonErrorResponses, ...okMsg('启动成功') },
  }),
  handler: async (c) => {
    await startContainer(c.req.valid('param').id);
    return c.json(okBody(null, '启动成功'), 200);
  },
});

const stopRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/:id/stop', tags: ['Docker'], summary: '停止容器',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '停止 Docker 容器', module: '系统运维' } })] as const,
    request: { params: ContainerIdParam },
    responses: { ...commonErrorResponses, ...okMsg('停止成功') },
  }),
  handler: async (c) => {
    await stopContainer(c.req.valid('param').id);
    return c.json(okBody(null, '停止成功'), 200);
  },
});

const restartRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/:id/restart', tags: ['Docker'], summary: '重启容器',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '重启 Docker 容器', module: '系统运维' } })] as const,
    request: { params: ContainerIdParam },
    responses: { ...commonErrorResponses, ...okMsg('重启成功') },
  }),
  handler: async (c) => {
    await restartContainer(c.req.valid('param').id);
    return c.json(okBody(null, '重启成功'), 200);
  },
});

const logsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:id/logs', tags: ['Docker'], summary: '获取容器日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    request: {
      params: ContainerIdParam,
      query: z.object({ tail: z.coerce.number().int().min(10).max(5000).default(200) }),
    },
    responses: { ...commonErrorResponses, ...ok(z.object({ logs: z.string() }), '容器日志') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { tail } = c.req.valid('query');
    const logs = await getContainerLogs(id, Number(tail));
    return c.json(okBody({ logs }), 200);
  },
});

const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:id/stats', tags: ['Docker'], summary: '获取容器资源占用',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    request: { params: ContainerIdParam },
    responses: { ...commonErrorResponses, ...ok(z.object({ cpuPercent: z.number(), memUsage: z.number(), memLimit: z.number() }), '资源占用') },
  }),
  handler: async (c) => {
    const stats = await getContainerStats(c.req.valid('param').id);
    return c.json(okBody(stats), 200);
  },
});

const inspectRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:id/inspect', tags: ['Docker'], summary: '容器详情（docker inspect）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    request: { params: ContainerIdParam },
    responses: { ...commonErrorResponses, ...ok(z.record(z.string(), z.unknown()), '容器详情') },
  }),
  handler: async (c) => {
    const info = await inspectContainer(c.req.valid('param').id);
    return c.json(okBody(info as unknown as Record<string, unknown>), 200);
  },
});

// ─── Images ──────────────────────────────────────────────────────────────────

const ImageDTO = z.object({
  id: z.string(),
  shortId: z.string(),
  repoTags: z.array(z.string()),
  size: z.number(),
  created: z.number(),
  containers: z.number(),
});

const listImagesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/images', tags: ['Docker'], summary: '镜像列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    responses: { ...commonErrorResponses, ...ok(ImageDTO.array(), '镜像列表') },
  }),
  handler: async (c) => {
    try {
      return c.json(okBody(await listImages()), 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HTTPException(503, { message: `Docker 不可用: ${msg}` });
    }
  },
});

const removeImageRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/images/:id', tags: ['Docker'], summary: '删除镜像',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '删除 Docker 镜像', module: '系统运维' } })] as const,
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    await removeImage(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const pullImageRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/images/pull', tags: ['Docker'], summary: '拉取镜像',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '拉取 Docker 镜像', module: '系统运维' } })] as const,
    request: { body: { content: { 'application/json': { schema: z.object({ repoTag: z.string().min(1) }) } }, required: true } },
    responses: { ...commonErrorResponses, ...okMsg('拉取成功') },
  }),
  handler: async (c) => {
    const { repoTag } = c.req.valid('json');
    await pullImage(repoTag);
    return c.json(okBody(null, '拉取成功'), 200);
  },
});

// ─── Networks ─────────────────────────────────────────────────────────────────

const NetworkDTO = z.object({
  id: z.string(),
  name: z.string(),
  driver: z.string(),
  scope: z.string(),
  ipam: z.object({ driver: z.string(), subnet: z.string().optional(), gateway: z.string().optional() }),
  internal: z.boolean(),
  created: z.string(),
  containers: z.number(),
});

const listNetworksRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/networks', tags: ['Docker'], summary: '网络列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    responses: { ...commonErrorResponses, ...ok(NetworkDTO.array(), '网络列表') },
  }),
  handler: async (c) => {
    try {
      return c.json(okBody(await listNetworks()), 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HTTPException(503, { message: `Docker 不可用: ${msg}` });
    }
  },
});

const removeNetworkRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/networks/:id', tags: ['Docker'], summary: '删除网络',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '删除 Docker 网络', module: '系统运维' } })] as const,
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    await removeNetwork(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const createNetworkRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/networks', tags: ['Docker'], summary: '创建网络',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '创建 Docker 网络', module: '系统运维' } })] as const,
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              name: z.string().min(1).max(128),
              driver: z.string().default('bridge'),
              internal: z.boolean().default(false),
            }),
          },
        },
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...okMsg('创建成功') },
  }),
  handler: async (c) => {
    const { name, driver, internal } = c.req.valid('json');
    await createNetwork(name, driver, internal);
    return c.json(okBody(null, '创建成功'), 200);
  },
});

// ─── Volumes ──────────────────────────────────────────────────────────────────

const VolumeDTO = z.object({
  name: z.string(),
  driver: z.string(),
  mountpoint: z.string(),
  scope: z.string(),
  created: z.string(),
  labels: z.record(z.string(), z.string()),
});

const listVolumesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/volumes', tags: ['Docker'], summary: '存储卷列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    responses: { ...commonErrorResponses, ...ok(VolumeDTO.array(), '存储卷列表') },
  }),
  handler: async (c) => {
    try {
      return c.json(okBody(await listVolumes()), 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HTTPException(503, { message: `Docker 不可用: ${msg}` });
    }
  },
});

const removeVolumeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/volumes/:name', tags: ['Docker'], summary: '删除存储卷',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '删除 Docker 存储卷', module: '系统运维' } })] as const,
    request: { params: z.object({ name: z.string().min(1) }) },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    await removeVolume(c.req.valid('param').name);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const createVolumeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/volumes', tags: ['Docker'], summary: '创建存储卷',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '创建 Docker 存储卷', module: '系统运维' } })] as const,
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              name: z.string().min(1).max(255),
              driver: z.string().default('local'),
            }),
          },
        },
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...okMsg('创建成功') },
  }),
  handler: async (c) => {
    const { name, driver } = c.req.valid('json');
    await createVolume(name, driver);
    return c.json(okBody(null, '创建成功'), 200);
  },
});

const listContainerFilesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:id/files', summary: '列出容器内目录', tags: ['Docker'],
    middleware: [authMiddleware] as const,
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ path: z.string().optional() }),
    },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(z.object({
        name: z.string(), path: z.string(),
        type: z.enum(['file', 'dir', 'symlink']),
        size: z.number(),
      })), '容器文件列表'),
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { path } = c.req.valid('query');
    const entries = await listContainerFiles(id, path ?? '/');
    return c.json(okBody(entries), 200);
  },
});

const readContainerFileRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:id/files/content', summary: '读取容器内文件', tags: ['Docker'],
    middleware: [authMiddleware] as const,
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ path: z.string() }),
    },
    responses: {
      ...commonErrorResponses,
      ...ok(z.object({ content: z.string() }), '文件内容'),
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { path } = c.req.valid('query');
    const content = await readContainerFile(id, path);
    return c.json(okBody({ content }), 200);
  },
});

router.openapiRoutes([
  listRoute, startRoute, stopRoute, restartRoute, logsRoute, statsRoute, inspectRoute,
  listImagesRoute, removeImageRoute, pullImageRoute,
  listNetworksRoute, removeNetworkRoute, createNetworkRoute,
  listVolumesRoute, removeVolumeRoute, createVolumeRoute,
  listContainerFilesRoute, readContainerFileRoute,
] as const);

export default router;
