import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { dockerContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
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
  pruneContainers,
  pruneImages,
  pruneNetworks,
  pruneVolumes,
  pruneSystem,
} from '../../services/ops/docker.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const VIEW_PERM = 'system:docker:view';
const MANAGE_PERM = 'system:docker:manage';

const view = [authMiddleware, guard({ permission: VIEW_PERM })] as const;
const manage = (description: string) => [authMiddleware, guard({ permission: MANAGE_PERM, audit: { description, module: '系统运维' } })] as const;

/** Docker daemon 不可达时清单接口统一回 503，而不是被兜成 500 */
async function unavailableAs503<T>(probe: () => Promise<T>): Promise<T> {
  try {
    return await probe();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(503, { message: `Docker 不可用: ${msg}` });
  }
}

// ─── Containers ───────────────────────────────────────────────────────────────

const listRoute = defineContractRoute(dockerContract.containers, {
  middleware: view,
  handler: async (c) => c.json(okBody(await unavailableAs503(listContainers)), 200),
});

const startRoute = defineContractRoute(dockerContract.start, {
  middleware: manage('启动 Docker 容器'),
  handler: async (c) => {
    await startContainer(c.req.valid('param').id);
    return c.json(okBody(null, '启动成功'), 200);
  },
});

const stopRoute = defineContractRoute(dockerContract.stop, {
  middleware: manage('停止 Docker 容器'),
  handler: async (c) => {
    await stopContainer(c.req.valid('param').id);
    return c.json(okBody(null, '停止成功'), 200);
  },
});

const restartRoute = defineContractRoute(dockerContract.restart, {
  middleware: manage('重启 Docker 容器'),
  handler: async (c) => {
    await restartContainer(c.req.valid('param').id);
    return c.json(okBody(null, '重启成功'), 200);
  },
});

const logsRoute = defineContractRoute(dockerContract.logs, {
  middleware: view,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { tail } = c.req.valid('query');
    const logs = await getContainerLogs(id, Number(tail));
    return c.json(okBody({ logs }), 200);
  },
});

const statsRoute = defineContractRoute(dockerContract.stats, {
  middleware: view,
  handler: async (c) => {
    const stats = await getContainerStats(c.req.valid('param').id);
    return c.json(okBody(stats), 200);
  },
});

const inspectRoute = defineContractRoute(dockerContract.inspect, {
  middleware: view,
  handler: async (c) => {
    const info = await inspectContainer(c.req.valid('param').id);
    return c.json(okBody(info as unknown as Record<string, unknown>), 200);
  },
});

// ─── Images ──────────────────────────────────────────────────────────────────

const listImagesRoute = defineContractRoute(dockerContract.images, {
  middleware: view,
  handler: async (c) => c.json(okBody(await unavailableAs503(listImages)), 200),
});

const removeImageRoute = defineContractRoute(dockerContract.removeImage, {
  middleware: manage('删除 Docker 镜像'),
  handler: async (c) => {
    await removeImage(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const pullImageRoute = defineContractRoute(dockerContract.pullImage, {
  middleware: manage('拉取 Docker 镜像'),
  handler: async (c) => {
    const { repoTag } = c.req.valid('json');
    await pullImage(repoTag);
    return c.json(okBody(null, '拉取成功'), 200);
  },
});

// ─── Networks ─────────────────────────────────────────────────────────────────

const listNetworksRoute = defineContractRoute(dockerContract.networks, {
  middleware: view,
  handler: async (c) => c.json(okBody(await unavailableAs503(listNetworks)), 200),
});

const removeNetworkRoute = defineContractRoute(dockerContract.removeNetwork, {
  middleware: manage('删除 Docker 网络'),
  handler: async (c) => {
    await removeNetwork(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const createNetworkRoute = defineContractRoute(dockerContract.createNetwork, {
  middleware: manage('创建 Docker 网络'),
  handler: async (c) => {
    const { name, driver, internal } = c.req.valid('json');
    await createNetwork(name, driver, internal);
    return c.json(okBody(null, '创建成功'), 200);
  },
});

// ─── Volumes ──────────────────────────────────────────────────────────────────

const listVolumesRoute = defineContractRoute(dockerContract.volumes, {
  middleware: view,
  handler: async (c) => c.json(okBody(await unavailableAs503(listVolumes)), 200),
});

const removeVolumeRoute = defineContractRoute(dockerContract.removeVolume, {
  middleware: manage('删除 Docker 存储卷'),
  handler: async (c) => {
    await removeVolume(c.req.valid('param').name);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const createVolumeRoute = defineContractRoute(dockerContract.createVolume, {
  middleware: manage('创建 Docker 存储卷'),
  handler: async (c) => {
    const { name, driver } = c.req.valid('json');
    await createVolume(name, driver);
    return c.json(okBody(null, '创建成功'), 200);
  },
});

// ─── Container file browsing ──────────────────────────────────────────────────

const listContainerFilesRoute = defineContractRoute(dockerContract.containerFiles, {
  middleware: view,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { path } = c.req.valid('query');
    const entries = await listContainerFiles(id, path ?? '/');
    return c.json(okBody(entries), 200);
  },
});

const readContainerFileRoute = defineContractRoute(dockerContract.containerFileContent, {
  middleware: view,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { path } = c.req.valid('query');
    const content = await readContainerFile(id, path);
    return c.json(okBody({ content }), 200);
  },
});

// ─── Prune ────────────────────────────────────────────────────────────────────

const pruneContainersRoute = defineContractRoute(dockerContract.pruneContainers, {
  middleware: manage('清理已停止 Docker 容器'),
  handler: async (c) => c.json(okBody(await pruneContainers(), '清理完成'), 200),
});

const pruneImagesRoute = defineContractRoute(dockerContract.pruneImages, {
  middleware: manage('清理 Docker 镜像'),
  handler: async (c) => {
    const all = c.req.valid('query').all === 'true';
    return c.json(okBody(await pruneImages(all), '清理完成'), 200);
  },
});

const pruneNetworksRoute = defineContractRoute(dockerContract.pruneNetworks, {
  middleware: manage('清理 Docker 网络'),
  handler: async (c) => c.json(okBody(await pruneNetworks(), '清理完成'), 200),
});

const pruneVolumesRoute = defineContractRoute(dockerContract.pruneVolumes, {
  middleware: manage('清理 Docker 存储卷'),
  handler: async (c) => c.json(okBody(await pruneVolumes(), '清理完成'), 200),
});

const pruneSystemRoute = defineContractRoute(dockerContract.pruneSystem, {
  middleware: manage('Docker 系统清理'),
  handler: async (c) => c.json(okBody(await pruneSystem(), '清理完成'), 200),
});

router.openapiRoutes([
  listRoute, startRoute, stopRoute, restartRoute, logsRoute, statsRoute, inspectRoute,
  listImagesRoute, removeImageRoute, pullImageRoute,
  listNetworksRoute, removeNetworkRoute, createNetworkRoute,
  listVolumesRoute, removeVolumeRoute, createVolumeRoute,
  listContainerFilesRoute, readContainerFileRoute,
  pruneContainersRoute, pruneImagesRoute, pruneNetworksRoute, pruneVolumesRoute, pruneSystemRoute,
] as const);

export default router;
