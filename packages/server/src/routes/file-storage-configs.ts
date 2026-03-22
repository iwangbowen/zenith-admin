import { Hono } from 'hono';
import { asc, desc, eq, count } from 'drizzle-orm';
import { db } from '../db';
import { fileStorageConfigs, managedFiles } from '../db/schema';
import { createFileStorageConfigSchema, updateFileStorageConfigSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';

const fileStorageConfigsRouter = new Hono();
fileStorageConfigsRouter.use('*', authMiddleware);

function toFileStorageConfig(row: typeof fileStorageConfigs.$inferSelect) {
  return {
    ...row,
    basePath: row.basePath ?? undefined,
    localRootPath: row.localRootPath ?? undefined,
    ossRegion: row.ossRegion ?? undefined,
    ossEndpoint: row.ossEndpoint ?? undefined,
    ossBucket: row.ossBucket ?? undefined,
    ossAccessKeyId: row.ossAccessKeyId ?? undefined,
    ossAccessKeySecret: row.ossAccessKeySecret ?? undefined,
    remark: row.remark ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toStoragePayload(input: ReturnType<typeof createFileStorageConfigSchema.parse>) {
  const common = {
    name: input.name,
    provider: input.provider,
    status: input.status,
    isDefault: input.isDefault,
    basePath: input.basePath ?? null,
    remark: input.remark ?? null,
  };

  if (input.provider === 'local') {
    return {
      ...common,
      localRootPath: input.localRootPath ?? null,
      ossRegion: null,
      ossEndpoint: null,
      ossBucket: null,
      ossAccessKeyId: null,
      ossAccessKeySecret: null,
    };
  }

  return {
    ...common,
    localRootPath: null,
    ossRegion: input.ossRegion ?? null,
    ossEndpoint: input.ossEndpoint ?? null,
    ossBucket: input.ossBucket ?? null,
    ossAccessKeyId: input.ossAccessKeyId ?? null,
    ossAccessKeySecret: input.ossAccessKeySecret ?? null,
  };
}

async function clearDefaultFlag() {
  await db.update(fileStorageConfigs).set({ isDefault: false, updatedAt: new Date() });
}

fileStorageConfigsRouter.get('/', async (c) => {
  const list = await db.select().from(fileStorageConfigs).orderBy(desc(fileStorageConfigs.isDefault), asc(fileStorageConfigs.id));
  return c.json({ code: 0, message: 'ok', data: list.map(toFileStorageConfig) });
});

fileStorageConfigsRouter.get('/default', async (c) => {
  const [config] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.isDefault, true)).limit(1);
  return c.json({ code: 0, message: 'ok', data: config ? toFileStorageConfig(config) : null });
});

fileStorageConfigsRouter.post('/', async (c) => {
  const body = await c.req.json();
  const result = createFileStorageConfigSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const existingDefault = await db.select({ id: fileStorageConfigs.id }).from(fileStorageConfigs).where(eq(fileStorageConfigs.isDefault, true)).limit(1);
  const shouldBeDefault = result.data.isDefault || (existingDefault.length === 0 && result.data.status === 'active');
  if (shouldBeDefault) {
    await clearDefaultFlag();
  }

  const [created] = await db.insert(fileStorageConfigs).values({
    ...toStoragePayload({ ...result.data, isDefault: shouldBeDefault }),
  }).returning();

  return c.json({ code: 0, message: '创建成功', data: toFileStorageConfig(created) });
});

fileStorageConfigsRouter.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateFileStorageConfigSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const [current] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!current) return c.json({ code: 404, message: '文件配置不存在', data: null }, 404);
  if (current.isDefault && result.data.status === 'disabled') {
    return c.json({ code: 400, message: '默认文件服务不能被禁用，请先切换默认服务', data: null }, 400);
  }

  if (result.data.isDefault) {
    await clearDefaultFlag();
  }

  const [updated] = await db.update(fileStorageConfigs)
    .set({ ...toStoragePayload(result.data), updatedAt: new Date() })
    .where(eq(fileStorageConfigs.id, id))
    .returning();

  return c.json({ code: 0, message: '更新成功', data: toFileStorageConfig(updated) });
});

fileStorageConfigsRouter.put('/:id/default', async (c) => {
  const id = Number(c.req.param('id'));
  const [target] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!target) return c.json({ code: 404, message: '文件配置不存在', data: null }, 404);
  if (target.status !== 'active') {
    return c.json({ code: 400, message: '只有启用状态的文件配置才能设为默认', data: null }, 400);
  }

  await clearDefaultFlag();
  const [updated] = await db.update(fileStorageConfigs)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(fileStorageConfigs.id, id))
    .returning();

  return c.json({ code: 0, message: '默认文件服务已更新', data: toFileStorageConfig(updated) });
});

fileStorageConfigsRouter.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const [target] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!target) return c.json({ code: 404, message: '文件配置不存在', data: null }, 404);
  if (target.isDefault) {
    return c.json({ code: 400, message: '默认文件服务不能删除，请先切换默认服务', data: null }, 400);
  }

  const [{ valueCount }] = await db.select({ valueCount: count() }).from(managedFiles).where(eq(managedFiles.storageConfigId, id));
  if (Number(valueCount) > 0) {
    return c.json({ code: 400, message: '该文件配置下已有文件记录，不能删除', data: null }, 400);
  }

  await db.delete(fileStorageConfigs).where(eq(fileStorageConfigs.id, id));
  return c.json({ code: 0, message: '删除成功', data: null });
});

export default fileStorageConfigsRouter;
