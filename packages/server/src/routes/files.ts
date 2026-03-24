import { Hono } from 'hono';
import { and, desc, eq, like, or, sql, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { fileStorageConfigs, managedFiles } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { auditLog } from '../middleware/audit';
import { buildManagedFileUrl, deleteStoredFile, readStoredFile, uploadFileByConfig } from '../lib/file-storage';

const filesRouter = new Hono();
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
    mimeType: row.mimeType ?? undefined,
    extension: row.extension ?? undefined,
    url: buildManagedFileUrl(row.id),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

filesRouter.get('/', requirePermission('system:file:list'), async (c) => {
  const keyword = c.req.query('keyword') ?? '';
  const provider = c.req.query('provider');
  const page = Number(c.req.query('page') ?? 1);
  const pageSize = Number(c.req.query('pageSize') ?? 10);
  const startTime = c.req.query('startTime');
  const endTime = c.req.query('endTime');

  const conditions = [];
  if (keyword) {
    conditions.push(
      or(
        like(managedFiles.originalName, `%${keyword}%`),
        like(managedFiles.objectKey, `%${keyword}%`),
        like(managedFiles.storageName, `%${keyword}%`),
      ),
    );
  }
  if (provider && (provider === 'local' || provider === 'oss')) {
    conditions.push(eq(managedFiles.provider, provider));
  }
  if (startTime) {
    conditions.push(gte(managedFiles.createdAt, new Date(startTime)));
  }
  if (endTime) {
    conditions.push(lte(managedFiles.createdAt, new Date(endTime)));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(managedFiles)
    .where(where);

  const paginated = await db
    .select()
    .from(managedFiles)
    .where(where)
    .orderBy(desc(managedFiles.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: paginated.map(toManagedFile),
      total: count,
      page,
      pageSize,
    },
  });
});

filesRouter.post('/upload', requirePermission('system:file:upload'), auditLog({ description: '上传文件', module: '文件管理', recordBody: false }), async (c) => {
  const body = await c.req.parseBody();
  const rawFile = Array.isArray(body.file) ? body.file[0] : body.file;
  if (!isUploadFile(rawFile)) {
    return c.json({ code: 400, message: '请选择要上传的文件', data: null }, 400);
  }

  const [defaultConfig] = await db.select().from(fileStorageConfigs)
    .where(and(eq(fileStorageConfigs.isDefault, true), eq(fileStorageConfigs.status, 'active')))
    .limit(1);

  if (!defaultConfig) {
    return c.json({ code: 400, message: '当前没有可用的默认文件服务，请先在文件配置中启用并设置默认服务', data: null }, 400);
  }

  const uploaded = await uploadFileByConfig(defaultConfig, rawFile);
  const [created] = await db.insert(managedFiles).values({
    storageConfigId: defaultConfig.id,
    storageName: defaultConfig.name,
    provider: defaultConfig.provider,
    originalName: rawFile.name,
    objectKey: uploaded.objectKey,
    size: uploaded.size,
    mimeType: uploaded.mimeType,
    extension: uploaded.extension,
  }).returning();

  return c.json({ code: 0, message: '上传成功', data: toManagedFile(created) });
});

filesRouter.get('/:id/content', async (c) => {
  const id = Number(c.req.param('id'));
  const [file] = await db.select().from(managedFiles).where(eq(managedFiles.id, id)).limit(1);
  if (!file) return c.json({ code: 404, message: '文件不存在', data: null }, 404);

  const [storageConfig] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, file.storageConfigId)).limit(1);
  if (!storageConfig) return c.json({ code: 404, message: '文件存储配置不存在', data: null }, 404);

  const storedFile = await readStoredFile(file, storageConfig);
  return new Response(new Uint8Array(storedFile.buffer), {
    headers: {
      'Content-Type': storedFile.contentType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(storedFile.fileName)}`,
    },
  });
});

filesRouter.delete('/:id', requirePermission('system:file:delete'), auditLog({ description: '删除文件', module: '文件管理', recordBody: false }), async (c) => {
  const id = Number(c.req.param('id'));
  const [file] = await db.select().from(managedFiles).where(eq(managedFiles.id, id)).limit(1);
  if (!file) return c.json({ code: 404, message: '文件不存在', data: null }, 404);

  const [storageConfig] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, file.storageConfigId)).limit(1);
  if (storageConfig) {
    await deleteStoredFile(file, storageConfig);
  }

  await db.delete(managedFiles).where(eq(managedFiles.id, id));
  return c.json({ code: 0, message: '删除成功', data: null });
});

export default filesRouter;
