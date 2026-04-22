import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { and, desc, eq, like, or, sql, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { fileStorageConfigs, managedFiles } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { buildManagedFileUrl, deleteStoredFile, readStoredFile, uploadFileByConfig } from '../lib/file-storage';
import { exportToExcel } from '../lib/excel-export';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { apiResponse, ErrorResponse, MessageResponse, paginatedResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';

const filesRouter = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook });

// ─── Public file content endpoint (no auth) ───────────────────────────────
const contentRoute = createRoute({
  method: 'get',
  path: '/{id}/content',
  tags: ['Files'],
  summary: '公开访问文件内容',
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: { 'application/octet-stream': { schema: z.string() } }, description: '文件内容' },
    404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
  },
});

filesRouter.openapi(contentRoute, async (c) => {
  const { id } = c.req.valid('param');
  const [file] = await db.select().from(managedFiles).where(eq(managedFiles.id, id)).limit(1);
  if (!file) return c.json({ code: 404, message: '文件不存在', data: null }, 404);

  const [storageConfig] = await db
    .select()
    .from(fileStorageConfigs)
    .where(eq(fileStorageConfigs.id, file.storageConfigId))
    .limit(1);
  if (!storageConfig) return c.json({ code: 404, message: '文件存储配置不存在', data: null }, 404);

  const storedFile = await readStoredFile(file, storageConfig);
  return new Response(new Uint8Array(storedFile.buffer), {
    headers: {
      'Content-Type': storedFile.contentType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(storedFile.fileName)}`,
    },
  }) as never;
});

// ─── Authenticated routes ─────────────────────────────────────────────────
filesRouter.use('*', authMiddleware);

function isUploadFile(value: unknown): value is File {
  return !!value && typeof (value as File).arrayBuffer === 'function' && typeof (value as File).name === 'string';
}

function toManagedFile(row: typeof managedFiles.$inferSelect) {
  return {
    id: row.id,
    storageConfigId: row.storageConfigId,
    storageName: row.storageName,
    provider: row.provider,
    originalName: row.originalName,
    objectKey: row.objectKey,
    size: row.size,
    mimeType: row.mimeType ?? null,
    extension: row.extension ?? null,
    url: buildManagedFileUrl(row.id),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const ManagedFileDTO = z.looseObject({}).openapi('ManagedFile');

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Files'],
  summary: '文件分页列表',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:file:list' })] as const,
  request: {
    query: z.object({
      keyword: z.string().optional(),
      provider: z.enum(['local', 'oss']).optional(),
      page: z.coerce.number().optional(),
      pageSize: z.coerce.number().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    }),
  },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(paginatedResponse(ManagedFileDTO)), description: '文件列表' },
  },
});

filesRouter.openapi(listRoute, async (c) => {
  const q = c.req.valid('query');
  const page = Number(q.page ?? 1);
  const pageSize = Number(q.pageSize ?? 10);

  const conditions = [];
  if (q.keyword) {
    conditions.push(
      or(
        like(managedFiles.originalName, `%${q.keyword}%`),
        like(managedFiles.objectKey, `%${q.keyword}%`),
        like(managedFiles.storageName, `%${q.keyword}%`),
      ),
    );
  }
  if (q.provider) conditions.push(eq(managedFiles.provider, q.provider));
  if (q.startTime) conditions.push(gte(managedFiles.createdAt, new Date(q.startTime)));
  if (q.endTime) conditions.push(lte(managedFiles.createdAt, new Date(q.endTime)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const user = c.get('user');
  const tc = tenantCondition(managedFiles, user);
  const finalWhere = where && tc ? and(where, tc) : (tc ?? where);

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(managedFiles)
    .where(finalWhere);

  const paginated = await db
    .select()
    .from(managedFiles)
    .where(finalWhere)
    .orderBy(desc(managedFiles.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json(
    { code: 0 as const, message: 'ok', data: { list: paginated.map(toManagedFile), total: count, page, pageSize } },
    200,
  );
});

const uploadRoute = createRoute({
  method: 'post',
  path: '/upload',
  tags: ['Files'],
  summary: '上传文件',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:file:upload', audit: { description: '上传文件', module: '文件管理', recordBody: false } })] as const,
  request: {
    body: {
      content: { 'multipart/form-data': { schema: z.object({ file: z.string() }) } },
      required: true,
    },
  },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(ManagedFileDTO)), description: '上传成功' },
    400: { content: jsonContent(ErrorResponse), description: '未选择文件或无可用存储' },
  },
});

filesRouter.openapi(uploadRoute, async (c) => {
  const body = await c.req.parseBody();
  const rawFile = Array.isArray(body.file) ? body.file[0] : body.file;
  if (!isUploadFile(rawFile)) {
    return c.json({ code: 400, message: '请选择要上传的文件', data: null }, 400);
  }

  const [defaultConfig] = await db
    .select()
    .from(fileStorageConfigs)
    .where(and(eq(fileStorageConfigs.isDefault, true), eq(fileStorageConfigs.status, 'active')))
    .limit(1);

  if (!defaultConfig) {
    return c.json(
      { code: 400, message: '当前没有可用的默认文件服务，请先在文件配置中启用并设置默认服务', data: null },
      400,
    );
  }

  const uploaded = await uploadFileByConfig(defaultConfig, rawFile);
  const [created] = await db
    .insert(managedFiles)
    .values({
      storageConfigId: defaultConfig.id,
      storageName: defaultConfig.name,
      provider: defaultConfig.provider,
      originalName: rawFile.name,
      objectKey: uploaded.objectKey,
      size: uploaded.size,
      mimeType: uploaded.mimeType,
      extension: uploaded.extension,
      tenantId: getCreateTenantId(c.get('user')),
    })
    .returning();

  return c.json({ code: 0 as const, message: '上传成功', data: toManagedFile(created) }, 200);
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Files'],
  summary: '删除文件',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:file:delete', audit: { description: '删除文件', module: '文件管理', recordBody: false } })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(MessageResponse), description: '删除成功' },
    404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
  },
});

filesRouter.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');
  const [file] = await db.select().from(managedFiles).where(eq(managedFiles.id, id)).limit(1);
  if (!file) return c.json({ code: 404, message: '文件不存在', data: null }, 404);

  const [storageConfig] = await db
    .select()
    .from(fileStorageConfigs)
    .where(eq(fileStorageConfigs.id, file.storageConfigId))
    .limit(1);
  if (storageConfig) {
    await deleteStoredFile(file, storageConfig);
  }

  await db.delete(managedFiles).where(and(eq(managedFiles.id, id), tenantCondition(managedFiles, c.get('user'))));
  return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
});

const exportRoute = createRoute({
  method: 'get',
  path: '/export',
  tags: ['Files'],
  summary: '导出文件列表 Excel',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:file:list' })] as const,
  responses: {
    ...commonErrorResponses,
    200: {
      content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.string() } },
      description: 'Excel 文件',
    },
  },
});

filesRouter.openapi(exportRoute, async (c) => {
  const rows = await db
    .select()
    .from(managedFiles)
    .where(tenantCondition(managedFiles, c.get('user')))
    .orderBy(desc(managedFiles.id));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '文件名', key: 'originalName', width: 28 },
      { header: '类型', key: 'mimeType', width: 18 },
      { header: '大小(bytes)', key: 'size', width: 14 },
      { header: '存储方式', key: 'storageProvider', width: 12 },
      { header: '上传时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    '文件列表',
  );
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=files.xlsx');
  return c.body(buffer) as never;
});

export default filesRouter;
