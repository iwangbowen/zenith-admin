import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  IdParam,
  PaginationQuery,
  commonErrorResponses,
  fileBody,
  jsonContent,
  ok,
  okBody,
  okFile,
  okMsg,
  validationHook,
} from '../lib/openapi-schemas';
import {
  GenerateSelfSignedCertRequestDTO,
  SslCertificateDTO,
  UploadCertRequestDTO,
} from '../lib/openapi-dtos';
import {
  deleteSslCertificate,
  generateSelfSignedCert,
  getSslCertificate,
  getSslCertificateBeforeAudit,
  getSslCertificateDownload,
  listSslCertificates,
} from '../services/ssl-certificates.service';
import { uploadCert } from '../services/ssl-certificates.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const CreatedResponseDTO = z.object({ id: z.number().int() });
const ListResponseDTO = z.object({
  list: z.array(SslCertificateDTO),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['SslCertificates'],
    summary: 'SSL 证书列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:ssl:view' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().max(256).optional(),
        type: z.enum(['self_signed', 'uploaded', 'letsencrypt']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(ListResponseDTO, '证书列表') },
  }),
  handler: async (c) => c.json(okBody(await listSslCertificates(c.req.valid('query'))), 200),
});

const generateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/generate',
    tags: ['SslCertificates'],
    summary: '生成自签名证书',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({
        permission: 'system:ssl:create',
        audit: { description: '生成 SSL 证书', module: 'SSL 证书', recordBody: false },
      }),
    ] as const,
    request: { body: { content: jsonContent(GenerateSelfSignedCertRequestDTO), required: true } },
    responses: { ...commonErrorResponses, ...ok(CreatedResponseDTO, '证书已生成') },
  }),
  handler: async (c) => c.json(okBody(await generateSelfSignedCert(c.req.valid('json')), '证书已生成'), 200),
});

const uploadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/upload',
    tags: ['SslCertificates'],
    summary: '上传自定义证书',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({
        permission: 'system:ssl:create',
        audit: { description: '上传 SSL 证书', module: 'SSL 证书', recordBody: false },
      }),
    ] as const,
    request: { body: { content: jsonContent(UploadCertRequestDTO), required: true } },
    responses: { ...commonErrorResponses, ...ok(CreatedResponseDTO, '证书已上传') },
  }),
  handler: async (c) => c.json(okBody(await uploadCert(c.req.valid('json')), '证书已上传'), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['SslCertificates'],
    summary: 'SSL 证书详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:ssl:view' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(SslCertificateDTO, '证书详情') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getSslCertificate(id)), 200);
  },
});

const downloadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/download',
    tags: ['SslCertificates'],
    summary: '下载 SSL 证书文件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:ssl:view' })] as const,
    request: {
      params: IdParam,
      query: z.object({
        kind: z.enum(['cert', 'key']).default('cert').optional().openapi({
          param: { name: 'kind', in: 'query' },
          example: 'cert',
        }),
      }),
    },
    responses: { ...commonErrorResponses, ...okFile('证书文件') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { kind = 'cert' } = c.req.valid('query');
    const download = await getSslCertificateDownload(id, kind);
    return fileBody(download.content, download.filename, download.contentType);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['SslCertificates'],
    summary: '删除 SSL 证书',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'system:ssl:delete', audit: { description: '删除 SSL 证书', module: 'SSL 证书' } }),
    ] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('证书已删除') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSslCertificateBeforeAudit(id));
    await deleteSslCertificate(id);
    return c.json(okBody(null, '证书已删除'), 200);
  },
});

router.openapiRoutes([listRoute, generateRoute, uploadRoute, detailRoute, downloadRoute, deleteRoute] as const);

export default router;
