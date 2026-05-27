import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db';
import { aiConversations, aiMessages } from '../db/schema';
import { currentUser } from '../lib/context';
import { formatDateTime } from '../lib/datetime';
import { HTTPException } from 'hono/http-exception';

function mapConversation(row: typeof aiConversations.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    title: row.title,
    providerSnapshot: row.providerSnapshot,
    isArchived: row.isArchived,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function mapMessage(row: typeof aiMessages.$inferSelect) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    tokensInput: row.tokensInput,
    tokensOutput: row.tokensOutput,
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function listConversations() {
  const user = currentUser();
  const rows = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.userId, user.userId), eq(aiConversations.isArchived, false)))
    .orderBy(desc(aiConversations.updatedAt));
  return rows.map(mapConversation);
}

export async function createConversation(input: { title?: string } = {}) {
  const user = currentUser();
  const [row] = await db
    .insert(aiConversations)
    .values({
      userId: user.userId,
      tenantId: user.tenantId ?? null,
      title: input.title?.trim() || '新对话',
    })
    .returning();
  return mapConversation(row);
}

export async function ensureConversationOwner(id: number) {
  const user = currentUser();
  const [row] = await db.select().from(aiConversations).where(eq(aiConversations.id, id));
  if (!row) throw new HTTPException(404, { message: '对话不存在' });
  if (row.userId !== user.userId) throw new HTTPException(403, { message: '无权访问此对话' });
  return row;
}

export async function getConversation(id: number) {
  const row = await ensureConversationOwner(id);
  return mapConversation(row);
}

export async function deleteConversation(id: number) {
  await ensureConversationOwner(id);
  await db.delete(aiConversations).where(eq(aiConversations.id, id));
}

export async function listMessages(conversationId: number) {
  await ensureConversationOwner(conversationId);
  const rows = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(aiMessages.createdAt);
  return rows.map(mapMessage);
}

export async function updateConversationTitle(id: number, title: string) {
  const user = currentUser();
  await db
    .update(aiConversations)
    .set({ title: title.slice(0, 200) })
    .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, user.userId)));
}

export async function saveMessages(
  conversationId: number,
  userContent: string,
  assistantContent: string,
  tokensInput: number,
  tokensOutput: number,
  snapshot: { provider: string; model: string; configId?: number } | null,
) {
  await db.insert(aiMessages).values([
    { conversationId, role: 'user', content: userContent, tokensInput: 0, tokensOutput: 0 },
    { conversationId, role: 'assistant', content: assistantContent, tokensInput, tokensOutput },
  ]);
  if (snapshot) {
    await db.update(aiConversations).set({ providerSnapshot: snapshot }).where(eq(aiConversations.id, conversationId));
  }
}

export async function getHistoryMessages(conversationId: number, limit = 20) {
  const rows = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(desc(aiMessages.createdAt))
    .limit(limit);
  // 按时间升序返回
  return rows.reverse().map((r) => ({ role: r.role as 'system' | 'user' | 'assistant', content: r.content }));
}
