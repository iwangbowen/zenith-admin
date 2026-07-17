import { eq, and, or, ilike, asc, desc, sql } from 'drizzle-orm';
import { db } from '../../db';
import { aiPromptTemplates } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { escapeLike, withPagination } from '../../lib/where-helpers';
import { HTTPException } from 'hono/http-exception';
import type { CreateAiPromptTemplateInput, UpdateAiPromptTemplateInput, AiPromptScope } from '@zenith/shared';

function mapTemplate(row: typeof aiPromptTemplates.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    description: row.description,
    category: row.category,
    scope: row.scope,
    userId: row.userId,
    isBuiltin: row.isBuiltin,
    sort: row.sort,
    usageCount: row.usageCount,
    isEnabled: row.isEnabled,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 可见性条件：系统级模板 + 当前用户的私有模板 */
function visibilityCond() {
  const user = currentUser();
  return or(
    eq(aiPromptTemplates.scope, 'system'),
    and(eq(aiPromptTemplates.scope, 'user'), eq(aiPromptTemplates.userId, user.userId)),
  )!;
}

/** 管理列表（分页）：可见模板，支持按范围与关键词筛选 */
export async function listPromptTemplates(params: {
  page: number;
  pageSize: number;
  scope?: AiPromptScope;
  keyword?: string;
}) {
  const { page, pageSize, scope, keyword } = params;
  const conds = [visibilityCond()];
  if (scope) conds.push(eq(aiPromptTemplates.scope, scope));
  if (keyword?.trim()) {
    const kw = `%${escapeLike(keyword.trim())}%`;
    conds.push(or(ilike(aiPromptTemplates.name, kw), ilike(aiPromptTemplates.description, kw))!);
  }
  const where = and(...conds);

  const listQuery = db
    .select()
    .from(aiPromptTemplates)
    .where(where)
    .orderBy(asc(aiPromptTemplates.sort), desc(aiPromptTemplates.createdAt));

  const [total, list] = await Promise.all([
    db.$count(aiPromptTemplates, where),
    withPagination(listQuery.$dynamic(), page, pageSize),
  ]);
  return { total, list: list.map(mapTemplate), page, pageSize };
}

/** 聊天选择器用：所有启用的可见模板（不分页） */
export async function listChatPromptTemplates() {
  const rows = await db
    .select()
    .from(aiPromptTemplates)
    .where(and(eq(aiPromptTemplates.isEnabled, true), visibilityCond()))
    .orderBy(asc(aiPromptTemplates.sort), asc(aiPromptTemplates.id));
  return rows.map(mapTemplate);
}

async function ensureManageable(id: number) {
  const user = currentUser();
  const [row] = await db.select().from(aiPromptTemplates).where(eq(aiPromptTemplates.id, id));
  if (!row) throw new HTTPException(404, { message: '提示词模板不存在' });
  if (row.scope === 'user' && row.userId !== user.userId) {
    throw new HTTPException(403, { message: '无权操作此模板' });
  }
  return row;
}

export async function getPromptTemplate(id: number) {
  const row = await ensureManageable(id);
  return mapTemplate(row);
}

export async function createPromptTemplate(input: CreateAiPromptTemplateInput) {
  const user = currentUser();
  const scope: AiPromptScope = input.scope ?? 'system';
  const [row] = await db
    .insert(aiPromptTemplates)
    .values({
      name: input.name,
      content: input.content,
      description: input.description ?? null,
      category: input.category ?? null,
      scope,
      userId: scope === 'user' ? user.userId : null,
      sort: input.sort ?? 0,
      isEnabled: input.isEnabled ?? true,
      isBuiltin: false,
    })
    .returning();
  return mapTemplate(row);
}

export async function updatePromptTemplate(id: number, input: UpdateAiPromptTemplateInput) {
  const user = currentUser();
  const existing = await ensureManageable(id);

  let nextScope = existing.scope;
  let nextUserId = existing.userId;
  if (input.scope !== undefined && input.scope !== existing.scope) {
    nextScope = input.scope;
    nextUserId = input.scope === 'user' ? user.userId : null;
  }

  const [row] = await db
    .update(aiPromptTemplates)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.content !== undefined && { content: input.content }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.sort !== undefined && { sort: input.sort }),
      ...(input.isEnabled !== undefined && { isEnabled: input.isEnabled }),
      scope: nextScope,
      userId: nextUserId,
    })
    .where(eq(aiPromptTemplates.id, id))
    .returning();
  return mapTemplate(row);
}

export async function deletePromptTemplate(id: number) {
  const existing = await ensureManageable(id);
  if (existing.isBuiltin) throw new HTTPException(400, { message: '内置预设模板不可删除' });
  await db.delete(aiPromptTemplates).where(eq(aiPromptTemplates.id, id));
}

/**
 * 记录模板被应用为对话角色一次（当前用户可见的启用模板）。
 */
export async function incrementPromptUsage(id: number) {
  const [row] = await db
    .select()
    .from(aiPromptTemplates)
    .where(and(eq(aiPromptTemplates.id, id), eq(aiPromptTemplates.isEnabled, true), visibilityCond()));
  if (!row) throw new HTTPException(404, { message: '提示词模板不存在' });
  await db
    .update(aiPromptTemplates)
    .set({ usageCount: sql`${aiPromptTemplates.usageCount} + 1` })
    .where(eq(aiPromptTemplates.id, id));
}
