import { asc, eq, and } from 'drizzle-orm';
import { db } from '../db';
import { departments, users } from '../db/schema';
import { AppError } from '../lib/errors';
import { currentUser } from '../lib/context';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { exportToExcel } from '../lib/excel-export';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import type { Department, createDepartmentSchema, updateDepartmentSchema } from '@zenith/shared';
import type { z } from 'zod';

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapDepartment(row: typeof departments.$inferSelect): Omit<Department, 'children'> {
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

// ─── 树形结构构建 ─────────────────────────────────────────────────────────────

export function buildDepartmentTree(list: Omit<Department, 'children'>[]): Department[] {
  const map = new Map<number, Department>();
  list.forEach((item) => map.set(item.id, { ...item }));
  const roots: Department[] = [];
  map.forEach((node) => {
    if (node.parentId === 0) { roots.push(node); return; }
    const parent = map.get(node.parentId);
    if (!parent) { roots.push(node); return; }
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

export function filterDepartmentTree(nodes: Department[], keyword: string, status?: string): Department[] {
  return nodes.reduce<Department[]>((acc, node) => {
    const children = node.children ? filterDepartmentTree(node.children, keyword, status) : [];
    const keywordMatched = !keyword || node.name.includes(keyword) || node.code.includes(keyword);
    const statusMatched = !status || node.status === status;
    if ((keywordMatched && statusMatched) || children.length > 0) {
      acc.push({ ...node, children: children.length > 0 ? children : undefined });
    }
    return acc;
  }, []);
}

// ─── 业务校验 ─────────────────────────────────────────────────────────────────

export async function ensureParentValid(parentId: number, currentId?: number) {
  if (parentId === 0) return;
  const allDepartments = await db.select({ id: departments.id, parentId: departments.parentId }).from(departments);
  const parentExists = allDepartments.some((item) => item.id === parentId);
  if (!parentExists) throw new AppError('上级部门不存在', 400);
  if (!currentId) return;
  if (parentId === currentId) throw new AppError('上级部门不能选择自身', 400);
  const descendants = new Set<number>();
  const queue = [currentId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const item of allDepartments) {
      if (item.parentId === current) { descendants.add(item.id); queue.push(item.id); }
    }
  }
  if (descendants.has(parentId)) throw new AppError('上级部门不能选择子部门', 400);
}

// ─── 业务方法 ─────────────────────────────────────────────────────────────────

export async function listDepartmentTree(params: { keyword?: string; status?: string }): Promise<Department[]> {
  const tc = tenantCondition(departments, currentUser());
  const rows = await db.select().from(departments).where(tc).orderBy(asc(departments.sort), asc(departments.id));
  const tree = buildDepartmentTree(rows.map(mapDepartment));
  const { keyword = '', status } = params;
  return keyword || status ? filterDepartmentTree(tree, keyword, status) : tree;
}

export async function listDepartmentsFlat(): Promise<Omit<Department, 'children'>[]> {
  const tc = tenantCondition(departments, currentUser());
  const rows = await db.select().from(departments).where(tc).orderBy(asc(departments.sort), asc(departments.id));
  return rows.map(mapDepartment);
}

export async function createDepartment(input: CreateDepartmentInput): Promise<Omit<Department, 'children'>> {
  await ensureParentValid(input.parentId);
  try {
    const [row] = await db
      .insert(departments)
      .values({ ...input, tenantId: getCreateTenantId(currentUser()) })
      .returning();
    return mapDepartment(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '部门编码已存在');
  }
}

export async function updateDepartment(id: number, input: UpdateDepartmentInput): Promise<Omit<Department, 'children'>> {
  if (input.parentId !== undefined) {
    await ensureParentValid(input.parentId, id);
  }
  const tc = tenantCondition(departments, currentUser());
  try {
    const [row] = await db
      .update(departments)
      .set({ ...input })
      .where(and(eq(departments.id, id), tc))
      .returning();
    if (!row) throw new AppError('部门不存在', 404);
    return mapDepartment(row);
  } catch (err) {
    if (err instanceof AppError) throw err;
    rethrowPgUniqueViolation(err, '部门编码已存在');
  }
}

export async function deleteDepartment(id: number): Promise<void> {
  const tc = tenantCondition(departments, currentUser());
  const [exists] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, id), tc)).limit(1);
  if (!exists) throw new AppError('部门不存在', 404);
  const [child] = await db.select({ id: departments.id }).from(departments).where(eq(departments.parentId, id)).limit(1);
  if (child) throw new AppError('该部门存在子部门，无法删除', 400);
  const [boundUser] = await db.select({ id: users.id }).from(users).where(eq(users.departmentId, id)).limit(1);
  if (boundUser) throw new AppError('该部门下仍有关联用户，无法删除', 400);
  await db.delete(departments).where(and(eq(departments.id, id), tc));
}

export async function exportDepartments(): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const tc = tenantCondition(departments, currentUser());
  const rows = await db.select().from(departments).where(tc).orderBy(asc(departments.sort));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '部门名称', key: 'name', width: 20 },
      { header: '部门编码', key: 'code', width: 16 },
      { header: '负责人', key: 'leader', width: 14 },
      { header: '电话', key: 'phone', width: 16 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'active' ? '启用' : '禁用') },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, leader: r.leader ?? '', phone: r.phone ?? '', createdAt: r.createdAt.toISOString() })),
    '部门列表',
  );
  return { buffer, filename: 'departments.xlsx' };
}
