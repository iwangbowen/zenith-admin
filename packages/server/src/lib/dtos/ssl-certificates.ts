import { z } from '@hono/zod-openapi';

export const SslCertificateDTO = z.object({
  id: z.number().int(),
  name: z.string(),
  domain: z.string(),
  type: z.enum(['self_signed', 'uploaded', 'letsencrypt']),
  certPath: z.string().nullable(),
  keyPath: z.string().nullable(),
  issuer: z.string().nullable(),
  subject: z.string().nullable(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  fingerprint: z.string().nullable(),
  serialNumber: z.string().nullable(),
  status: z.enum(['valid', 'expiring', 'expired', 'invalid']),
  autoRenew: z.boolean(),
  daysRemaining: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi('SslCertificate');

export const GenerateSelfSignedCertRequestDTO = z.object({
  name: z.string().min(1).max(128),
  domain: z.string().min(1).max(256),
  days: z.number().int().min(1).max(3650).default(365),
  country: z.string().length(2).default('CN').optional(),
  organization: z.string().max(64).optional(),
  outputDir: z.string().max(500).optional(),
}).openapi('GenerateSelfSignedCertRequest');

export const UploadCertRequestDTO = z.object({
  name: z.string().min(1).max(128),
  domain: z.string().min(1).max(256),
  certContent: z.string().min(1),
  keyContent: z.string().min(1),
}).openapi('UploadCertRequest');
