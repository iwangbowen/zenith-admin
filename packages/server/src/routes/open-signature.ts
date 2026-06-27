import { OpenAPIHono, createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okBody,
} from '../lib/openapi-schemas';
import { OpenSignatureResultDTO, OpenSignatureAlgorithmDTO } from '../lib/openapi-dtos';
import { openSignatureVerifySchema } from '@zenith/shared';
import { getSignatureAlgorithmDoc, verifyAppSignature } from '../services/open-signature.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const algorithm = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/algorithm',
    tags: ['OpenSignature'],
    summary: '获取签名算法说明',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:signature:use' })] as const,
    responses: { ...commonErrorResponses, ...ok(OpenSignatureAlgorithmDTO, '签名算法说明') },
  }),
  handler: (c) => c.json(okBody(getSignatureAlgorithmDoc()), 200),
});

const verify = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/verify',
    tags: ['OpenSignature'],
    summary: '在线计算 / 校验请求签名',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:signature:use' })] as const,
    request: { body: { content: jsonContent(openSignatureVerifySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(OpenSignatureResultDTO, '签名结果') },
  }),
  handler: async (c) => c.json(okBody(await verifyAppSignature(c.req.valid('json'))), 200),
});

router.openapiRoutes([algorithm, verify] as const);

export default router;
