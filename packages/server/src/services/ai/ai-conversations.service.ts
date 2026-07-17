import { eq, desc, and, or, ilike, inArray, isNotNull, gt, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../db';
import { aiConversations, aiMessages, users } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime, formatNullableDateTime, formatFileTimestamp, parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import { truncateHistoryByBudget } from '../../lib/ai/tokens';
import { escapeLike, withPagination } from '../../lib/where-helpers';
import { streamToCsv } from '../../lib/excel-export';
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
    knowledgeBaseId: row.knowledgeBaseId,
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
    reasoning: row.reasoning,
    model: row.model,
    tokensInput: row.tokensInput,
    tokensOutput: row.tokensOutput,
    ttftMs: row.ttftMs,
    durationMs: row.durationMs,
    feedback: row.feedback,
    feedbackReason: row.feedbackReason,
    feedbackStatus: row.feedbackStatus,
    feedbackRemark: row.feedbackRemark,
    feedbackHandledAt: formatNullableDateTime(row.feedbackHandledAt),
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function listConversations(opts: { archived?: boolean; keyword?: string; limit?: number; offset?: number } = {}) {
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

  let query = db
    .select()
    .from(aiConversations)
    .where(and(...conds))
    .orderBy(desc(aiConversations.isPinned), desc(aiConversations.updatedAt))
    .$dynamic();
  if (opts.limit !== undefined) query = query.limit(opts.limit);
  if (opts.offset) query = query.offset(opts.offset);
  const rows = await query;
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

export interface AssistantMessageMeta {
  reasoning?: string | null;
  ttftMs?: number | null;
  durationMs?: number | null;
}

export async function saveMessages(
  conversationId: number,
  userContent: string,
  assistantContent: string,
  tokensInput: number,
  tokensOutput: number,
  snapshot: { provider: string; model: string; configId?: number } | null,
  meta: AssistantMessageMeta = {},
) {
  const [, assistantRow] = await db.insert(aiMessages).values([
    { conversationId, role: 'user', content: userContent, tokensInput: 0, tokensOutput: 0 },
    {
      conversationId,
      role: 'assistant',
      content: assistantContent,
      reasoning: meta.reasoning ?? null,
      model: snapshot?.model ?? null,
      tokensInput,
      tokensOutput,
      ttftMs: meta.ttftMs ?? null,
      durationMs: meta.durationMs ?? null,
    },
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
  meta: AssistantMessageMeta = {},
) {
  const [assistantRow] = await db.insert(aiMessages).values({
    conversationId,
    role: 'assistant',
    content: assistantContent,
    reasoning: meta.reasoning ?? null,
    model: snapshot?.model ?? null,
    tokensInput,
    tokensOutput,
    ttftMs: meta.ttftMs ?? null,
    durationMs: meta.durationMs ?? null,
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
 * 管理员：对话内容合规审计检索（跨用户全量消息，支持关键词 / 用户 / 角色 / 时间过滤）。
 */
export async function listAuditMessages(params: {
  page: number;
  pageSize: number;
  keyword?: string;
  userId?: number;
  role?: 'user' | 'assistant';
  startDate?: string;
  endDate?: string;
}) {
  const { page, pageSize } = params;
  const conds = [];
  if (params.keyword?.trim()) {
    conds.push(ilike(aiMessages.content, `%${escapeLike(params.keyword.trim())}%`));
  }
  if (params.role) conds.push(eq(aiMessages.role, params.role));
  if (params.userId) conds.push(eq(aiConversations.userId, params.userId));
  const start = params.startDate ? parseDateRangeStart(params.startDate) : null;
  const end = params.endDate ? parseDateRangeEnd(params.endDate) : null;
  if (start) conds.push(gte(aiMessages.createdAt, start));
  if (end) conds.push(lte(aiMessages.createdAt, end));
  const where = conds.length ? and(...conds) : undefined;

  const baseQuery = db
    .select({
      message: aiMessages,
      conversationTitle: aiConversations.title,
      userId: aiConversations.userId,
      username: users.username,
      nickname: users.nickname,
    })
    .from(aiMessages)
    .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .leftJoin(users, eq(aiConversations.userId, users.id))
    .where(where)
    .orderBy(desc(aiMessages.createdAt), desc(aiMessages.id));

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiMessages)
    .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .where(where);

  const [countRows, list] = await Promise.all([
    countQuery,
    withPagination(baseQuery.$dynamic(), page, pageSize),
  ]);
  return {
    total: countRows[0]?.count ?? 0,
    list: list.map((row) => ({
      ...mapMessage(row.message),
      conversationTitle: row.conversationTitle ?? null,
      userId: row.userId ?? null,
      username: row.username ?? null,
      nickname: row.nickname ?? null,
      question: null,
    })),
    page,
    pageSize,
  };
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
 * 管理员：列出所有有反馈的 assistant 消息（分页，支持按反馈类型/处理状态/模型/时间范围筛选），
 * 附带反馈人、所属会话标题与该回复之前最近一条用户提问。
 */
export async function listFeedbackMessages(params: {
  page: number;
  pageSize: number;
  feedback?: 1 | -1;
  status?: AiFeedbackStatus;
  model?: string;
  startDate?: string;
  endDate?: string;
}) {
  const { page, pageSize } = params;
  const where = feedbackConds(params);
  const listQuery = feedbackSelect().where(where).orderBy(desc(aiMessages.createdAt), desc(aiMessages.id));
  const [total, list] = await Promise.all([
    db.$count(aiMessages, where),
    withPagination(listQuery.$dynamic(), page, pageSize),
  ]);
  return { total, list: list.map(mapFeedbackRow), page, pageSize };
}

/** 该 assistant 消息之前最近一条 user 提问（相关子查询） */
const QUESTION_EXPR = sql<string | null>`(
  select um.content from ai_messages um
  where um.conversation_id = ${aiMessages.conversationId}
    and um.role = 'user'
    and um.id < ${aiMessages.id}
  order by um.id desc
  limit 1
)`;

function feedbackConds(params: {
  feedback?: 1 | -1;
  status?: AiFeedbackStatus;
  model?: string;
  startDate?: string;
  endDate?: string;
}) {
  const conds = [isNotNull(aiMessages.feedback), eq(aiMessages.role, 'assistant')];
  if (params.feedback === 1 || params.feedback === -1) conds.push(eq(aiMessages.feedback, params.feedback));
  if (params.status) conds.push(eq(aiMessages.feedbackStatus, params.status));
  if (params.model?.trim()) conds.push(eq(aiMessages.model, params.model.trim()));
  const start = params.startDate ? parseDateRangeStart(params.startDate) : null;
  const end = params.endDate ? parseDateRangeEnd(params.endDate) : null;
  if (start) conds.push(gte(aiMessages.createdAt, start));
  if (end) conds.push(lte(aiMessages.createdAt, end));
  return and(...conds);
}

function feedbackSelect() {
  return db
    .select({
      message: aiMessages,
      conversationTitle: aiConversations.title,
      userId: aiConversations.userId,
      username: users.username,
      nickname: users.nickname,
      question: QUESTION_EXPR,
    })
    .from(aiMessages)
    .leftJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .leftJoin(users, eq(aiConversations.userId, users.id));
}

type FeedbackRow = {
  message: typeof aiMessages.$inferSelect;
  conversationTitle: string | null;
  userId: number | null;
  username: string | null;
  nickname: string | null;
  question: string | null;
};

function mapFeedbackRow(row: FeedbackRow) {
  return {
    ...mapMessage(row.message),
    conversationTitle: row.conversationTitle ?? null,
    userId: row.userId ?? null,
    username: row.username ?? null,
    nickname: row.nickname ?? null,
    question: row.question ?? null,
  };
}

/**
 * 管理员：查看反馈消息的会话上下文（目标消息前 N 条 + 后 M 条）。
 */
export async function getFeedbackContext(msgId: number, before = 8, after = 2) {
  const [msg] = await db.select().from(aiMessages).where(eq(aiMessages.id, msgId));
  if (!msg) throw new HTTPException(404, { message: '消息不存在' });
  const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, msg.conversationId));

  const [prevRows, nextRows] = await Promise.all([
    db.select().from(aiMessages)
      .where(and(eq(aiMessages.conversationId, msg.conversationId), lte(aiMessages.id, msg.id)))
      .orderBy(desc(aiMessages.createdAt), desc(aiMessages.id))
      .limit(before + 1),
    db.select().from(aiMessages)
      .where(and(eq(aiMessages.conversationId, msg.conversationId), gt(aiMessages.id, msg.id)))
      .orderBy(aiMessages.createdAt, aiMessages.id)
      .limit(after),
  ]);
  const messages = [...prevRows.reverse(), ...nextRows].map(mapMessage);
  return {
    conversationId: msg.conversationId,
    conversationTitle: conv?.title ?? null,
    targetMsgId: msg.id,
    messages,
  };
}

/**
 * 管理员：导出反馈列表 CSV（与列表筛选一致，上限 10000 条）。
 */
export async function exportFeedbackMessages(params: {
  feedback?: 1 | -1;
  status?: AiFeedbackStatus;
  model?: string;
  startDate?: string;
  endDate?: string;
}) {
  const rows = await feedbackSelect()
    .where(feedbackConds(params))
    .orderBy(desc(aiMessages.createdAt), desc(aiMessages.id))
    .limit(10000);
  const list = rows.map(mapFeedbackRow);
  const statusLabel: Record<string, string> = { pending: '待处理', resolved: '已处理', ignored: '已忽略' };
  const stream = streamToCsv(
    [
      { header: '消息 ID', key: 'id' },
      { header: '反馈', key: 'feedback', transform: (v) => (v === 1 ? '点赞' : '点踩') },
      { header: '处理状态', key: 'feedbackStatus', transform: (v) => statusLabel[v as string] ?? '' },
      { header: '点踩原因', key: 'feedbackReason' },
      { header: '模型', key: 'model' },
      { header: '反馈用户', key: 'username' },
      { header: '用户昵称', key: 'nickname' },
      { header: '对话标题', key: 'conversationTitle' },
      { header: '用户提问', key: 'question' },
      { header: 'AI 回复', key: 'content' },
      { header: '处理备注', key: 'feedbackRemark' },
      { header: '反馈时间', key: 'createdAt' },
      { header: '处理时间', key: 'feedbackHandledAt' },
    ],
    list,
  );
  return { stream, filename: `ai-feedback-${formatFileTimestamp(new Date())}.csv` };
}
