import { OpenAPIHono } from '@hono/zod-openapi';
import { sslCertificateContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { fileBody, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  deleteSslCertificate,
  generateSelfSignedCert,
  getSslCertificate,
  getSslCertificateBeforeAudit,
  getSslCertificateDownload,
  listSslCertificates,
  uploadCert,
} from '../../services/ops/ssl-certificates.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const view = [authMiddleware, guard({ permission: 'system:ssl:view' })] as const;

const listRoute = defineContractRoute(sslCertificateContract.list, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listSslCertificates(c.req.valid('query'))), 200),
});

const generateRoute = defineContractRoute(sslCertificateContract.generate, {
  middleware: [
    authMiddleware,
    guard({
      permission: 'system:ssl:create',
      audit: { description: '生成 SSL 证书', module: 'SSL 证书', recordBody: false },
    }),
  ],
  handler: async (c) => c.json(okBody(await generateSelfSignedCert(c.req.valid('json')), '证书已生成'), 200),
});

const uploadRoute = defineContractRoute(sslCertificateContract.upload, {
  middleware: [
    authMiddleware,
    guard({
      permission: 'system:ssl:create',
      audit: { description: '上传 SSL 证书', module: 'SSL 证书', recordBody: false },
    }),
  ],
  handler: async (c) => c.json(okBody(await uploadCert(c.req.valid('json')), '证书已上传'), 200),
});

const detailRoute = defineContractRoute(sslCertificateContract.detail, {
  middleware: view,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getSslCertificate(id)), 200);
  },
});

const downloadRoute = defineContractRoute(sslCertificateContract.download, {
  middleware: view,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { kind = 'cert' } = c.req.valid('query');
    const download = await getSslCertificateDownload(id, kind);
    return fileBody(download.content, download.filename, download.contentType);
  },
});

const deleteRoute = defineContractRoute(sslCertificateContract.remove, {
  middleware: [
    authMiddleware,
    guard({ permission: 'system:ssl:delete', audit: { description: '删除 SSL 证书', module: 'SSL 证书' } }),
  ],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSslCertificateBeforeAudit(id));
    await deleteSslCertificate(id);
    return c.json(okBody(null, '证书已删除'), 200);
  },
});

router.openapiRoutes([listRoute, generateRoute, uploadRoute, detailRoute, downloadRoute, deleteRoute] as const);

export default router;
