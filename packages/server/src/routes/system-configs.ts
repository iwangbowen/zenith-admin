import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { getPasswordPolicy } from '../lib/password-policy';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, okExcel, excelStreamBody, okCsv, csvStreamBody } from '../lib/openapi-schemas';
import { SystemConfigDTO, PublicConfigDTO, PasswordPolicyDTO } from '../lib/openapi-dtos';
import {
  getPublicConfig,
  listSystemConfigs,
  createSystemConfig,
  updateSystemConfig,
  deleteSystemConfig,
  exportSystemConfigs, exportSystemConfigsAsCsv,
  getSystemConfigBeforeAudit,
  getSystemConfig,
} from '../services/system-configs.service';

const systemConfigsRoute = new OpenAPIHono({ defaultHook: validationHook });
const configTypeValues = ['string', 'number', 'boolean', 'json'] as const;

const createSystemConfigSchema = z.object({
  configKey: z.string().min(1).max(128).regex(/^[\w.]+$/),
  configValue: z.string().max(4096),
  configType: z.enum(configTypeValues).default('string'),
  description: z.string().max(256).default(''),
});
const updateSystemConfigSchema = createSystemConfigSchema.partial();

const publicGetRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/public/{key}', tags: ['SystemConfigs'], summary: '公开获取单项配置',
    request: { params: z.object({ key: z.string().openapi({ param: { name: 'key', in: 'path' }, example: 'site_name', description: '配置键' }) }) },
    responses: { ...commonErrorResponses, ...ok(PublicConfigDTO, '配置值') },
  }),
  handler: async (c) => c.json(okBody(await getPublicConfig(c.req.valid('param').key)), 200),
});

const passwordPolicyRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/password-policy', tags: ['SystemConfigs'], summary: '获取当前密码策略',
    responses: { ...commonErrorResponses, ...ok(PasswordPolicyDTO, '密码策略') },
  }),
  handler: async (c) => c.json(okBody(await getPasswordPolicy(), 'success'), 200),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['SystemConfigs'], summary: '配置分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), configType: z.enum(configTypeValues).optional(), keys: z.string().optional().openapi({ description: '按 configKey 精确批量查询，逗号分隔，传此参数时忽略分页' }) }) },
    responses: { ...commonErrorResponses, ...okPaginated(SystemConfigDTO, '配置列表') },
  }),
  handler: async (c) => c.json(okBody(await listSystemConfigs(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['SystemConfigs'], summary: '配置详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:config:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(SystemConfigDTO, '配置详情') },
  }),
  handler: async (c) => c.json(okBody(await getSystemConfig(c.req.valid('param').id)), 200),
});

const createConfigRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['SystemConfigs'], summary: '新增配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:config:create', audit: { module: '系统配置', description: '新增配置' } })] as const,
    request: { body: { content: jsonContent(createSystemConfigSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(SystemConfigDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createSystemConfig(c.req.valid('json')), '创建成功'), 200),
});

const updateConfigRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['SystemConfigs'], summary: '更新配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:config:update', audit: { module: '系统配置', description: '更新配置' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateSystemConfigSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(SystemConfigDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getSystemConfigBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateSystemConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['SystemConfigs'], summary: '删除配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:config:delete', audit: { module: '系统配置', description: '删除配置' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getSystemConfigBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteSystemConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['SystemConfigs'], summary: '导出系统配置 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:config:list' })] as const,
    responses: { ...commonErrorResponses, ...okExcel('Excel 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportSystemConfigs();
    return excelStreamBody(c, stream, filename);
  },
});

const exportCsvRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export/csv', tags: ['SystemConfigs'], summary: '导出系统配置 CSV',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:config:list' })] as const,
    responses: { ...commonErrorResponses, ...okCsv('CSV 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportSystemConfigsAsCsv();
    return csvStreamBody(c, stream, filename);
  },
});

systemConfigsRoute.openapiRoutes([publicGetRoute, passwordPolicyRoute, listRoute, getOneRoute, createConfigRoute, updateConfigRoute, deleteRouteDef, exportRoute, exportCsvRoute] as const);

export default systemConfigsRoute;
