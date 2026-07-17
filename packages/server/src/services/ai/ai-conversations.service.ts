import { eq, desc, and, or, ilike, inArray, isNotNull, gt, gte } from 'drizzle-orm';
import { db } from '../../db';
import { aiConversations, aiMessages } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { truncateHistoryByBudget } from '../../lib/ai/tokens';
import { escapeLike, withPagination } from '../../lib/where-helpers';
import { HTTPException } from 'hono/http-exception';
import type { AiFeedbackStatus } from '@zenith/shared';

function mapConversation(row: typeof aiConversations.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    title: row.title,
    providerSnapshot: row.providerSnapshot,
    isArchived: row.isArchived,
    isPinned: row.isPinned,
    systemPromptOverride: row.systemPromptOverride,
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
    model: row.model,
    tokensInput: row.tokensInput,
    tokensOutput: row.tokensOutput,
    feedback: row.feedback,
    feedbackReason: row.feedbackReason,
    feedbackStatus: row.feedbackStatus,
    feedbackRemark: row.feedbackRemark,
    feedbackHandledAt: formatNullableDateTime(row.feedbackHandledAt),
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function listConversations(opts: { archived?: boolean; keyword?: string } = {}) {
  const user = currentUser();
  const archived = opts.archived ?? false;
  const keyword = opts.keyword?.trim();

  const conds = [
    eq(aiConversations.userId, user.userId),
    eq(aiConversations.isArchived, archived),
  ];

  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    // 命中条件：对话标题匹配，或对话内存在内容匹配的消息
    const matchedConvIds = db
      .select({ id: aiMessages.conversationId })
      .from(aiMessages)
      .where(ilike(aiMessages.content, kw));
    conds.push(or(ilike(aiConversations.title, kw), inArray(aiConversations.id, matchedConvIds))!);
  }

  const rows = await db
    .select()
    .from(aiConversations)
    .where(and(...conds))
    .orderBy(desc(aiConversations.isPinned), desc(aiConversations.updatedAt));
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
    .orderBy(aiMessages.createdAt, aiMessages.id);
  return rows.map(mapMessage);
}

export async function updateConversationTitle(id: number, title: string) {
  const user = currentUser();
  await db
    .update(aiConversations)
    .set({ title: title.slice(0, 200) })
    .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, user.userId)));
}

export async function renameConversation(id: number, title: string) {
  const row = await ensureConversationOwner(id);
  if (!row) return;
  await db
    .update(aiConversations)
    .set({ title: title.trim().slice(0, 200) || '新对话' })
    .where(eq(aiConversations.id, id));
}

export async function togglePinConversation(id: number) {
  const row = await ensureConversationOwner(id);
  await db
    .update(aiConversations)
    .set({ isPinned: !row.isPinned })
    .where(eq(aiConversations.id, id));
  return !row.isPinned;
}

export async function toggleArchiveConversation(id: number) {
  const row = await ensureConversationOwner(id);
  await db
    .update(aiConversations)
    .set({ isArchived: !row.isArchived, isPinned: false })
    .where(eq(aiConversations.id, id));
  return !row.isArchived;
}

/** 设置 / 清除对话级提示词（角色模板），传 null 清除 */
export async function setConversationSystemPrompt(id: number, systemPrompt: string | null) {
  await ensureConversationOwner(id);
  const value = systemPrompt?.trim() ? systemPrompt.trim().slice(0, 5000) : null;
  await db
    .update(aiConversations)
    .set({ systemPromptOverride: value })
    .where(eq(aiConversations.id, id));
  return value;
}

/** 导出对话为 Markdown / JSON（仅会话所有者） */
export async function exportConversation(id: number, format: 'md' | 'json') {
  const conv = await ensureConversationOwner(id);
  const rows = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, id))
    .orderBy(aiMessages.createdAt);
  const safeTitle = (conv.title || '对话').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);

  if (format === 'json') {
    const content = JSON.stringify(
      {
        id: conv.id,
        title: conv.title,
        createdAt: formatDateTime(conv.createdAt),
        messages: rows.map((m) => ({
          role: m.role,
          content: m.content,
          model: m.model,
          createdAt: formatDateTime(m.createdAt),
        })),
      },
      null,
      2,
    );
    return { content, filename: `${safeTitle}.json`, contentType: 'application/json; charset=utf-8' };
  }

  const lines: string[] = [`# ${conv.title}`, '', `> 导出时间：${formatDateTime(new Date())}`, ''];
  for (const m of rows) {
    const label = m.role === 'user' ? '🧑 用户' : m.role === 'assistant' ? '🤖 助手' : '⚙️ 系统';
    const suffix = m.model ? `（${m.model}）` : '';
    lines.push(`## ${label}${suffix}`, '', m.content, '');
  }
  return { content: lines.join('\n'), filename: `${safeTitle}.md`, contentType: 'text/markdown; charset=utf-8' };
}

export async function saveMessages(
  conversationId: number,
  userContent: string,
  assistantContent: string,
  tokensInput: number,
  tokensOutput: number,
  snapshot: { provider: string; model: string; configId?: number } | null,
) {
  const [, assistantRow] = await db.insert(aiMessages).values([
    { conversationId, role: 'user', content: userContent, tokensInput: 0, tokensOutput: 0 },
    { conversationId, role: 'assistant', content: assistantContent, model: snapshot?.model ?? null, tokensInput, tokensOutput },
  ]).returning({ id: aiMessages.id });
  if (snapshot) {
    await db.update(aiConversations).set({ providerSnapshot: snapshot }).where(eq(aiConversations.id, conversationId));
  }
  return { assistantMsgId: assistantRow?.id ?? null };
}

/**
 * 仅保存 assistant 消息（重新生成场景：user 消息已存在，避免重复入库）。
 */
