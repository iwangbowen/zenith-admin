import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { departments, users } from '../db/schema';
import { createDepartmentSchema, updateDepartmentSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import type { Department } from '@zenith/shared';

const departmentsRouter = new Hono();

departmentsRouter.use('*', authMiddleware);

function toDepartment(row: typeof departments.$inferSelect): Omit<Department, 'children'> {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    code: row.code,
    leader: row.leader ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    sort: row.sort,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildTree(list: Omit<Department, 'children'>[]): Department[] {
  const map = new Map<number, Department>();
  list.forEach((item) => map.set(item.id, { ...item }));
  const roots: Department[] = [];

  map.forEach((node) => {
    if (node.parentId === 0) {
      roots.push(node);
      return;
    }

    const parent = map.get(node.parentId);
    if (!parent) {
      roots.push(node);
      return;
    }

    parent.children = parent.children ?? [];
    parent.children.push(node);
  });

  const sortNodes = (nodes: Department[]) => {
    nodes.sort((a, b) => a.sort - b.sort || a.id - b.id);
    nodes.forEach((item) => item.children && sortNodes(item.children));
  };

  sortNodes(roots);
  return roots;
}

function filterTree(nodes: Department[], keyword: string, status?: string) {
  return nodes.reduce<Department[]>((acc, node) => {
    const children = node.children ? filterTree(node.children, keyword, status) : [];
    const keywordMatched = !keyword || node.name.includes(keyword) || node.code.includes(keyword);
    const statusMatched = !status || node.status === status;
    if ((keywordMatched && statusMatched) || children.length > 0) {
      acc.push({ ...node, children: children.length > 0 ? children : undefined });
    }
    return acc;
  }, []);
}

async function ensureParentValid(parentId: number, currentId?: number) {
  if (parentId === 0) return null;
  const allDepartments = await db.select({ id: departments.id, parentId: departments.parentId }).from(departments);
  const parentExists = allDepartments.some((item) => item.id === parentId);
  if (!parentExists) {
    return '上级部门不存在';
  }
  if (!currentId) return null;
  if (parentId === currentId) {
    return '上级部门不能选择自身';
  }

  const descendants = new Set<number>();
  const queue = [currentId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }
    for (const item of allDepartments) {
      if (item.parentId === current) {
        descendants.add(item.id);
        queue.push(item.id);
      }
    }
  }

  if (descendants.has(parentId)) {
    return '上级部门不能选择子部门';
  }

  return null;
}

departmentsRouter.get('/', async (c) => {
  const keyword = c.req.query('keyword') ?? '';
  const status = c.req.query('status');

  const rows = await db.select().from(departments).orderBy(asc(departments.sort), asc(departments.id));
  const tree = buildTree(rows.map(toDepartment));
  const data = keyword || status ? filterTree(tree, keyword, status) : tree;
  return c.json({ code: 0, message: 'ok', data });
});

departmentsRouter.get('/flat', async (c) => {
  const rows = await db.select().from(departments).orderBy(asc(departments.sort), asc(departments.id));
  return c.json({ code: 0, message: 'ok', data: rows.map(toDepartment) });
});

departmentsRouter.post('/', auditLog({ description: '创建部门', module: '部门管理' }), async (c) => {
  const body = await c.req.json();
  const result = createDepartmentSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const parentError = await ensureParentValid(result.data.parentId);
  if (parentError) {
    return c.json({ code: 400, message: parentError, data: null }, 400);
  }

  try {
    const [department] = await db.insert(departments).values(result.data).returning();
    return c.json({ code: 0, message: '创建成功', data: toDepartment(department) });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') {
      return c.json({ code: 400, message: '部门编码已存在', data: null }, 400);
    }
    throw error;
  }
});

departmentsRouter.put('/:id', auditLog({ description: '更新部门', module: '部门管理' }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateDepartmentSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  if (result.data.parentId !== undefined) {
    const parentError = await ensureParentValid(result.data.parentId, id);
    if (parentError) {
      return c.json({ code: 400, message: parentError, data: null }, 400);
    }
  }

  try {
    const [department] = await db
      .update(departments)
      .set({ ...result.data, updatedAt: new Date() })
      .where(eq(departments.id, id))
      .returning();

    if (!department) {
      return c.json({ code: 404, message: '部门不存在', data: null }, 404);
    }

    return c.json({ code: 0, message: '更新成功', data: toDepartment(department) });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') {
      return c.json({ code: 400, message: '部门编码已存在', data: null }, 400);
    }
    throw error;
  }
});

departmentsRouter.delete('/:id', auditLog({ description: '删除部门', module: '部门管理' }), async (c) => {
  const id = Number(c.req.param('id'));
  const [department] = await db.select({ id: departments.id }).from(departments).where(eq(departments.id, id)).limit(1);
  if (!department) {
    return c.json({ code: 404, message: '部门不存在', data: null }, 404);
  }

  const [childDepartment] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.parentId, id))
    .limit(1);
  if (childDepartment) {
    return c.json({ code: 400, message: '该部门存在子部门，无法删除', data: null }, 400);
  }

  const [boundUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.departmentId, id))
    .limit(1);
  if (boundUser) {
    return c.json({ code: 400, message: '该部门下仍有关联用户，无法删除', data: null }, 400);
  }

  await db.delete(departments).where(eq(departments.id, id));
  return c.json({ code: 0, message: '删除成功', data: null });
});

export default departmentsRouter;
