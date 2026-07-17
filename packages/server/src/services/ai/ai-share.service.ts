import { eq, and } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '../../db';
import { aiSharedConversations, aiMessages, aiConversations } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { ensureConversationOwner } from './ai-conversations.service';
import { HTTPException } from 'hono/http-exception';
import dayjs from 'dayjs';

function mapShare(row: typeof aiSharedConversations.$inferSelect) {
  return {
    token: row.token,
    url: `/public/ai-chat/${row.token}`,
    expiresAt: formatNullableDateTime(row.expiresAt),
    createdAt: formatDateTime(row.createdAt),
  };
}

/** 创建（或重建）对话分享链接；expiresDays = 0 表示永久 */
export async function shareConversation(conversationId: number, expiresDays: number) {
  const user = currentUser();
  await ensureConversationOwner(conversationId);
  // 同一对话只保留一个有效分享：重建时删除旧的
  await db.delete(aiSharedConversations).where(eq(aiSharedConversations.conversationId, conversationId));
  const token = randomBytes(24).toString('base64url');
  const [row] = await db
    .insert(aiSharedConversations)
    .values({
      token,
      conversationId,
      userId: user.userId,
      expiresAt: expiresDays > 0 ? dayjs().add(expiresDays, 'day').toDate() : null,
    })
    .returning();
  return mapShare(row);
}

/** 查询对话当前的分享状态（无分享返回 null） */
export async function getConversationShare(conversationId: number) {
  await ensureConversationOwner(conversationId);
  const [row] = await db
    .select()
    .from(aiSharedConversations)
    .where(eq(aiSharedConversations.conversationId, conversationId));
  return row ? mapShare(row) : null;
}

/** 取消对话分享 */
export async function revokeConversationShare(conversationId: number) {
  await ensureConversationOwner(conversationId);
  await db.delete(aiSharedConversations).where(eq(aiSharedConversations.conversationId, conversationId));
}

/** 公开访问：按 token 读取只读对话内容（校验过期；不暴露用户信息与反馈字段） */
export async function getSharedConversation(token: string) {
  const [share] = await db
    .select()
    .from(aiSharedConversations)
    .where(eq(aiSharedConversations.token, token));
  if (!share) throw new HTTPException(404, { message: '分享不存在或已取消' });
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
    throw new HTTPException(410, { message: '分享链接已过期' });
  }
  const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, share.conversationId));
  if (!conv) throw new HTTPException(404, { message: '对话不存在' });
  const messages = await db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.conversationId, conv.id)))
    .orderBy(aiMessages.createdAt, aiMessages.id);
  return {
    title: conv.title,
    sharedAt: formatDateTime(share.createdAt),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      reasoning: m.reasoning,
      model: m.model,
      createdAt: formatDateTime(m.createdAt),
    })),
  };
}