export async function saveAssistantMessage(
  conversationId: number,
  assistantContent: string,
  tokensInput: number,
  tokensOutput: number,
  snapshot: { provider: string; model: string; configId?: number } | null,
) {
  const [assistantRow] = await db.insert(aiMessages).values({
    conversationId,
    role: 'assistant',
    content: assistantContent,
    model: snapshot?.model ?? null,
    tokensInput,
    tokensOutput,
  }).returning({ id: aiMessages.id });
  if (snapshot) {
    await db.update(aiConversations).set({ providerSnapshot: snapshot }).where(eq(aiConversations.id, conversationId));
  }
  return { assistantMsgId: assistantRow?.id ?? null };
}

/**
 * 重新生成前校验：对话最后一条消息必须是 user（旧的 assistant 回复应已删除）。
 * 返回 false 表示没有可供重新生成的用户消息。
 */
export async function hasTrailingUserMessage(conversationId: number) {
  const [last] = await db
    .select({ role: aiMessages.role })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(desc(aiMessages.createdAt), desc(aiMessages.id))
    .limit(1);
  return last?.role === 'user';
}

export async function getHistoryMessages(
  conversationId: number,
  options: { maxTokens?: number; maxCount?: number } = {},
) {
  const maxCount = options.maxCount ?? 50;
  const rows = await db
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(desc(aiMessages.createdAt), desc(aiMessages.id))
    .limit(maxCount);
  // rows 为时间倒序；按 token 预算裁剪后返回时间升序
  return truncateHistoryByBudget(rows, { maxTokens: options.maxTokens });
}

/**
 * 删除指定消息（用于重新生成：删除最后的 assistant 消息后重发）。
 * 只允许删除 assistant 消息；会话所有者限制。
 */
export async function deleteMessage(conversationId: number, messageId: number) {
  await ensureConversationOwner(conversationId);
  const [msg] = await db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.id, messageId), eq(aiMessages.conversationId, conversationId)));
  if (!msg) throw new HTTPException(404, { message: '消息不存在' });
  if (msg.role !== 'assistant') throw new HTTPException(400, { message: '只能删除 AI 回复消息' });
  await db.delete(aiMessages).where(eq(aiMessages.id, messageId));
}

/**
 * 删除一条消息及其之后的所有消息（用于 UI 消息删除操作）。
 * user/assistant 消息均支持；会话所有者限制。
 */
export async function deleteMessageCascade(conversationId: number, messageId: number) {
  await ensureConversationOwner(conversationId);
  const [msg] = await db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.id, messageId), eq(aiMessages.conversationId, conversationId)));
  if (!msg) throw new HTTPException(404, { message: '消息不存在' });
  // 删除该消息及之后所有消息（createdAt 相同时以 id 区分先后，避免误删同批写入的更早消息）
  await db.delete(aiMessages).where(
    and(
      eq(aiMessages.conversationId, conversationId),
      or(
        gt(aiMessages.createdAt, msg.createdAt),
        and(eq(aiMessages.createdAt, msg.createdAt), gte(aiMessages.id, msg.id)),
      ),
    )
  );
}

/**
 * 给 assistant 消息提交用户反馈（点赞 +1 / 点踩 -1 / 撤销 null）。
 * 只允许对 assistant 消息打分；会话所有者限制。
 */
export async function submitMessageFeedback(conversationId: number, messageId: number, feedback: 1 | -1 | null, reason?: string | null) {
  await ensureConversationOwner(conversationId);
  const [msg] = await db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.id, messageId), eq(aiMessages.conversationId, conversationId)));
  if (!msg) throw new HTTPException(404, { message: '消息不存在' });
  if (msg.role !== 'assistant') throw new HTTPException(400, { message: '只能对 AI 回复打分' });
  const isDislike = feedback === -1;
  await db.update(aiMessages).set({
    feedback,
    feedbackReason: isDislike ? (reason?.trim() || null) : null,
    feedbackStatus: isDislike ? 'pending' : null,
    feedbackRemark: null,
    feedbackHandledAt: null,
  }).where(eq(aiMessages.id, messageId));
}

/**
 * 管理员：更新反馈处理状态与备注（处理闭环）。
 */
export async function updateFeedbackStatus(messageId: number, status: AiFeedbackStatus, remark?: string | null) {
  const [msg] = await db.select().from(aiMessages).where(eq(aiMessages.id, messageId));
  if (!msg) throw new HTTPException(404, { message: '消息不存在' });
  if (msg.feedback === null) throw new HTTPException(400, { message: '该消息没有用户反馈' });
  await db.update(aiMessages).set({
    feedbackStatus: status,
    feedbackRemark: remark?.trim() || null,
    feedbackHandledAt: new Date(),
  }).where(eq(aiMessages.id, messageId));
}

/**
 * 管理员：列出所有有反馈的 assistant 消息（分页，支持按反馈类型/处理状态筛选）。
 */
export async function listFeedbackMessages(params: {
  page: number;
  pageSize: number;
  feedback?: 1 | -1;
  status?: AiFeedbackStatus;
}) {
  const { page, pageSize, feedback, status } = params;
  const conds = [isNotNull(aiMessages.feedback), eq(aiMessages.role, 'assistant')];
  if (feedback === 1 || feedback === -1) conds.push(eq(aiMessages.feedback, feedback));
  if (status) conds.push(eq(aiMessages.feedbackStatus, status));
  const where = and(...conds);
  const listQuery = db.select().from(aiMessages).where(where).orderBy(desc(aiMessages.createdAt));
  const [total, list] = await Promise.all([
    db.$count(aiMessages, where),
    withPagination(listQuery.$dynamic(), page, pageSize),
  ]);
  return { total, list: list.map(mapMessage), page, pageSize };
}
