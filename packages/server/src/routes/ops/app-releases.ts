/**
 * 应用版本管理（管理侧 API）。
 *
 * 应用 / 版本 / 制品 CRUD、发布状态机（publish / revoke）、灰度调整与升级看板统计、统一设备中心。
 * 五组子资源各自独立挂载在 /api/app-releases 下的静态前缀（apps / releases / artifacts / devices / stats），
 * 见 routes/ops/index.ts。公开侧（客户端检查更新 / 制品分发）在 public-app-releases.ts，不要混入本文件。
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  APP_ARCHES,
  APP_FILE_ARTIFACT_KINDS,
  APP_PLATFORMS,
  appArtifactContract,
  appReleaseContract,
  appReleaseStatsContract,
  clientAppContract,
  clientDeviceContract,
} from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  addExternalArtifact,
  addFileArtifact,
  createAppRelease,
  createClientApp,
  deleteAppArtifact,
  deleteAppRelease,
  deleteClientApp,
  getAppArtifactBeforeAudit,
  getAppRelease,
  getAppReleaseBeforeAudit,
  getAppReleaseStats,
  getClientAppBeforeAudit,
  listAllClientApps,
  listAppReleases,
  listClientApps,
  publishAppRelease,
  revokeAppRelease,
  setAppReleaseRollout,
  updateAppRelease,
  updateClientApp,
} from '../../services/ops/app-releases.service';
import {
  adminUnbindDevicePush,
  deleteClientDevice,
  getClientDeviceBeforeAudit,
  listClientDevices,
} from '../../services/ops/client-devices.service';

const MODULE = '应用版本管理';
const list = [authMiddleware, guard({ permission: 'system:app-release:list' })] as const;
const audited = (permission: string, description: string, recordBody = true) =>
  [authMiddleware, guard({ permission, audit: { description, module: MODULE, recordBody } })] as const;
const notFoundResponse = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

// ─── 应用 ────────────────────────────────────────────────────────────────────

export const clientAppsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listAppsRoute = defineContractRoute(clientAppContract.list, {
  middleware: list,
  handler: async (c) => c.json(okBody(await listClientApps(c.req.valid('query'))), 200),
});

const allAppsRoute = defineContractRoute(clientAppContract.all, {
  middleware: list,
  handler: async (c) => c.json(okBody(await listAllClientApps()), 200),
});

const createAppRoute = defineContractRoute(clientAppContract.create, {
  middleware: audited('system:app-release:create', '创建应用'),
  handler: async (c) => c.json(okBody(await createClientApp(c.req.valid('json')), '创建成功'), 200),
});

const updateAppRoute = defineContractRoute(clientAppContract.update, {
  middleware: audited('system:app-release:update', '更新应用'),
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getClientAppBeforeAudit(id));
    return c.json(okBody(await updateClientApp(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteAppRoute = defineContractRoute(clientAppContract.remove, {
  middleware: audited('system:app-release:delete', '删除应用'),
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getClientAppBeforeAudit(id));
    await deleteClientApp(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// 静态 /all 先于 /{id}
clientAppsRouter.openapiRoutes([listAppsRoute, allAppsRoute, createAppRoute, updateAppRoute, deleteAppRoute] as const);

// ─── 版本 ────────────────────────────────────────────────────────────────────

export const appReleasesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listReleasesRoute = defineContractRoute(appReleaseContract.list, {
  middleware: list,
  handler: async (c) => c.json(okBody(await listAppReleases(c.req.valid('query'))), 200),
});

const getReleaseRoute = defineContractRoute(appReleaseContract.detail, {
  middleware: list,
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getAppRelease(id)), 200);
  },
});

const createReleaseRoute = defineContractRoute(appReleaseContract.create, {
  middleware: audited('system:app-release:create', '创建版本'),
  handler: async (c) => c.json(okBody(await createAppRelease(c.req.valid('json')), '创建成功'), 200),
});

const updateReleaseRoute = defineContractRoute(appReleaseContract.update, {
  middleware: audited('system:app-release:update', '更新版本'),
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getAppReleaseBeforeAudit(id));
    return c.json(okBody(await updateAppRelease(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteReleaseRoute = defineContractRoute(appReleaseContract.remove, {
  middleware: audited('system:app-release:delete', '删除版本'),
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getAppReleaseBeforeAudit(id));
    await deleteAppRelease(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const publishReleaseRoute = defineContractRoute(appReleaseContract.publish, {
  middleware: audited('system:app-release:publish', '发布版本'),
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getAppReleaseBeforeAudit(id));
    return c.json(okBody(await publishAppRelease(id), '发布成功'), 200);
  },
});

const revokeReleaseRoute = defineContractRoute(appReleaseContract.revoke, {
  middleware: audited('system:app-release:publish', '撤回版本'),
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getAppReleaseBeforeAudit(id));
    return c.json(okBody(await revokeAppRelease(id), '撤回成功'), 200);
  },
});

const rolloutRoute = defineContractRoute(appReleaseContract.rollout, {
  middleware: audited('system:app-release:update', '调整灰度比例'),
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getAppReleaseBeforeAudit(id));
    const { rolloutPercent } = c.req.valid('json');
    return c.json(okBody(await setAppReleaseRollout(id, rolloutPercent), '调整成功'), 200);
  },
});

/** multipart 字段校验（文件本体由 parseBody 提取） */
const uploadArtifactFieldsSchema = z.object({
  platform: z.enum(APP_PLATFORMS),
  arch: z.enum(APP_ARCHES).default('x64'),
  kind: z.enum(APP_FILE_ARTIFACT_KINDS).default('installer'),
});

