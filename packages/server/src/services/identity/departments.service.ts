import { requireRow } from '../../lib/db-assert';
import { asc, eq, and, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { departments, users } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { syncAllDynamicGroupsSafe } from './user-group-rules.service';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { Department, createDepartmentSchema, updateDepartmentSchema } from '@zenith/shared/identity';
import type * as z from 'zod';
import { getScopeMemberSummaries } from './user-scope.service';
import { buildTree } from '@zenith/shared/core';

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapDepartment(
  row: typeof departments.$inferSelect,
  leaderName?: string | null,
): Omit<Department, 'children'> {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    code: row.code,
    category: row.category,
    leaderId: row.leaderId ?? null,
    leaderName: leaderName ?? null,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    sort: row.sort,
    status: row.status,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function buildLeaderMap(leaderIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (leaderIds.length === 0) return map;
  const leaderUsers = await db
    .select({ id: users.id, nickname: users.nickname })
    .from(users)
    .where(inArray(users.id, leaderIds));
  leaderUsers.forEach((u) => map.set(u.id, u.nickname));
  return map;
}

// ─── 树形结构构建 ─────────────────────────────────────────────────────────────

export function buildDepartmentTree(list: Omit<Department, 'children'>[]): Department[] {
  return buildTree<Department>(list, { compare: (a, b) => a.sort - b.sort || a.id - b.id });
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
  const user = currentUser();
  const tc = tenantCondition(departments, user);
  const allDepartments = await db.select({ id: departments.id, parentId: departments.parentId }).from(departments).where(tc);
  const parentExists = allDepartments.some((item) => item.id === parentId);
  if (!parentExists) throw new HTTPException(400, { message: '上级部门不存在' });
  if (!currentId) return;
  if (parentId === currentId) throw new HTTPException(400, { message: '上级部门不能选择自身' });
  const descendants = new Set<number>();
  const queue = [currentId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const item of allDepartments) {
      if (item.parentId === current) { descendants.add(item.id); queue.push(item.id); }
    }
  }
  if (descendants.has(parentId)) throw new HTTPException(400, { message: '上级部门不能选择子部门' });
}

// ─── 业务方法 ─────────────────────────────────────────────────────────────────

export async function listDepartmentTree(params: { keyword?: string; status?: string }): Promise<Department[]> {
  const tc = tenantCondition(departments, currentUser());
  const rows = await db.select().from(departments).where(tc).orderBy(asc(departments.sort), asc(departments.id));
  const leaderIds = [...new Set(rows.map((r) => r.leaderId).filter((id): id is number => id !== null))];
  const deptIds = rows.map((r) => r.id);

  const [leaderMap, memberSummaries] = await Promise.all([
    buildLeaderMap(leaderIds),
    getScopeMemberSummaries('department', deptIds),
  ]);

  const mapped = rows.map((r) => ({
    ...mapDepartment(r, r.leaderId ? leaderMap.get(r.leaderId) ?? null : null),
    userCount: memberSummaries.get(r.id)?.count ?? 0,
    userPreview: memberSummaries.get(r.id)?.preview ?? [],
  }));
  const tree = buildDepartmentTree(mapped);
  const { keyword = '', status } = params;
  return keyword || status ? filterDepartmentTree(tree, keyword, status) : tree;
}

export async function listDepartmentsFlat(): Promise<Omit<Department, 'children'>[]> {
  const tc = tenantCondition(departments, currentUser());
  const rows = await db.select().from(departments).where(tc).orderBy(asc(departments.sort), asc(departments.id));
  const leaderIds = [...new Set(rows.map((r) => r.leaderId).filter((id): id is number => id !== null))];
  const leaderMap = await buildLeaderMap(leaderIds);
  return rows.map((r) => mapDepartment(r, r.leaderId ? leaderMap.get(r.leaderId) ?? null : null));
}

export async function createDepartment(input: CreateDepartmentInput): Promise<Omit<Department, 'children'>> {
  await ensureParentValid(input.parentId);
  try {
    const [row] = await db
      .insert(departments)
      .values({ ...input, tenantId: getCreateTenantId(currentUser()) })
      .returning();
    const leaderMap = await buildLeaderMap(row.leaderId ? [row.leaderId] : []);
    return mapDepartment(row, row.leaderId ? leaderMap.get(row.leaderId) ?? null : null);
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
    requireRow(row, '部门不存在');
    // 部门挂载点变化影响动态用户组的子树展开结果，整体校准
    if (input.parentId !== undefined) syncAllDynamicGroupsSafe('部门移动');
    const leaderMap = await buildLeaderMap(row.leaderId ? [row.leaderId] : []);
    return mapDepartment(row, row.leaderId ? leaderMap.get(row.leaderId) ?? null : null);
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    rethrowPgUniqueViolation(err, '部门编码已存在');
  }
}

export async function deleteDepartment(id: number): Promise<void> {
  const tc = tenantCondition(departments, currentUser());
  const [exists] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, id), tc)).limit(1);
  requireRow(exists, '部门不存在');
  const [[child], [boundUser]] = await Promise.all([
    db.select({ id: departments.id }).from(departments).where(eq(departments.parentId, id)).limit(1),
    db.select({ id: users.id }).from(users).where(eq(users.departmentId, id)).limit(1),
  ]);
  if (child) throw new HTTPException(400, { message: '该部门存在子部门，无法删除' });
  if (boundUser) throw new HTTPException(400, { message: '该部门下仍有关联用户，无法删除' });
  await db.delete(departments).where(and(eq(departments.id, id), tc));
}

export async function getDepartment(id: number) {
  const tc = tenantCondition(departments, currentUser());
  const [row] = await db.select().from(departments).where(and(eq(departments.id, id), tc)).limit(1);
  requireRow(row, '部门不存在');
  const leaderMap = await buildLeaderMap(row.leaderId ? [row.leaderId] : []);
  return mapDepartment(row, row.leaderId ? leaderMap.get(row.leaderId) ?? null : null);
}

export async function getDepartmentBeforeAudit(id: number) {
  const tc = tenantCondition(departments, currentUser());
  const [row] = await db.select().from(departments).where(and(eq(departments.id, id), tc)).limit(1);
  if (!row) return null;
  const leaderMap = await buildLeaderMap(row.leaderId ? [row.leaderId] : []);
  return mapDepartment(row, row.leaderId ? leaderMap.get(row.leaderId) ?? null : null);
}
