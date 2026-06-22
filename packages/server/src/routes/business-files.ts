import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { validationHook, commonErrorResponses, ok, okMsg, okBody } from '../lib/openapi-schemas';
import { BusinessFileDTO } from '../lib/openapi-dtos';
import { listBusinessFiles, removeBusinessFile, type BusinessFileType } from '../services/business-files.service';

const businessFilesRouter = new OpenAPIHono({ defaultHook: validationHook });

const BusinessTypeParam = z.object({
  businessType: z.string().openapi({ example: 'announcement', description: '业务类型' }),
  businessId: z.coerce.number().int().openapi({ example: 1, description: '业务记录 ID' }),
});

function assertBusinessType(value: string): BusinessFileType {
  return value as BusinessFileType;
}

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{businessType}/{businessId}', tags: ['Business Files'], summary: '获取业务附件列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: BusinessTypeParam },
    responses: { ...commonErrorResponses, ...ok(z.array(BusinessFileDTO), '附件列表') },
  }),
  handler: async (c) => {
    const { businessType, businessId } = c.req.valid('param');
    return c.json(okBody(await listBusinessFiles(assertBusinessType(businessType), businessId)), 200);
  },
});

const removeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{businessType}/{businessId}/{fileId}', tags: ['Business Files'], summary: '移除业务附件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:delete' })] as const,
    request: {
      params: BusinessTypeParam.extend({ fileId: z.string().uuid().openapi({ example: '018f6f8a-5f76-7d8c-9a1b-2c3d4e5f6789' }) }),
    },
    responses: { ...commonErrorResponses, ...okMsg('移除成功') },
  }),
  handler: async (c) => {
    const { businessType, businessId, fileId } = c.req.valid('param');
    await removeBusinessFile(assertBusinessType(businessType), businessId, fileId);
    return c.json(okBody(null, '移除成功'), 200);
  },
});

businessFilesRouter.openapiRoutes([listRoute, removeRoute] as const);

export default businessFilesRouter;
