/**
 * 会员标签服务：标签 CRUD + 会员打标 / 批量打标（运营分群基础）。
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { members, memberTagBindings, memberTags } from '../../db/schema';
import type { MemberTagRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';

export interface SaveMemberTagInput {
  name: string;
  color?: string | null;
  description?: string | null;
  sort?: number;
  status?: 'enabled' | 'disabled';
}

export function mapMemberTag(row: MemberTagRow, memberCount?: number) {
  return {
    id: row.id,
    name: row.name,
    color: row.color ?? null,
    description: row.description ?? null,
    sort: row.sort,
    status: row.status,
    memberCount,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureMemberTagExists(id: number): Promise<MemberTagRow> {
  const [row] = await db.select().from(memberTags).where(eq(memberTags.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '会员标签不存在' });
  return row;
}

/** 全部标签 + 各标签绑定会员数（标签量级小，直接并行 count）*/
export async function listMemberTags() {
  const rows = await db.select().from(memberTags).orderBy(asc(memberTags.sort), asc(memberTags.id));
  const counts = await Promise.all(rows.map((r) => db.$count(memberTagBindings, eq(memberTagBindings.tagId, r.id))));
  return rows.map((r, i) => mapMemberTag(r, counts[i]));
}

export async function createMemberTag(input: SaveMemberTagInput) {
  try {
    const [row] = await db.insert(memberTags).values({
      name: input.name,
      color: input.color ?? null,
      description: input.description ?? null,
      sort: input.sort ?? 0,
      status: input.status ?? 'enabled',
    }).returning();
    return mapMemberTag(row, 0);
  } catch (err) {
    rethrowPgUniqueViolation(err, '标签名称已存在');
    throw err;
  }
}

export async function updateMemberTag(id: number, input: Partial<SaveMemberTagInput>) {
  await ensureMemberTagExists(id);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.color !== undefined) patch.color = input.color;
  if (input.description !== undefined) patch.description = input.description;
  if (input.sort !== undefined) patch.sort = input.sort;
  if (input.status !== undefined) patch.status = input.status;
  try {
    const [row] = await db.update(memberTags).set(patch).where(eq(memberTags.id, id)).returning();
    return mapMemberTag(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '标签名称已存在');
    throw err;
  }
}

export async function deleteMemberTag(id: number) {
  await ensureMemberTagExists(id);
  // 绑定关系 ON DELETE CASCADE 一并清除
  await db.delete(memberTags).where(eq(memberTags.id, id));
}

async function ensureTagIdsValid(executor: DbExecutor, tagIds: number[]): Promise<void> {
  if (tagIds.length === 0) return;
  const rows = await executor.select({ id: memberTags.id }).from(memberTags).where(inArray(memberTags.id, tagIds));
  if (rows.length !== new Set(tagIds).size) throw new HTTPException(400, { message: '存在无效的标签' });
}

/** 覆盖式设置单个会员的标签（先删后插）*/
export async function setMemberTags(memberId: number, tagIds: number[]): Promise<void> {
  const uniqueIds = [...new Set(tagIds)];
  await db.transaction(async (tx) => {
    await ensureTagIdsValid(tx, uniqueIds);
    await tx.delete(memberTagBindings).where(eq(memberTagBindings.memberId, memberId));
    if (uniqueIds.length > 0) {
      await tx.insert(memberTagBindings).values(uniqueIds.map((tagId) => ({ memberId, tagId })));
    }
  });
}

/** 批量为多个会员追加标签（已有绑定跳过），返回实际影响的会员数 */
export async function batchAddMemberTags(memberIds: number[], tagIds: number[]): Promise<number> {
  const uniqueMembers = [...new Set(memberIds)];
  const uniqueTags = [...new Set(tagIds)];
  if (uniqueMembers.length === 0 || uniqueTags.length === 0) return 0;
  return db.transaction(async (tx) => {
    await ensureTagIdsValid(tx, uniqueTags);
    const validMembers = await tx.select({ id: members.id }).from(members)
      .where(and(inArray(members.id, uniqueMembers), isNull(members.deletedAt)));
    if (validMembers.length === 0) return 0;
    const values = validMembers.flatMap((m) => uniqueTags.map((tagId) => ({ memberId: m.id, tagId })));
    await tx.insert(memberTagBindings).values(values).onConflictDoNothing();
    return validMembers.length;
  });
}
