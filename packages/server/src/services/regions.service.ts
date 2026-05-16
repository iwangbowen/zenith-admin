import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { regions } from '../db/schema';
import type { Region } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { formatDateTime } from '../lib/datetime';
import { streamToExcel, formatDateTimeForExcel } from '../lib/excel-export';

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
    if (!parent) throw new HTTPException(400, { message: '父级地区不存在' });
  }
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
  const [current] = await db.select({ code: regions.code }).from(regions).where(eq(regions.id, id));
  if (!current) throw new HTTPException(404, { message: '地区不存在' });
  if (data.parentCode) {
    if (data.parentCode === current.code) throw new HTTPException(400, { message: '父级地区不能选择自身' });
    const [parent] = await db.select({ code: regions.code }).from(regions).where(eq(regions.code, data.parentCode));
    if (!parent) throw new HTTPException(400, { message: '父级地区不存在' });
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

export async function getRegionBeforeAudit(id: number) {
  const [row] = await db.select().from(regions).where(eq(regions.id, id)).limit(1);
  if (!row) return null;
  return mapRegion(row);
}

const LEVEL_LABELS: Record<string, string> = { province: '省级', city: '地级', county: '县级' };

export async function exportRegions(): Promise<{ stream: ReadableStream; filename: string }> {
  const rows = await db.select().from(regions).orderBy(asc(regions.sort), asc(regions.code));
  const stream = await streamToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '地区名称', key: 'name', width: 20 },
      { header: '区划代码', key: 'code', width: 14 },
      { header: '级别', key: 'level', width: 10, transform: (v) => LEVEL_LABELS[v as string] ?? v },
      { header: '父级代码', key: 'parentCode', width: 14, transform: (v) => (v as string | null) ?? '—' },
      { header: '排序', key: 'sort', width: 8 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'enabled' ? '启用' : '禁用') },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, createdAt: formatDateTimeForExcel(r.createdAt) })),
    '地区列表',
  );
  return { stream, filename: 'regions.xlsx' };
}
