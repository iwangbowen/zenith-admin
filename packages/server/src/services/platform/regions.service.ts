import { asc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { regions } from '../../db/schema';
import type { Region } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatDateTime } from '../../lib/datetime';

export function mapRegion(row: typeof regions.$inferSelect): Omit<Region, 'children'> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    level: row.level,
    parentCode: row.parentCode ?? null,
    sort: row.sort,
    status: row.status,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
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
  status?: 'enabled' | 'disabled';
}
export type UpdateRegionInput = Partial<CreateRegionInput>;

// 行政层级约束：province 仅根级、city 父须 province、county 父须 city
const LEVEL_PARENT: Record<'province' | 'city' | 'county', 'province' | 'city' | null> = {
  province: null,
  city: 'province',
  county: 'city',
};
const LEVEL_LABEL: Record<'province' | 'city' | 'county', string> = {
  province: '省',
  city: '市',
  county: '区县',
};

function ensureLevelHierarchy(level: 'province' | 'city' | 'county', parentLevel: string | null) {
  const expected = LEVEL_PARENT[level];
  if (expected === null) {
    if (parentLevel !== null) {
      throw new HTTPException(400, { message: '省级地区不能挂载父级地区' });
    }
    return;
  }
  if (parentLevel !== expected) {
    throw new HTTPException(400, { message: `${LEVEL_LABEL[level]}级地区的父级必须为${LEVEL_LABEL[expected]}级地区` });
  }
}

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
  let parentLevel: string | null = null;
  if (data.parentCode) {
    const [parent] = await db.select({ code: regions.code, level: regions.level }).from(regions).where(eq(regions.code, data.parentCode));
    if (!parent) throw new HTTPException(400, { message: '父级地区不存在' });
    parentLevel = parent.level;
  }
  ensureLevelHierarchy(data.level, parentLevel);
  try {
    const [row] = await db.insert(regions).values({
      code: data.code,
      name: data.name,
      level: data.level,
      parentCode: data.parentCode ?? null,
      sort: data.sort ?? 0,
      status: data.status ?? 'enabled',
    }).returning();
    return mapRegion(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '区划代码已存在');
  }
}

export async function updateRegion(id: number, data: UpdateRegionInput) {
  const [current] = await db.select({ code: regions.code, level: regions.level, parentCode: regions.parentCode }).from(regions).where(eq(regions.id, id));
  if (!current) throw new HTTPException(404, { message: '地区不存在' });
  const all = await db.select({ code: regions.code, parentCode: regions.parentCode, level: regions.level }).from(regions);
  if (data.parentCode) {
    if (data.parentCode === current.code) throw new HTTPException(400, { message: '父级地区不能选择自身' });
    if (!all.some((r) => r.code === data.parentCode)) throw new HTTPException(400, { message: '父级地区不存在' });
    // 环引用防护：父级不能落在自身的子孙中（A→B→C 后再把 A 挂到 C 下会成环）
    const childrenByParent = new Map<string, string[]>();
    for (const r of all) {
      if (!r.parentCode) continue;
      const arr = childrenByParent.get(r.parentCode);
      if (arr) arr.push(r.code);
      else childrenByParent.set(r.parentCode, [r.code]);
    }
    const descendants = new Set<string>();
    const queue = [current.code];
    while (queue.length > 0) {
      const code = queue.shift();
      if (code === undefined) continue;
      for (const child of childrenByParent.get(code) ?? []) {
        if (!descendants.has(child)) { descendants.add(child); queue.push(child); }
      }
    }
    if (descendants.has(data.parentCode)) throw new HTTPException(400, { message: '父级地区不能选择自身的下级地区' });
  }
  // 行政层级校验：按「变更后」的 level + 父级组合验证，并保证已有子级与新层级兼容
  const nextLevel = data.level ?? current.level;
  const nextParentCode = data.parentCode === undefined ? current.parentCode : data.parentCode;
  const nextParentLevel = nextParentCode ? (all.find((r) => r.code === nextParentCode)?.level ?? null) : null;
  ensureLevelHierarchy(nextLevel, nextParentLevel);
  const childLevels = new Set(all.filter((r) => r.parentCode === current.code).map((r) => r.level));
  if (childLevels.size > 0) {
    if (nextLevel === 'county') throw new HTTPException(400, { message: '区县级地区下不允许存在子级，请先迁移子地区' });
    const expectedChild = nextLevel === 'province' ? 'city' : 'county';
    if ([...childLevels].some((lv) => lv !== expectedChild)) {
      throw new HTTPException(400, { message: `变更层级后与现有子级地区层级冲突（子级须为${LEVEL_LABEL[expectedChild]}级）` });
    }
  }
  try {
    const [row] = await db.update(regions).set({ ...data }).where(eq(regions.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '地区不存在' });
    return mapRegion(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '区划代码已存在');
  }
}

export async function deleteRegion(id: number) {
  const [current] = await db.select({ code: regions.code }).from(regions).where(eq(regions.id, id));
  if (!current) throw new HTTPException(404, { message: '地区不存在' });
  const children = await db.select({ id: regions.id }).from(regions).where(eq(regions.parentCode, current.code));
  if (children.length > 0) throw new HTTPException(400, { message: '该地区下存在子地区，请先删除子地区' });
  await db.delete(regions).where(eq(regions.id, id));
}

export async function getRegion(id: number) {
  const [row] = await db.select().from(regions).where(eq(regions.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '地区不存在' });
  return mapRegion(row);
}

export async function getRegionBeforeAudit(id: number) {
  const [row] = await db.select().from(regions).where(eq(regions.id, id)).limit(1);
  if (!row) return null;
  return mapRegion(row);
}
