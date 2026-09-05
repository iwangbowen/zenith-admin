import { OpenAPIHono } from '@hono/zod-openapi';
import { driveShareLinkContract } from '@zenith/shared/drive';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  deleteDriveShareLink,
  getShareLinkBeforeAudit,
  listMyShareLinks,
  listShareAccessLogs,
  revokeDriveShareLink,
  updateDriveShareLink,
} from '../../services/drive/drive-share.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const AUDIT = { module: '企业网盘' } as const;

const read = [authMiddleware, guard({ permission: 'drive:link:create' })] as const;

const listRoute = defineContractRoute(driveShareLinkContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listMyShareLinks(c.req.valid('query'))), 200),
});

const updateRoute = defineContractRoute(driveShareLinkContract.update, {
  middleware: [authMiddleware, guard({ permission: 'drive:link:create', audit: { description: '修改网盘外链', recordBody: false, ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getShareLinkBeforeAudit(id));
    return c.json(okBody(await updateDriveShareLink(id, c.req.valid('json')), '已更新'), 200);
  },
});

const revokeRoute = defineContractRoute(driveShareLinkContract.revoke, {
  middleware: [authMiddleware, guard({ permission: 'drive:link:create', audit: { description: '撤销网盘外链', ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getShareLinkBeforeAudit(id));
    await revokeDriveShareLink(id);
    setAuditAfterData(c, await getShareLinkBeforeAudit(id));
    return c.json(okBody(null, '已撤销'), 200);
  },
});

const deleteRoute = defineContractRoute(driveShareLinkContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'drive:link:create', audit: { description: '删除网盘外链', ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getShareLinkBeforeAudit(id));
    await deleteDriveShareLink(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const accessLogsRoute = defineContractRoute(driveShareLinkContract.accessLogs, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listShareAccessLogs(id, page, pageSize)), 200);
  },
});

router.openapiRoutes([listRoute, updateRoute, revokeRoute, deleteRoute, accessLogsRoute] as const);

export default router;
