import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { jsonContent, validationHook, commonErrorResponses, ok, okMsg, okPaginated, IdParam, okBody, PaginationQuery } from '../lib/openapi-schemas';
import { DataMaskConfigDTO, SensitiveFieldDTO } from '../lib/openapi-dtos';
import { maskTypeValues } from '@zenith/shared';
import {
  listDataMaskConfigs,
  getDataMaskConfig,
  createDataMaskConfig,
  updateDataMaskConfig,
  deleteDataMaskConfig,
  scanSensitiveFields,
  batchCreateDataMaskConfigs,
} from '../services/data-mask.service';

const dataMaskConfigsRouter = new OpenAPIHono({ defaultHook: validationHook });

const customMaskRuleSchema = z.object({
  prefixKeep: z.number().int().min(0).max(20),
  suffixKeep: z.number().int().min(0).max(20),
  maskChar: z.string().max(1).optional(),
}).optional().nullable();

const createDataMaskConfigSchema = z.object({
  entity:          z.string().min(1).max(64),
  field:           z.string().min(1).max(64),
  label:           z.string().min(1).max(64),
  maskType:        z.enum(maskTypeValues),
  customRule:      customMaskRuleSchema,
  exemptRoleCodes: z.array(z.string()).default([]),
  enabled:         z.boolean().default(true),
  remark:          z.string().max(256).optional(),
});

const updateDataMaskConfigSchema = createDataMaskConfigSchema.partial();

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['DataMaskConfigs'], summary: '数据脱敏规则列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:data-mask:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), maskType: z.enum(maskTypeValues).optional(), enabled: z.enum(['true', 'false']).optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(DataMaskConfigDTO, '脉敏规则列表') },
  }),
  handler: async (c) => c.json(okBody(await listDataMaskConfigs(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['DataMaskConfigs'], summary: '获取脱敏规则详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:data-mask:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(DataMaskConfigDTO, '脱敏规则详情') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getDataMaskConfig(id)), 200);
  },
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['DataMaskConfigs'], summary: '创建脱敏规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:data-mask:create', audit: { description: '创建脱敏规则', module: '数据脱敏配置' } })] as const,
    request: { body: { content: jsonContent(createDataMaskConfigSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DataMaskConfigDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createDataMaskConfig(c.req.valid('json'))), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['DataMaskConfigs'], summary: '更新脱敏规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:data-mask:update', audit: { description: '更新脱敏规则', module: '数据脱敏配置' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(updateDataMaskConfigSchema), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(DataMaskConfigDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await updateDataMaskConfig(id, body)), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['DataMaskConfigs'], summary: '删除脱敏规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:data-mask:delete', audit: { description: '删除脱敏规则', module: '数据脱敏配置' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteDataMaskConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const scanRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/scan', tags: ['DataMaskConfigs'], summary: '扫描数据库敏感字段',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:data-mask:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(SensitiveFieldDTO), '扫描结果') },
  }),
  handler: async (c) => c.json(okBody(await scanSensitiveFields()), 200),
});

const batchCreateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/batch-create', tags: ['DataMaskConfigs'], summary: '批量创建脱敏规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:data-mask:create', audit: { description: '批量创建脱敏规则', module: '数据脱敏配置' } })] as const,
    request: {
      body: {
        content: jsonContent(z.object({
          items: z.array(z.object({
            entity:          z.string().min(1).max(64),
            field:           z.string().min(1).max(64),
            label:           z.string().min(1).max(64),
            maskType:        z.enum(maskTypeValues),
            exemptRoleCodes: z.array(z.string()).default([]),
            enabled:         z.boolean().default(true),
          })).min(1),
        })),
        required: true,
      },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(z.object({ created: z.number(), skipped: z.number() }).openapi('BatchCreateResult'), '批量创建结果'),
    },
  }),
  handler: async (c) => {
    const { items } = c.req.valid('json');
    const result = await batchCreateDataMaskConfigs(items);
    return c.json(okBody(result, `已创建 ${result.created} 条，跳过 ${result.skipped} 条`), 200);
  },
});

dataMaskConfigsRouter.openapiRoutes([listRoute, scanRoute, batchCreateRoute, getOneRoute, createRoute_, updateRoute, deleteRoute] as const);

export default dataMaskConfigsRouter;
