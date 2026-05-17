import { eq, asc, and, or, like, inArray, type SQL } from 'drizzle-orm';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { tags } from '../db/schema';
import type { TagRow } from '../db/schema';
import { formatDateTime } from '../lib/datetime';
import { HTTPException } from 'hono/http-exception';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import type { CreateTagInput, UpdateTagInput } from '@zenith/shared';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapTag(row: TagRow) {
  return {
    id:          row.id,
    name:        row.name,
    color:       row.color ?? null,
    groupName:   row.groupName ?? null,
    description: row.description ?? null,
    status:      row.status,
    sortOrder:   row.sortOrder,
    createdAt:   formatDateTime(row.createdAt),
    updatedAt:   formatDateTime(row.updatedAt),
  };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────

export async function ensureTagExists(id: number) {
  const [row] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '标签不存在' });
  return row;
}

// ─── 列表查询 ─────────────────────────────────────────────────────────────────

export interface ListTagsQuery {
  keyword?: string;
  status?: 'enabled' | 'disabled';
  groupName?: string;
  page: number;
  pageSize: number;
}

export async function listTags(q: ListTagsQuery) {
  const { keyword = '', status, groupName = '', page, pageSize } = q;
  const conditions: SQL[] = [];
  if (keyword) {
    const kw = or(
      like(tags.name, `%${escapeLike(keyword)}%`),
      like(tags.description, `%${escapeLike(keyword)}%`),
    );
    if (kw) conditions.push(kw);
  }
  if (status) conditions.push(eq(tags.status, status));
  if (groupName) conditions.push(like(tags.groupName, `%${escapeLike(groupName)}%`));

  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(tags, where),
    withPagination(
      db.select().from(tags).where(where).orderBy(asc(tags.sortOrder), asc(tags.id)).$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { list: list.map(mapTag), total, page, pageSize };
}

// ─── 创建 ─────────────────────────────────────────────────────────────────────

export async function createTag(data: CreateTagInput) {
  try {
    const [row] = await db.insert(tags).values(data).returning();
    return mapTag(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '标签名称已存在');
  }
}

// ─── 更新 ─────────────────────────────────────────────────────────────────────

export async function updateTag(id: number, data: UpdateTagInput) {
  try {
    const [row] = await db.update(tags).set(data).where(eq(tags.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '标签不存在' });
    return mapTag(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '标签名称已存在');
  }
}

// ─── 删除 ─────────────────────────────────────────────────────────────────────

export async function deleteTag(id: number) {
  const [row] = await db.delete(tags).where(eq(tags.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '标签不存在' });
}

// ─── 批量删除 ─────────────────────────────────────────────────────────────────

export async function batchDeleteTags(ids: number[]) {
  if (ids.length === 0) return;
  await db.delete(tags).where(inArray(tags.id, ids));
}

// ─── 获取所有分组（用于下拉选项） ──────────────────────────────────────────────

export async function listTagGroups() {
  const rows = await db
    .selectDistinct({ groupName: tags.groupName })
    .from(tags)
    .where(eq(tags.status, 'enabled'))
    .orderBy(asc(tags.groupName));
  return rows.map((r) => r.groupName).filter(Boolean) as string[];
}
