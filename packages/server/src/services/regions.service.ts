import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { regions } from '../db/schema';
import type { Region } from '@zenith/shared';
import { AppError } from '../lib/errors';
import { rethrowPgUniqueViolation } from '../lib/db-errors';

export function mapRegion(row: typeof regions.$inferSelect): Omit<Region, 'children'> {
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

export function buildRegionTree(list: Omit<Region, 'children'>[]): Region[] {
  const map = new Map<string, Region>();
  list.forEach((item) => map.set(item.code, { ...item }));
  const roots: Region[] = [];
  map.forEach((node) => {
    if (!node.parentCode) { roots.push(node); return; }
    const parent = map.get(node.parentCode);
    if (parent) { parent.children = parent.children ?? []; parent.children.push(node); }
    else { roots.push(node); }
  });
  const sortNodes = (nodes: Region[]) => {
    nodes.sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
    nodes.forEach((item) => item.children && sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}

export function filterRegionTree(nodes: Region[], keyword: string, status?: string, level?: string): Region[] {
  return nodes.reduce<Region[]>((acc, node) => {
    const children = node.children ? filterRegionTree(node.children, keyword, status, level) : [];
    const keywordMatched = !keyword || node.name.includes(keyword) || node.code.includes(keyword);
    const statusMatched = !status || node.status === status;
    const levelMatched = !level || node.level === level;
    if ((keywordMatched && statusMatched && levelMatched) || children.length > 0) {
      acc.push({ ...node, children: children.length > 0 ? children : undefined });
    }
    return acc;
  }, []);
}

export interface CreateRegionInput {
  code: string;
  name: string;
  level: 'province' | 'city' | 'county';
  parentCode?: string | null;
  sort?: number;
  status?: 'active' | 'disabled';
}
export type UpdateRegionInput = Partial<CreateRegionInput>;

export async function listRegionTree(q: { keyword?: string; status?: string; level?: string }): Promise<Region[]> {
  const rows = await db.select().from(regions).orderBy(asc(regions.sort), asc(regions.code));
  const tree = buildRegionTree(rows.map(mapRegion));
  return q.keyword || q.status || q.level ? filterRegionTree(tree, q.keyword ?? '', q.status, q.level) : tree;
}

export async function listRegionsFlat() {
  const rows = await db.select().from(regions).orderBy(asc(regions.sort), asc(regions.code));
  return rows.map(mapRegion);
}

export async function createRegion(data: CreateRegionInput) {
  if (data.parentCode) {
    const [parent] = await db.select({ code: regions.code }).from(regions).where(eq(regions.code, data.parentCode));
    if (!parent) throw new AppError('父级地区不存在', 400);
  }
  try {
    const [row] = await db.insert(regions).values({
      code: data.code,
      name: data.name,
      level: data.level,
      parentCode: data.parentCode ?? null,
      sort: data.sort ?? 0,
      status: data.status ?? 'active',
    }).returning();
    return mapRegion(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '区划代码已存在');
  }
}

export async function updateRegion(id: number, data: UpdateRegionInput) {
  const [current] = await db.select({ code: regions.code }).from(regions).where(eq(regions.id, id));
  if (!current) throw new AppError('地区不存在', 404);
  if (data.parentCode) {
    if (data.parentCode === current.code) throw new AppError('父级地区不能选择自身', 400);
    const [parent] = await db.select({ code: regions.code }).from(regions).where(eq(regions.code, data.parentCode));
    if (!parent) throw new AppError('父级地区不存在', 400);
  }
  try {
    const [row] = await db.update(regions).set({ ...data }).where(eq(regions.id, id)).returning();
    if (!row) throw new AppError('地区不存在', 404);
    return mapRegion(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '区划代码已存在');
  }
}

export async function deleteRegion(id: number) {
  const [current] = await db.select({ code: regions.code }).from(regions).where(eq(regions.id, id));
  if (!current) throw new AppError('地区不存在', 404);
  const children = await db.select({ id: regions.id }).from(regions).where(eq(regions.parentCode, current.code));
  if (children.length > 0) throw new AppError('该地区下存在子地区，请先删除子地区', 400);
  await db.delete(regions).where(eq(regions.id, id));
}
