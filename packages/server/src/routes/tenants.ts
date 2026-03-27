import { Hono } from 'hono';
import { eq, like, and, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import { tenants } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { createTenantSchema, updateTenantSchema } from '@zenith/shared';
import { exportToExcel } from '../lib/excel-export';
import { isPlatformAdmin } from '../lib/tenant';

const tenantsRoute = new Hono<{ Variables: { user: JwtPayload } }>();

tenantsRoute.use('*', authMiddleware);

// 仅平台管理员可操作租户
tenantsRoute.use('*', async (c, next) => {
  const user = c.get('user');
  if (!isPlatformAdmin(user)) {
    return c.json({ code: 403, message: '仅平台管理员可管理租户', data: null }, 403);
  }
  await next();
});

// 租户列表
tenantsRoute.get('/', async (c) => {
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const keyword = c.req.query('keyword');
  const status = c.req.query('status');

  const conditions = [];
  if (keyword) {
    conditions.push(like(tenants.name, `%${keyword}%`));
  }
  if (status && (status === 'active' || status === 'disabled')) {
    conditions.push(eq(tenants.status, status));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(tenants)
    .where(where);

  const rows = await db
    .select()
    .from(tenants)
    .where(where)
    .orderBy(desc(tenants.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: rows.map((r) => ({
        ...r,
        expireAt: r.expireAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      total: count,
      page,
      pageSize,
    },
  });
});

// 获取全部租户（下拉选择用）
tenantsRoute.get('/all', async (c) => {
  const rows = await db
    .select({ id: tenants.id, name: tenants.name, code: tenants.code, status: tenants.status })
    .from(tenants)
    .orderBy(tenants.id);
  return c.json({ code: 0, message: 'ok', data: rows });
});

// 获取单个租户
tenantsRoute.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const [row] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!row) {
    return c.json({ code: 404, message: '租户不存在', data: null }, 404);
  }
  return c.json({
    code: 0,
    message: 'ok',
    data: {
      ...row,
      expireAt: row.expireAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  });
});

// 创建租户
tenantsRoute.post('/', guard({ audit: { module: '租户管理', description: '创建租户' } }), async (c) => {
  const body = await c.req.json();
  const result = createTenantSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const [existing] = await db.select().from(tenants).where(eq(tenants.code, result.data.code)).limit(1);
  if (existing) {
    return c.json({ code: 400, message: '租户编码已存在', data: null }, 400);
  }

  const values = {
    ...result.data,
    expireAt: result.data.expireAt ? new Date(result.data.expireAt) : null,
  };

  const [row] = await db.insert(tenants).values(values).returning();
  return c.json({
    code: 0,
    message: '创建成功',
    data: {
      ...row,
      expireAt: row.expireAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  });
});

// 更新租户
tenantsRoute.put('/:id', guard({ audit: { module: '租户管理', description: '更新租户' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateTenantSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  if (result.data.code) {
    const [dup] = await db.select().from(tenants)
      .where(and(eq(tenants.code, result.data.code), sql`${tenants.id} != ${id}`))
      .limit(1);
    if (dup) {
      return c.json({ code: 400, message: '租户编码已存在', data: null }, 400);
    }
  }

  const { expireAt: rawExpireAt, ...rest } = result.data;
  const values = {
    ...rest,
    ...(rawExpireAt === undefined ? {} : { expireAt: rawExpireAt ? new Date(rawExpireAt) : null }),
    updatedAt: new Date(),
  };

  const [row] = await db.update(tenants).set(values).where(eq(tenants.id, id)).returning();
  if (!row) {
    return c.json({ code: 404, message: '租户不存在', data: null }, 404);
  }

  return c.json({
    code: 0,
    message: '更新成功',
    data: {
      ...row,
      expireAt: row.expireAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  });
});

// 删除租户
tenantsRoute.delete('/:id', guard({ audit: { module: '租户管理', description: '删除租户' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const [row] = await db.delete(tenants).where(eq(tenants.id, id)).returning();
  if (!row) {
    return c.json({ code: 404, message: '租户不存在', data: null }, 404);
  }
  return c.json({ code: 0, message: '删除成功', data: null });
});

// 导出
tenantsRoute.get('/export', async (c) => {
  const rows = await db.select().from(tenants).orderBy(desc(tenants.id));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '租户名称', key: 'name', width: 20 },
      { header: '租户编码', key: 'code', width: 16 },
      { header: '联系人', key: 'contactName', width: 14 },
      { header: '联系电话', key: 'contactPhone', width: 16 },
      { header: '状态', key: 'status', width: 10, transform: (v) => v === 'active' ? '启用' : '禁用' },
      { header: '到期时间', key: 'expireAt', width: 22 },
      { header: '最大用户数', key: 'maxUsers', width: 12 },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({
      ...r,
      expireAt: r.expireAt?.toISOString() ?? '',
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    '租户列表'
  );
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=tenants.xlsx');
  return c.body(buffer);
});

export default tenantsRoute;
