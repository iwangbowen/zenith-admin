import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { asc, desc, eq, count, and, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { fileStorageConfigs, managedFiles } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { createFileStorageConfigSchema as _createSchema, updateFileStorageConfigSchema as _updateSchema } from '@zenith/shared';
import { apiResponse, ErrorResponse, MessageResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';

const fileStorageConfigsRouter = new OpenAPIHono({ defaultHook: validationHook });
fileStorageConfigsRouter.use('*', authMiddleware);

const FileStorageConfigDTO = z.looseObject({}).openapi('FileStorageConfig');

const createFileStorageConfigSchema = _createSchema;
const updateFileStorageConfigSchema = _updateSchema;

type StorageInput = z.infer<typeof createFileStorageConfigSchema>;

function toFileStorageConfig(row: typeof fileStorageConfigs.$inferSelect) {
  return {
    ...row,
    basePath: row.basePath ?? null,
    localRootPath: row.localRootPath ?? null,
    ossRegion: row.ossRegion ?? null,
    ossEndpoint: row.ossEndpoint ?? null,
    ossBucket: row.ossBucket ?? null,
    ossAccessKeyId: row.ossAccessKeyId ?? null,
    ossAccessKeySecret: row.ossAccessKeySecret ?? null,
    s3Region: row.s3Region ?? null,
    s3Endpoint: row.s3Endpoint ?? null,
    s3Bucket: row.s3Bucket ?? null,
    s3AccessKeyId: row.s3AccessKeyId ?? null,
    s3SecretAccessKey: row.s3SecretAccessKey ?? null,
    s3ForcePathStyle: row.s3ForcePathStyle ?? null,
    cosRegion: row.cosRegion ?? null,
    cosBucket: row.cosBucket ?? null,
    cosSecretId: row.cosSecretId ?? null,
    cosSecretKey: row.cosSecretKey ?? null,
    remark: row.remark ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toStoragePayload(input: StorageInput) {
  const common = {
    name: input.name,
    provider: input.provider,
    status: input.status,
    isDefault: input.isDefault,
    basePath: input.basePath ?? null,
    remark: input.remark ?? null,
  };
  const nullS3 = { s3Region: null, s3Endpoint: null, s3Bucket: null, s3AccessKeyId: null, s3SecretAccessKey: null, s3ForcePathStyle: null };
  const nullCos = { cosRegion: null, cosBucket: null, cosSecretId: null, cosSecretKey: null };
  const nullOss = { ossRegion: null, ossEndpoint: null, ossBucket: null, ossAccessKeyId: null, ossAccessKeySecret: null };

  if (input.provider === 'local') {
    return { ...common, localRootPath: input.localRootPath ?? null, ...nullOss, ...nullS3, ...nullCos };
  }
  if (input.provider === 'oss') {
    return { ...common, localRootPath: null,
      ossRegion: input.ossRegion ?? null, ossEndpoint: input.ossEndpoint ?? null,
      ossBucket: input.ossBucket ?? null, ossAccessKeyId: input.ossAccessKeyId ?? null,
      ossAccessKeySecret: input.ossAccessKeySecret ?? null, ...nullS3, ...nullCos };
  }
  if (input.provider === 's3') {
    return { ...common, localRootPath: null, ...nullOss,
      s3Region: input.s3Region ?? null, s3Endpoint: input.s3Endpoint ?? null,
      s3Bucket: input.s3Bucket ?? null, s3AccessKeyId: input.s3AccessKeyId ?? null,
      s3SecretAccessKey: input.s3SecretAccessKey ?? null, s3ForcePathStyle: input.s3ForcePathStyle ?? null,
      ...nullCos };
  }
  return { ...common, localRootPath: null, ...nullOss, ...nullS3,
    cosRegion: input.cosRegion ?? null, cosBucket: input.cosBucket ?? null,
    cosSecretId: input.cosSecretId ?? null, cosSecretKey: input.cosSecretKey ?? null };
}

async function clearDefaultFlag() {
  await db.update(fileStorageConfigs).set({ isDefault: false, updatedAt: new Date() });
}

// GET /
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['FileStorageConfigs'],
  summary: '存储配置列表',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:file:config' })] as const,
  request: { query: z.object({ status: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(z.array(FileStorageConfigDTO))), description: 'ok' },
  },
});
fileStorageConfigsRouter.openapi(listRoute, async (c) => {
  const { status, startTime, endTime } = c.req.valid('query');
  const conditions = [];
  if (status === 'active' || status === 'disabled') conditions.push(eq(fileStorageConfigs.status, status));
  if (startTime) conditions.push(gte(fileStorageConfigs.updatedAt, new Date(startTime)));
  if (endTime) conditions.push(lte(fileStorageConfigs.updatedAt, new Date(endTime)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const list = await db.select().from(fileStorageConfigs).where(where).orderBy(desc(fileStorageConfigs.isDefault), asc(fileStorageConfigs.id));
  return c.json({ code: 0 as const, message: 'ok', data: list.map(toFileStorageConfig) }, 200);
});

// GET /default
const defaultRoute = createRoute({
  method: 'get',
  path: '/default',
  tags: ['FileStorageConfigs'],
  summary: '默认配置',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:file:config' })] as const,
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(FileStorageConfigDTO.nullable())), description: 'ok' },
  },
});
fileStorageConfigsRouter.openapi(defaultRoute, async (c) => {
  const [config] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.isDefault, true)).limit(1);
  return c.json({ code: 0 as const, message: 'ok', data: config ? toFileStorageConfig(config) : null }, 200);
});

