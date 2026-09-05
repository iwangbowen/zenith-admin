import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { uploadCertSchema } from '../../platform/validation';
import { SSL_CERT_DOWNLOAD_KINDS, SSL_CERT_STATUSES, SSL_CERT_TYPES } from '../constants';
import { generateSelfSignedCertSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const sslCertificateSchema = z.object({
  id: z.int(),
  name: z.string(),
  domain: z.string(),
  type: z.enum(SSL_CERT_TYPES),
  certPath: z.string().nullable(),
  keyPath: z.string().nullable(),
  issuer: z.string().nullable(),
  subject: z.string().nullable(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  fingerprint: z.string().nullable(),
  serialNumber: z.string().nullable(),
  status: z.enum(SSL_CERT_STATUSES),
  autoRenew: z.boolean(),
  daysRemaining: z.int().nullable().meta({ description: '距到期天数；无有效期信息为 null' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'SslCertificate' });

export type SslCertificate = z.infer<typeof sslCertificateSchema>;

export const sslCertificateCreatedSchema = z.object({ id: z.int() }).meta({ id: 'SslCertificateCreated' });

export type SslCertificateCreated = z.infer<typeof sslCertificateCreatedSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const sslCertificateListQuery = paginationQuery.extend({
  keyword: z.string().max(256).optional(),
  type: z.enum(SSL_CERT_TYPES).optional(),
});

export const sslCertificateDownloadQuery = z.object({
  kind: z.enum(SSL_CERT_DOWNLOAD_KINDS).default('cert').optional().meta({ description: '下载证书（cert）或私钥（key）', example: 'cert' }),
});

export const sslCertificateContract = defineContract('/api/ssl-certificates', {
  list: op.get('/', { query: sslCertificateListQuery, response: paginated(sslCertificateSchema), summary: 'SSL 证书列表' }),
  generate: op.post('/generate', { body: generateSelfSignedCertSchema, response: sslCertificateCreatedSchema, summary: '生成自签名证书' }),
  upload: op.post('/upload', { body: uploadCertSchema, response: sslCertificateCreatedSchema, summary: '上传自定义证书' }),
  detail: op.get('/{id}', { params: idParam, response: sslCertificateSchema, summary: 'SSL 证书详情' }),
  download: op.get('/{id}/download', { params: idParam, query: sslCertificateDownloadQuery, kind: 'file', summary: '下载 SSL 证书文件' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除 SSL 证书' }),
}, { tags: ['SslCertificates'] });
