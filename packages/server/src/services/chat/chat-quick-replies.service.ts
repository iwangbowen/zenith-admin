import { and, asc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { chatQuickReplies } from '../../db/schema';
import type { ChatQuickReplyRow } from '../../db/schema/chat';
import { currentUser } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime } from '../../lib/datetime';
import type { ChatQuickReply } from '@zenith/shared/chat';

const MAX_QUICK_REPLIES = 50;

function mapQuickReply(row: ChatQuickReplyRow): ChatQuickReply {
  return {
    id: row.id,
    content: row.content,
    sort: row.sort,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 我的常用语列表 */
export async function listMyQuickReplies(): Promise<ChatQuickReply[]> {
  const me = currentUser();
  const rows = await db.query.chatQuickReplies.findMany({
    where: eq(chatQuickReplies.userId, me.userId),
    orderBy: [asc(chatQuickReplies.sort), asc(chatQuickReplies.id)],
  });
  return rows.map(mapQuickReply);
}

/** 新增常用语（每人上限 50 条） */
export async function createQuickReply(content: string, sort?: number): Promise<ChatQuickReply> {
  const me = currentUser();
  const count = await db.$count(chatQuickReplies, eq(chatQuickReplies.userId, me.userId));
  if (count >= MAX_QUICK_REPLIES) {
    throw new HTTPException(400, { message: `常用语最多 ${MAX_QUICK_REPLIES} 条` });
  }
  const [row] = await db.insert(chatQuickReplies).values({
    userId: me.userId,
    content,
    sort: sort ?? 0,
  }).returning();
  return mapQuickReply(row);
}

async function ensureMyQuickReply(id: number): Promise<ChatQuickReplyRow> {
  const me = currentUser();
  const row = await db.query.chatQuickReplies.findFirst({
    where: and(eq(chatQuickReplies.id, id), eq(chatQuickReplies.userId, me.userId)),
  });
  return requireRow(row, '常用语不存在');
}

/** 更新常用语（仅本人） */
export async function updateQuickReply(id: number, input: { content?: string; sort?: number }): Promise<ChatQuickReply> {
  await ensureMyQuickReply(id);
  const [row] = await db.update(chatQuickReplies)
    .set({
      ...(input.content === undefined ? {} : { content: input.content }),
      ...(input.sort === undefined ? {} : { sort: input.sort }),
    })
    .where(eq(chatQuickReplies.id, id))
    .returning();
  return mapQuickReply(row);
}

/** 删除常用语（仅本人） */
export async function deleteQuickReply(id: number): Promise<void> {
  await ensureMyQuickReply(id);
  await db.delete(chatQuickReplies).where(eq(chatQuickReplies.id, id));
}