// POST /
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['FileStorageConfigs'],
  summary: '创建配置',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:file:config:create', audit: { description: '创建文件存储配置', module: '文件存储配置' } })] as const,
  request: { body: { content: jsonContent(createFileStorageConfigSchema), required: true } },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(FileStorageConfigDTO)), description: '创建成功' },
  },
});
fileStorageConfigsRouter.openapi(createRouteDef, async (c) => {
  const data = c.req.valid('json');
  const existingDefault = await db.select({ id: fileStorageConfigs.id }).from(fileStorageConfigs).where(eq(fileStorageConfigs.isDefault, true)).limit(1);
  const shouldBeDefault = data.isDefault || (existingDefault.length === 0 && data.status === 'active');
  if (shouldBeDefault) await clearDefaultFlag();
  const [created] = await db.insert(fileStorageConfigs).values({ ...toStoragePayload({ ...data, isDefault: shouldBeDefault }) }).returning();
  return c.json({ code: 0 as const, message: '创建成功', data: toFileStorageConfig(created) }, 200);
});

// PUT /{id}
const updateRouteDef = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['FileStorageConfigs'],
  summary: '更新配置',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:file:config:update', audit: { description: '更新文件存储配置', module: '文件存储配置' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }), body: { content: jsonContent(updateFileStorageConfigSchema), required: true } },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(FileStorageConfigDTO)), description: '更新成功' },
    400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
fileStorageConfigsRouter.openapi(updateRouteDef, async (c) => {
  const { id } = c.req.valid('param');
  const data = c.req.valid('json');
  const [current] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!current) return c.json({ code: 404, message: '文件配置不存在', data: null }, 404);
  if (current.isDefault && data.status === 'disabled') return c.json({ code: 400, message: '默认文件服务不能被禁用，请先切换默认服务', data: null }, 400);
  if (data.isDefault) await clearDefaultFlag();
  const [updated] = await db.update(fileStorageConfigs)
    .set({ ...toStoragePayload(data as StorageInput), updatedAt: new Date() })
    .where(eq(fileStorageConfigs.id, id))
    .returning();
  return c.json({ code: 0 as const, message: '更新成功', data: toFileStorageConfig(updated) }, 200);
});

// PUT /{id}/default
const setDefaultRoute = createRoute({
  method: 'put',
  path: '/{id}/default',
  tags: ['FileStorageConfigs'],
  summary: '设为默认',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:file:config:default', audit: { description: '设置默认文件存储', module: '文件存储配置', recordBody: false } })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(FileStorageConfigDTO)), description: 'ok' },
    400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
fileStorageConfigsRouter.openapi(setDefaultRoute, async (c) => {
  const { id } = c.req.valid('param');
  const [target] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!target) return c.json({ code: 404, message: '文件配置不存在', data: null }, 404);
  if (target.status !== 'active') return c.json({ code: 400, message: '只有启用状态的文件配置才能设为默认', data: null }, 400);
  await clearDefaultFlag();
  const [updated] = await db.update(fileStorageConfigs).set({ isDefault: true, updatedAt: new Date() }).where(eq(fileStorageConfigs.id, id)).returning();
  return c.json({ code: 0 as const, message: '默认文件服务已更新', data: toFileStorageConfig(updated) }, 200);
});

// DELETE /{id}
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['FileStorageConfigs'],
  summary: '删除配置',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:file:config:delete', audit: { description: '删除文件存储配置', module: '文件存储配置' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(MessageResponse), description: '删除成功' },
    400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
fileStorageConfigsRouter.openapi(deleteRouteDef, async (c) => {
  const { id } = c.req.valid('param');
  const [target] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!target) return c.json({ code: 404, message: '文件配置不存在', data: null }, 404);
  if (target.isDefault) return c.json({ code: 400, message: '默认文件服务不能删除，请先切换默认服务', data: null }, 400);
  const [{ valueCount }] = await db.select({ valueCount: count() }).from(managedFiles).where(eq(managedFiles.storageConfigId, id));
  if (Number(valueCount) > 0) return c.json({ code: 400, message: '该文件配置下已有文件记录，不能删除', data: null }, 400);
  await db.delete(fileStorageConfigs).where(eq(fileStorageConfigs.id, id));
  return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
});

export default fileStorageConfigsRouter;
