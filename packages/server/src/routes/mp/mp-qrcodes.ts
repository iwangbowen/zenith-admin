import { OpenAPIHono } from '@hono/zod-openapi';
import { mpQrcodeContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpQrcodes, createMpQrcode, deleteMpQrcode, getMpQrcodeBeforeAudit,
} from '../../services/mp/mp-qrcode.service';

const mpQrcodesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(mpQrcodeContract.list, {
  middleware: [authMiddleware, guard({ permission: 'mp:qrcode:list' })],
  handler: async (c) => c.json(okBody(await listMpQrcodes(c.req.valid('query'))), 200),
});

const createRouteDef = defineContractRoute(mpQrcodeContract.create, {
  middleware: [
    authMiddleware,
    guard({ permission: 'mp:qrcode:create', audit: { description: '创建带参二维码', module: '公众号二维码' } }),
    idempotencyGuard({ ttlSeconds: 10 }),
  ],
  handler: async (c) => c.json(okBody(await createMpQrcode(c.req.valid('json')), '生成成功'), 200),
});

const deleteRoute = defineContractRoute(mpQrcodeContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'mp:qrcode:delete', audit: { description: '删除带参二维码', module: '公众号二维码' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpQrcodeBeforeAudit(id));
    await deleteMpQrcode(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mpQrcodesRouter.openapiRoutes([listRoute, createRouteDef, deleteRoute] as const);

export default mpQrcodesRouter;