const uploadArtifactRoute = defineContractRoute(appReleaseContract.uploadArtifact, {
  middleware: audited('system:app-release:create', '上传制品', false),
  responses: { 404: { content: jsonContent(ErrorResponse), description: '版本不存在' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = await c.req.parseBody();
    const parsed = uploadArtifactFieldsSchema.safeParse({
      platform: body.platform,
      arch: body.arch || undefined,
      kind: body.kind || undefined,
    });
    if (!parsed.success) return c.json(errBody(parsed.error.issues[0]?.message ?? '制品参数不合法', 400), 400);
    if (!(body.file instanceof File)) return c.json(errBody('请选择要上传的制品文件', 400), 400);
    const artifact = await addFileArtifact(id, parsed.data, body.file);
    return c.json(okBody(artifact, '上传成功'), 200);
  },
});

const externalArtifactRoute = defineContractRoute(appReleaseContract.addExternalArtifact, {
  middleware: audited('system:app-release:create', '添加外链制品'),
  responses: { 404: { content: jsonContent(ErrorResponse), description: '版本不存在' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await addExternalArtifact(id, c.req.valid('json')), '添加成功'), 200);
  },
});

appReleasesRouter.openapiRoutes([
  listReleasesRoute,
  getReleaseRoute,
  createReleaseRoute,
  updateReleaseRoute,
  deleteReleaseRoute,
  publishReleaseRoute,
  revokeReleaseRoute,
  rolloutRoute,
  uploadArtifactRoute,
  externalArtifactRoute,
] as const);

// ─── 制品 ────────────────────────────────────────────────────────────────────

export const appArtifactsRouter = new OpenAPIHono({ defaultHook: validationHook });

const deleteArtifactRoute = defineContractRoute(appArtifactContract.remove, {
  middleware: audited('system:app-release:delete', '删除制品'),
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getAppArtifactBeforeAudit(id));
    await deleteAppArtifact(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

appArtifactsRouter.openapiRoutes([deleteArtifactRoute] as const);

// ─── 看板统计 ────────────────────────────────────────────────────────────────

export const appReleaseStatsRouter = new OpenAPIHono({ defaultHook: validationHook });

const statsRoute = defineContractRoute(appReleaseStatsContract.stats, {
  middleware: list,
  handler: async (c) => {
    const { appId, days } = c.req.valid('query');
    return c.json(okBody(await getAppReleaseStats(appId, days)), 200);
  },
});

appReleaseStatsRouter.openapiRoutes([statsRoute] as const);

// ─── 设备中心（管理端）───────────────────────────────────────────────────────

export const clientDevicesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listDevicesRoute = defineContractRoute(clientDeviceContract.list, {
  middleware: list,
  handler: async (c) => {
    const { pushBound, ...rest } = c.req.valid('query');
    return c.json(okBody(await listClientDevices({ ...rest, pushBound: pushBound === 'true' })), 200);
  },
});

const unbindDeviceRoute = defineContractRoute(clientDeviceContract.unbind, {
  middleware: audited('system:app-release:update', '解绑设备推送'),
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getClientDeviceBeforeAudit(id));
    await adminUnbindDevicePush(id);
    return c.json(okBody(null, '解绑成功'), 200);
  },
});

const deleteDeviceRoute = defineContractRoute(clientDeviceContract.remove, {
  middleware: audited('system:app-release:delete', '删除设备档案'),
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getClientDeviceBeforeAudit(id));
    await deleteClientDevice(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

clientDevicesRouter.openapiRoutes([listDevicesRoute, unbindDeviceRoute, deleteDeviceRoute] as const);
