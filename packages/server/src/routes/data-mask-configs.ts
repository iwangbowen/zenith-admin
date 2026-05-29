import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { jsonContent, validationHook, commonErrorResponses, ok, okMsg, IdParam, okBody } from '../lib/openapi-schemas';
import { DataMaskConfigDTO } from '../lib/openapi-dtos';
import { maskTypeValues } from '@zenith/shared';
import {
  listDataMaskConfigs,
  getDataMaskConfig,
  createDataMaskConfig,
  updateDataMaskConfig,
  deleteDataMaskConfig,
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
    request: {},
    responses: { ...commonErrorResponses, ...ok(z.array(DataMaskConfigDTO), '脱敏规则列表') },
  }),
  handler: async (c) => c.json(okBody(await listDataMaskConfigs()), 200),
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

dataMaskConfigsRouter.openapiRoutes([listRoute, getOneRoute, createRoute_, updateRoute, deleteRoute] as const);

export default dataMaskConfigsRouter;
