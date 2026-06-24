import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { idempotencyGuard } from '../middleware/idempotency';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { createMpQrcodeSchema } from '@zenith/shared';
import { MpQrcodeDTO } from '../lib/openapi-dtos';
import {
  listMpQrcodes, createMpQrcode, deleteMpQrcode, getMpQrcodeBeforeAudit,
} from '../services/mp-qrcode.service';

const mpQrcodesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['公众号二维码'], summary: '二维码列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:qrcode:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        accountId: z.coerce.number().int().positive(),
        type: z.enum(['temporary', 'permanent']).optional(),
        keyword: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(MpQrcodeDTO, '二维码列表') },
  }),
  handler: async (c) => c.json(okBody(await listMpQrcodes(c.req.valid('query'))), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['公众号二维码'], summary: '创建带参二维码',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'mp:qrcode:create', audit: { description: '创建带参二维码', module: '公众号二维码' } }),
      idempotencyGuard({ ttlSeconds: 10 }),
    ] as const,
    request: { body: { content: jsonContent(createMpQrcodeSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpQrcodeDTO, '生成成功') },
  }),
  handler: async (c) => c.json(okBody(await createMpQrcode(c.req.valid('json')), '生成成功'), 200),
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['公众号二维码'], summary: '删除二维码',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:qrcode:delete', audit: { description: '删除带参二维码', module: '公众号二维码' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpQrcodeBeforeAudit(id));
    await deleteMpQrcode(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mpQrcodesRouter.openapiRoutes([listRoute, createRouteDef, deleteRoute] as const);

export default mpQrcodesRouter;
