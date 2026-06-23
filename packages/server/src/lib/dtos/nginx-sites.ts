import { z } from '@hono/zod-openapi';

export const NginxInfoDTO = z.object({
  installed: z.boolean(),
  version: z.string().nullable(),
  configPath: z.string().nullable(),
  sitesAvailable: z.string().nullable(),
  sitesEnabled: z.string().nullable(),
  runningStatus: z.enum(['running', 'stopped', 'unknown']),
}).openapi('NginxInfo');

export const NginxSiteDTO = z.object({
  name: z.string(),
  enabled: z.boolean(),
  configPath: z.string(),
  serverName: z.string().nullable(),
  listenPort: z.number().nullable(),
  root: z.string().nullable(),
  sslEnabled: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).openapi('NginxSite');

export const NginxSiteDetailDTO = NginxSiteDTO.extend({
  content: z.string(),
}).openapi('NginxSiteDetail');

export const CreateNginxSiteDTO = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/, '站点名只能包含字母、数字、点、横线和下划线'),
  serverName: z.string().min(1).max(200),
  listenPort: z.number().int().min(1).max(65535).default(80),
  root: z.string().max(500).optional(),
  proxyPass: z.string().max(500).optional(),
  sslEnabled: z.boolean().default(false),
  sslCertPath: z.string().max(500).optional(),
  sslKeyPath: z.string().max(500).optional(),
  extraConfig: z.string().max(10000).optional(),
}).openapi('CreateNginxSite');

export const UpdateNginxSiteContentDTO = z.object({
  content: z.string().max(100000),
}).openapi('UpdateNginxSiteContent');

export const NginxTestResultDTO = z.object({
  success: z.boolean(),
  output: z.string(),
}).openapi('NginxTestResult');
