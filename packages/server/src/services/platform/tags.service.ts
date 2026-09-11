import { eq, asc, inArray } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import { tagContract } from '@zenith/shared/platform';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { db } from '../../db';
import { tags } from '../../db/schema';
import type { TagRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CreateTagInput, UpdateTagInput } from '@zenith/shared/platform';

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
  return requireFirstRow(
    db.select().from(tags).where(eq(tags.id, id)).limit(1),
    '标签不存在',
  );
}

export async function getTag(id: number) {
  return mapTag(await ensureTagExists(id));
}

export async function getTagsBeforeAudit(ids: number[]) {
  if (ids.length === 0) return [];
  const rows = await db.select().from(tags).where(inArray(tags.id, ids));
  return rows.map(mapTag);
}

// ─── 列表查询 ─────────────────────────────────────────────────────────────────

export async function listTags(q: QueryOutputOf<typeof tagContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    keywordCondition(q.keyword, [tags.name, tags.description]),
    q.status ? eq(tags.status, q.status) : undefined,
    keywordCondition(q.groupName, [tags.groupName]),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(tags, where),
    rows: () => withPagination(
      db.select().from(tags).where(where).orderBy(asc(tags.sortOrder), asc(tags.id)).$dynamic(),
      page,
      pageSize,
    ),
    map: mapTag,
  });
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
    return mapTag(requireRow(row, '标签不存在'));
  } catch (err) {
    rethrowPgUniqueViolation(err, '标签名称已存在');
  }
}

// ─── 删除 ─────────────────────────────────────────────────────────────────────

export async function deleteTag(id: number) {
  const [row] = await db.delete(tags).where(eq(tags.id, id)).returning();
  requireRow(row, '标签不存在');
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
