import { Hono } from 'hono';
import { eq, like, and, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import { systemConfigs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { createSystemConfigSchema, updateSystemConfigSchema } from '@zenith/shared';
import { exportToExcel } from '../lib/excel-export';
import { getPasswordPolicy } from '../lib/password-policy';

const systemConfigsRoute = new Hono();
const configTypeValues = ['string', 'number', 'boolean', 'json'] as const;

// Public endpoint: get a config value by key (used before login, e.g., captcha_enabled)
systemConfigsRoute.get('/public/:key', async (c) => {
  const key = c.req.param('key');
  const [row] = await db.select().from(systemConfigs).where(eq(systemConfigs.configKey, key)).limit(1);
  if (!row) {
    return c.json({ code: 404, message: '配置不存在', data: null }, 404);
  }
  return c.json({
    code: 0,
    message: 'ok',
    data: { configKey: row.configKey, configValue: row.configValue, configType: row.configType },
  });
});

// Public endpoint: get current password policy (used in frontend forms)
systemConfigsRoute.get('/password-policy', async (c) => {
  const policy = await getPasswordPolicy();
  return c.json({ code: 0, message: 'success', data: policy });
});

// Protected routes
systemConfigsRoute.use('/*', authMiddleware);

systemConfigsRoute.get('/', guard({ permission: 'system:config:list' }), async (c) => {
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const keyword = c.req.query('keyword');
  const configType = c.req.query('configType');

  const conditions = [];
  if (keyword) {
    conditions.push(like(systemConfigs.configKey, `%${keyword}%`));
  }
  if (configType && configTypeValues.includes(configType as typeof configTypeValues[number])) {
    conditions.push(eq(systemConfigs.configType, configType as typeof configTypeValues[number]));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(systemConfigs)
    .where(where);

  const rows = await db
    .select()
    .from(systemConfigs)
    .where(where)
    .orderBy(desc(systemConfigs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      total: count,
      page,
      pageSize,
    },
  });
});

systemConfigsRoute.post('/', guard({ permission: 'system:config:create', audit: { module: '系统配置', description: '新增配置' } }), async (c) => {
  const body = await c.req.json();
  const result = createSystemConfigSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const [existing] = await db.select().from(systemConfigs).where(eq(systemConfigs.configKey, result.data.configKey)).limit(1);
  if (existing) {
    return c.json({ code: 400, message: '配置键已存在', data: null }, 400);
  }

  const [row] = await db.insert(systemConfigs).values(result.data).returning();
  return c.json({ code: 0, message: '创建成功', data: { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() } });
});

systemConfigsRoute.put('/:id', guard({ permission: 'system:config:update', audit: { module: '系统配置', description: '更新配置' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateSystemConfigSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  if (result.data.configKey) {
    const [dup] = await db.select().from(systemConfigs)
      .where(and(eq(systemConfigs.configKey, result.data.configKey), sql`${systemConfigs.id} != ${id}`))
      .limit(1);
    if (dup) {
      return c.json({ code: 400, message: '配置键已存在', data: null }, 400);
    }
  }

  const [row] = await db.update(systemConfigs)
    .set({ ...result.data, updatedAt: new Date() })
    .where(eq(systemConfigs.id, id))
    .returning();

  if (!row) {
    return c.json({ code: 404, message: '配置不存在', data: null }, 404);
  }

  return c.json({ code: 0, message: '更新成功', data: { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() } });
});

systemConfigsRoute.delete('/:id', guard({ permission: 'system:config:delete', audit: { module: '系统配置', description: '删除配置' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const [row] = await db.delete(systemConfigs).where(eq(systemConfigs.id, id)).returning();
  if (!row) {
    return c.json({ code: 404, message: '配置不存在', data: null }, 404);
  }
  return c.json({ code: 0, message: '删除成功', data: null });
});

systemConfigsRoute.get('/export', guard({ permission: 'system:config:list' }), async (c) => {
  const rows = await db.select().from(systemConfigs).orderBy(desc(systemConfigs.id));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '配置键', key: 'configKey', width: 30 },
      { header: '配置值', key: 'configValue', width: 40 },
      { header: '类型', key: 'configType', width: 10 },
      { header: '描述', key: 'description', width: 30 },
    ],
    rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
    '系统配置'
  );
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=system-configs.xlsx');
  return c.body(buffer);
});

export default systemConfigsRoute;
