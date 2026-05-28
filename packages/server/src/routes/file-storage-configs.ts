import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { createFileStorageConfigSchema, updateFileStorageConfigSchema } from '@zenith/shared';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody } from '../lib/openapi-schemas';
import { FileStorageConfigDTO } from '../lib/openapi-dtos';
import {
  listFileStorageConfigs,
  getDefaultFileStorageConfig,
  createFileStorageConfig,
  updateFileStorageConfig,
  setDefaultFileStorageConfig,
  deleteFileStorageConfig,
  getFileStorageConfigBeforeAudit,
  getFileStorageConfig,
} from '../services/file-storage-configs.service';

const fileStorageConfigsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['FileStorageConfigs'], summary: '存储配置列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:config' })] as const,
    request: { query: PaginationQuery.extend({ status: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(FileStorageConfigDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listFileStorageConfigs(c.req.valid('query'))), 200),
});

const defaultRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/default', tags: ['FileStorageConfigs'], summary: '默认配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:config' })] as const,
    responses: { ...commonErrorResponses, ...ok(FileStorageConfigDTO.nullable(), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getDefaultFileStorageConfig()), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['FileStorageConfigs'], summary: '存储配置详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:config' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(FileStorageConfigDTO, '存储配置详情') },
  }),
  handler: async (c) => c.json(okBody(await getFileStorageConfig(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['FileStorageConfigs'], summary: '创建配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:config:create', audit: { description: '创建文件存储配置', module: '文件存储配置' } })] as const,
    request: { body: { content: jsonContent(createFileStorageConfigSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(FileStorageConfigDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createFileStorageConfig(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['FileStorageConfigs'], summary: '更新配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:config:update', audit: { description: '更新文件存储配置', module: '文件存储配置' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateFileStorageConfigSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(FileStorageConfigDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getFileStorageConfigBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateFileStorageConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const setDefaultRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/default', tags: ['FileStorageConfigs'], summary: '设为默认',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:config:default', audit: { description: '设置默认文件存储', module: '文件存储配置', recordBody: false } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(FileStorageConfigDTO, 'ok') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getFileStorageConfigBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await setDefaultFileStorageConfig(id), '默认文件服务已更新'), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['FileStorageConfigs'], summary: '删除配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:config:delete', audit: { description: '删除文件存储配置', module: '文件存储配置' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getFileStorageConfigBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteFileStorageConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

fileStorageConfigsRouter.openapiRoutes([listRoute, defaultRoute, getOneRoute, createRouteDef, updateRouteDef, setDefaultRoute, deleteRouteDef] as const);

export default fileStorageConfigsRouter;
