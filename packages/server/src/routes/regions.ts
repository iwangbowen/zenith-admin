import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { regions } from '../db/schema';
import { createRegionSchema, updateRegionSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import type { Region } from '@zenith/shared';

const regionsRouter = new Hono();

regionsRouter.use('*', authMiddleware);

function toRegion(row: typeof regions.$inferSelect): Omit<Region, 'children'> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    level: row.level,
    parentCode: row.parentCode ?? null,
    sort: row.sort,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildTree(list: Omit<Region, 'children'>[]): Region[] {
  const map = new Map<string, Region>();
  list.forEach((item) => map.set(item.code, { ...item }));
  const roots: Region[] = [];

  map.forEach((node) => {
    if (!node.parentCode) {
      roots.push(node);
      return;
    }
    const parent = map.get(node.parentCode);
    if (parent) {
      parent.children = parent.children ?? [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNodes = (nodes: Region[]) => {
    nodes.sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
    nodes.forEach((item) => item.children && sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}

function filterTree(nodes: Region[], keyword: string, status?: string, level?: string): Region[] {
  return nodes.reduce<Region[]>((acc, node) => {
    const children = node.children ? filterTree(node.children, keyword, status, level) : [];
    const keywordMatched = !keyword || node.name.includes(keyword) || node.code.includes(keyword);
    const statusMatched = !status || node.status === status;
    const levelMatched = !level || node.level === level;
    if ((keywordMatched && statusMatched && levelMatched) || children.length > 0) {
      acc.push({ ...node, children: children.length > 0 ? children : undefined });
    }
    return acc;
  }, []);
}

// GET / 返回树形数据
regionsRouter.get('/', guard({ permission: 'system:region:list' }), async (c) => {
  const keyword = c.req.query('keyword') ?? '';
  const status = c.req.query('status');
  const level = c.req.query('level');

  const rows = await db.select().from(regions).orderBy(asc(regions.sort), asc(regions.code));
  const tree = buildTree(rows.map(toRegion));
  const data = keyword || status || level ? filterTree(tree, keyword, status, level) : tree;
  return c.json({ code: 0, message: 'ok', data });
});

// GET /flat 返回平铺列表（供下拉等场景使用）
regionsRouter.get('/flat', guard({ permission: 'system:region:list' }), async (c) => {
  const rows = await db.select().from(regions).orderBy(asc(regions.sort), asc(regions.code));
  return c.json({ code: 0, message: 'ok', data: rows.map(toRegion) });
});

// POST /
regionsRouter.post('/', guard({
  permission: 'system:region:create',
  audit: { description: '创建地区', module: '地区管理' },
}), async (c) => {
  const body = await c.req.json();
  const result = createRegionSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  // 如有 parentCode，验证父级是否存在
  if (result.data.parentCode) {
    const [parent] = await db.select({ code: regions.code })
      .from(regions).where(eq(regions.code, result.data.parentCode));
    if (!parent) {
      return c.json({ code: 400, message: '父级地区不存在', data: null }, 400);
    }
  }

  try {
    const [row] = await db.insert(regions).values({
      code: result.data.code,
      name: result.data.name,
      level: result.data.level,
      parentCode: result.data.parentCode ?? null,
      sort: result.data.sort,
      status: result.data.status,
    }).returning();
    return c.json({ code: 0, message: '创建成功', data: toRegion(row) });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      return c.json({ code: 400, message: '区划代码已存在', data: null }, 400);
    }
    throw err;
  }
});

// PUT /:id
regionsRouter.put('/:id', guard({
  permission: 'system:region:update',
  audit: { description: '更新地区', module: '地区管理' },
}), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateRegionSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  // 如更新了 parentCode，验证父级存在且不是自身
  if (result.data.parentCode) {
    const [current] = await db.select({ code: regions.code }).from(regions).where(eq(regions.id, id));
    if (!current) {
      return c.json({ code: 404, message: '地区不存在', data: null }, 404);
    }
    if (result.data.parentCode === current.code) {
      return c.json({ code: 400, message: '父级地区不能选择自身', data: null }, 400);
    }
    const [parent] = await db.select({ code: regions.code }).from(regions).where(eq(regions.code, result.data.parentCode));
    if (!parent) {
      return c.json({ code: 400, message: '父级地区不存在', data: null }, 400);
    }
  }

  try {
    const [row] = await db.update(regions)
      .set({ ...result.data, updatedAt: new Date() })
      .where(eq(regions.id, id))
      .returning();
    if (!row) {
      return c.json({ code: 404, message: '地区不存在', data: null }, 404);
    }
    return c.json({ code: 0, message: '更新成功', data: toRegion(row) });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      return c.json({ code: 400, message: '区划代码已存在', data: null }, 400);
    }
    throw err;
  }
});

// DELETE /:id
regionsRouter.delete('/:id', guard({
  permission: 'system:region:delete',
  audit: { description: '删除地区', module: '地区管理' },
}), async (c) => {
  const id = Number(c.req.param('id'));

  // 查出当前节点 code，检查是否有子节点
  const [current] = await db.select({ code: regions.code }).from(regions).where(eq(regions.id, id));
  if (!current) {
    return c.json({ code: 404, message: '地区不存在', data: null }, 404);
  }

  const children = await db.select({ id: regions.id })
    .from(regions).where(eq(regions.parentCode, current.code));
  if (children.length > 0) {
    return c.json({ code: 400, message: '该地区下存在子地区，请先删除子地区', data: null }, 400);
  }

  await db.delete(regions).where(eq(regions.id, id));
  return c.json({ code: 0, message: '删除成功', data: null });
});

export default regionsRouter;
