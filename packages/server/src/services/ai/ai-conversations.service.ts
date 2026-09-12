import { eq, desc, and, or, inArray, isNotNull, gt, lte, sql, arrayContains } from 'drizzle-orm';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { db } from '../../db';
import { aiConversations, aiMessages, users } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime, formatNullableDateTime, formatFileTimestamp } from '../../lib/datetime';
import { buildWhere, dateRangeConditions, withPagination, keywordCondition } from '../../lib/where-helpers';
import { streamToCsv } from '../../lib/excel-export';
import { HTTPException } from 'hono/http-exception';
import { resolveAgentForChat, incrementAgentUsage } from './ai-agents.service';
import type { QueryOutputOf } from '@zenith/shared/core';
import { aiAuditContract, aiConversationContract, buildChildrenMap, buildEffectiveParents, descendToLeaf, resolveActivePath, resolveAncestorPath, sortMessagesByTime, type AiFeedbackStatus, type BranchTreeNode } from '@zenith/shared/ai';

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
    agentId: row.agentId,
    tags: row.tags ?? [],
    activeLeafMsgId: row.activeLeafMsgId,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function mapMessage(row: typeof aiMessages.$inferSelect) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    parentId: row.parentId,
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
    trace: row.trace,
    toolCalls: row.toolCalls ?? null,
    references: row.kbReferences ?? null,
    images: row.images ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

// ─── 消息分支树 ───────────────────────────────────────────────────────────────
// 算法与前端共用 @zenith/shared/ai/branch-tree：服务端在落库行上推导有效父节点并对外输出，
// 前端在 API 返回行上复用同一实现，两侧不再各自维护一份。

interface MsgNode extends BranchTreeNode {
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: Date;
}


async function loadMsgNodes(conversationId: number): Promise<MsgNode[]> {
  return db
    .select({
      id: aiMessages.id,
      parentId: aiMessages.parentId,
      role: aiMessages.role,
      content: aiMessages.content,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(aiMessages.createdAt, aiMessages.id);
}

/** 当前激活路径的叶子消息 ID（发送新消息时作为 user 消息的父节点） */
export async function getActivePathLeafId(conversationId: number, activeLeafMsgId: number | null): Promise<number | null> {
  const rows = await loadMsgNodes(conversationId);
  const path = resolveActivePath(rows, activeLeafMsgId);
  return path.length > 0 ? path[path.length - 1].id : null;
}

/** 激活路径末条 user 消息 ID（重新生成时 assistant 兄弟分支的父节点） */
export async function getActivePathLastUserId(conversationId: number, activeLeafMsgId: number | null): Promise<number | null> {
  const rows = await loadMsgNodes(conversationId);
  const path = resolveActivePath(rows, activeLeafMsgId);
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].role === 'user') return path[i].id;
  }
  return null;
}

/** 切换分支：以任意消息为起点沿最新子分支下探到叶子并激活 */
export async function switchConversationBranch(conversationId: number, msgId: number): Promise<number> {
  const conv = await ensureConversationOwner(conversationId);
  const rows = await loadMsgNodes(conversationId);
  if (!rows.some((r) => r.id === msgId)) throw new HTTPException(404, { message: '消息不存在' });
  const leafId = descendToLeaf(rows, msgId);
  await db.update(aiConversations).set({ activeLeafMsgId: leafId }).where(eq(aiConversations.id, conversationId));
  // Mastra thread 镜像同步为新激活路径(下一轮生成的上下文来源)
  const { rebuildThreadMirror } = await import('./ai-memory.service');
  await rebuildThreadMirror(conversationId, conv.userId, { activeLeafMsgId: leafId });
  return leafId;
}

export async function listConversations(opts: { archived?: boolean; keyword?: string; tag?: string; limit?: number; offset?: number } = {}) {
  const user = currentUser();
  const archived = opts.archived ?? false;
  const keyword = opts.keyword?.trim();
  const tag = opts.tag?.trim();

  // 命中条件：对话标题匹配，或对话内存在内容匹配的消息
  const matchedConvIds = db
    .select({ id: aiMessages.conversationId })
    .from(aiMessages)
    .where(keywordCondition(keyword, [aiMessages.content], 'ilike'));
  const where = buildWhere(
    eq(aiConversations.userId, user.userId),
    eq(aiConversations.isArchived, archived),
    tag ? arrayContains(aiConversations.tags, [tag]) : undefined,
    keyword ? or(keywordCondition(keyword, [aiConversations.title], 'ilike'), inArray(aiConversations.id, matchedConvIds)) : undefined,
  );

  let query = db
    .select()
    .from(aiConversations)
    .where(where)
    .orderBy(desc(aiConversations.isPinned), desc(aiConversations.updatedAt))
    .$dynamic();
  if (opts.limit !== undefined) query = query.limit(opts.limit);
  if (opts.offset) query = query.offset(opts.offset);
  const rows = await query;
  return rows.map(mapConversation);
}

export async function createConversation(input: { title?: string; agentId?: number } = {}) {
  const user = currentUser();
  let agentId: number | null = null;
  let title = input.title?.trim() || '新对话';
  if (input.agentId) {
    const agent = requireRow(await resolveAgentForChat(input.agentId, user.userId), '智能体不存在或未上架');
    agentId = agent.id;
    if (!input.title) title = agent.name;
  }
  const [row] = await db
    .insert(aiConversations)
    .values({
      userId: user.userId,
      tenantId: user.tenantId ?? null,
      title,
      agentId,
    })
    .returning();
  if (agentId) incrementAgentUsage(agentId).catch(() => {});
  return mapConversation(row);
}

export async function ensureConversationOwner(id: number) {
  const user = currentUser();
  const [row] = await db.select().from(aiConversations).where(eq(aiConversations.id, id));
  requireRow(row, '对话不存在');
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
  // Mastra thread 镜像随对话删除(失败不阻塞)
  const { deleteThreadMirror } = await import('./ai-memory.service');
  void deleteThreadMirror(id);
}

export async function listMessages(conversationId: number) {
  await ensureConversationOwner(conversationId);
  const rows = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(aiMessages.createdAt, aiMessages.id);
  // 对外统一输出"有效父节点"（legacy 线性数据按时间序推导），前端据此构建分支树
  const parents = buildEffectiveParents(rows);
  return rows.map((r) => ({ ...mapMessage(r), parentId: parents.get(r.id) ?? null }));
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

/** 更新对话标签 */
export async function updateConversationTags(id: number, tags: string[]) {
  await ensureConversationOwner(id);
  const cleaned = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 10);
  await db.update(aiConversations).set({ tags: cleaned }).where(eq(aiConversations.id, id));
  return cleaned;
}

/** 导出对话为 Markdown / JSON（仅会话所有者；仅导出当前激活分支路径） */
export async function exportConversation(id: number, format: 'md' | 'json') {
  const conv = await ensureConversationOwner(id);
  const allRows = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, id))
    .orderBy(aiMessages.createdAt);
  const pathIds = new Set(
    resolveActivePath(
      allRows.map((r) => ({ id: r.id, parentId: r.parentId, role: r.role, content: '', createdAt: r.createdAt })),
      conv.activeLeafMsgId,
    ).map((n) => n.id),
  );
  const rows = allRows.filter((r) => pathIds.has(r.id));
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
  trace?: import('../../db/schema').AiTraceStep[] | null;
  /** 工具调用过程（展示用途,与 SSE tool_call 事件同构） */
  toolCalls?: { name: string; arguments: string; result: string }[] | null;
  /** 知识库检索引用（展示用途,与 SSE references 事件同构） */
  kbReferences?: { docName: string; content: string; score: number }[] | null;
}

export async function saveMessages(
  conversationId: number,
  userContent: string,
  assistantContent: string,
  tokensInput: number,
  tokensOutput: number,
  snapshot: { providerId: string; model: string; configId?: number } | null,
  meta: AssistantMessageMeta = {},
  /** user 消息的分支树父节点（发送时的激活叶子；编辑重发时为被编辑消息的父节点） */
  userParentId: number | null = null,
  /** user 消息附带的图片（managed file id 数组） */
  userImages: string[] | null = null,
) {
  const [userRow] = await db.insert(aiMessages).values(
    { conversationId, parentId: userParentId, role: 'user', content: userContent, tokensInput: 0, tokensOutput: 0, images: userImages },
  ).returning({ id: aiMessages.id });
  const [assistantRow] = await db.insert(aiMessages).values(
    {
      conversationId,
      parentId: userRow?.id ?? null,
      role: 'assistant',
      content: assistantContent,
      reasoning: meta.reasoning ?? null,
      model: snapshot?.model ?? null,
      tokensInput,
      tokensOutput,
      ttftMs: meta.ttftMs ?? null,
      durationMs: meta.durationMs ?? null,
      trace: meta.trace ?? null,
      toolCalls: meta.toolCalls ?? null,
      kbReferences: meta.kbReferences ?? null,
    },
  ).returning({ id: aiMessages.id });
  await db
    .update(aiConversations)
    .set({ activeLeafMsgId: assistantRow?.id ?? null, ...(snapshot ? { providerSnapshot: snapshot } : {}) })
    .where(eq(aiConversations.id, conversationId));
  return { userMsgId: userRow?.id ?? null, assistantMsgId: assistantRow?.id ?? null };
}

/**
 * 仅保存 assistant 消息（重新生成场景：父节点为激活路径末条 user 消息，成为兄弟分支）。
 */
export async function saveAssistantMessage(
  conversationId: number,
  assistantContent: string,
  tokensInput: number,
  tokensOutput: number,
  snapshot: { providerId: string; model: string; configId?: number } | null,
  meta: AssistantMessageMeta = {},
  parentId: number | null = null,
) {
  const [assistantRow] = await db.insert(aiMessages).values({
    conversationId,
    parentId,
    role: 'assistant',
    content: assistantContent,
    reasoning: meta.reasoning ?? null,
    model: snapshot?.model ?? null,
    tokensInput,
    tokensOutput,
    ttftMs: meta.ttftMs ?? null,
    durationMs: meta.durationMs ?? null,
    trace: meta.trace ?? null,
    toolCalls: meta.toolCalls ?? null,
    kbReferences: meta.kbReferences ?? null,
  }).returning({ id: aiMessages.id });
  await db
    .update(aiConversations)
    .set({ activeLeafMsgId: assistantRow?.id ?? null, ...(snapshot ? { providerSnapshot: snapshot } : {}) })
    .where(eq(aiConversations.id, conversationId));
  return { assistantMsgId: assistantRow?.id ?? null };
}

/**
 * 重新生成前校验：激活路径最后一条消息必须是 user 消息（或存在可回溯的 user 消息）。
 */
export async function hasTrailingUserMessage(conversationId: number, activeLeafMsgId: number | null = null) {
  const rows = await loadMsgNodes(conversationId);
  const path = resolveActivePath(rows, activeLeafMsgId);
  return path.length > 0 && path[path.length - 1].role === 'user';
}

/** 激活路径原始消息(Mastra thread 镜像回放用,不做 token 裁剪) */
export async function getActivePathRaw(
  conversationId: number,
  options: { activeLeafMsgId?: number | null; upToMsgId?: number | null } = {},
): Promise<Array<{ id: number; role: 'system' | 'user' | 'assistant'; content: string; createdAt: Date }>> {
  const nodes = await loadMsgNodes(conversationId);
  const path = options.upToMsgId
    ? resolveAncestorPath(nodes, options.upToMsgId)
    : resolveActivePath(nodes, options.activeLeafMsgId ?? null);
  return path.map((n) => ({ id: n.id, role: n.role, content: n.content, createdAt: n.createdAt }));
}

/**
 * 删除指定消息（用于重新生成：删除最后的 assistant 消息后重发）。
 * 只允许删除 assistant 消息；会话所有者限制。
 */
export async function deleteMessage(conversationId: number, messageId: number) {
  const conv = await ensureConversationOwner(conversationId);
  const [msg] = await db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.id, messageId), eq(aiMessages.conversationId, conversationId)));
  requireRow(msg, '消息不存在');
  if (msg.role !== 'assistant') throw new HTTPException(400, { message: '只能删除 AI 回复消息' });
  await db.delete(aiMessages).where(eq(aiMessages.id, messageId));
  const { rebuildThreadMirror } = await import('./ai-memory.service');
  await rebuildThreadMirror(conversationId, conv.userId, { activeLeafMsgId: conv.activeLeafMsgId });
}

/**
 * 删除一条消息及其整个子树（所有后代分支）。
 * 若激活叶子位于被删子树内，激活分支回退到被删节点的父链最新叶子。
 */
export async function deleteMessageCascade(conversationId: number, messageId: number) {
  const conv = await ensureConversationOwner(conversationId);
  const nodes = await loadMsgNodes(conversationId);
  if (!nodes.some((n) => n.id === messageId)) throw new HTTPException(404, { message: '消息不存在' });

  // BFS 收集子树（基于有效父节点）
  const children = buildChildrenMap(nodes);
  const toDelete = new Set<number>([messageId]);
  const queue = [messageId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const kid of children.get(cur) ?? []) {
      if (!toDelete.has(kid.id)) {
        toDelete.add(kid.id);
        queue.push(kid.id);
      }
    }
  }
  const parents = buildEffectiveParents(nodes);
  const parentOfDeleted = parents.get(messageId) ?? null;
  await db.delete(aiMessages).where(and(eq(aiMessages.conversationId, conversationId), inArray(aiMessages.id, [...toDelete])));

  // 修复激活叶子
  const remaining = nodes.filter((n) => !toDelete.has(n.id));
  let newLeaf: number | null = null;
  if (remaining.length > 0) {
    if (parentOfDeleted !== null && remaining.some((n) => n.id === parentOfDeleted)) {
      newLeaf = descendToLeaf(remaining, parentOfDeleted);
    } else {
      newLeaf = sortMessagesByTime(remaining)[remaining.length - 1].id;
    }
  }
  if (conv.activeLeafMsgId === null || toDelete.has(conv.activeLeafMsgId) || newLeaf === null) {
    await db.update(aiConversations).set({ activeLeafMsgId: newLeaf }).where(eq(aiConversations.id, conversationId));
  }
  const finalLeaf = conv.activeLeafMsgId !== null && !toDelete.has(conv.activeLeafMsgId) ? conv.activeLeafMsgId : newLeaf;
  const { rebuildThreadMirror } = await import('./ai-memory.service');
  await rebuildThreadMirror(conversationId, conv.userId, { activeLeafMsgId: finalLeaf });
}

/**
 * 管理员：对话内容合规审计检索（跨用户全量消息，支持关键词 / 用户 / 角色 / 时间过滤）。
 */
export async function listAuditMessages(params: QueryOutputOf<typeof aiAuditContract.messages>) {
  const { page, pageSize } = params;
  const where = buildWhere(
    keywordCondition(params.keyword, [aiMessages.content], 'ilike'),
    params.role ? eq(aiMessages.role, params.role) : undefined,
    params.userId ? eq(aiConversations.userId, params.userId) : undefined,
    ...dateRangeConditions(aiMessages.createdAt, params.startDate, params.endDate),
  );

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

  return buildListResult({
    page,
    pageSize,
    count: () => countQuery.then((rows) => rows[0]?.count ?? 0),
    rows: () => withPagination(baseQuery.$dynamic(), page, pageSize),
    map: (row) => ({
      ...mapMessage(row.message),
      conversationTitle: row.conversationTitle ?? null,
      userId: row.userId ?? null,
      username: row.username ?? null,
      nickname: row.nickname ?? null,
      question: null,
    }),
  });
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
  requireRow(msg, '消息不存在');
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
  requireRow(msg, '消息不存在');
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
type AiFeedbackFilterQuery = QueryOutputOf<typeof aiConversationContract.feedbackExport>;

export async function listFeedbackMessages(params: QueryOutputOf<typeof aiConversationContract.feedbackList>) {
  const { page, pageSize } = params;
  const where = feedbackConds(params);
  const listQuery = feedbackSelect().where(where).orderBy(desc(aiMessages.createdAt), desc(aiMessages.id));
  return buildListResult({
    page: page,
    pageSize: pageSize,
    count: () => db.$count(aiMessages, where),
    rows: () => withPagination(listQuery.$dynamic(), page, pageSize),
    map: mapFeedbackRow,
  });
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

function feedbackConds(params: AiFeedbackFilterQuery) {
  const model = params.model?.trim();
  const feedback = params.feedback ? (Number(params.feedback) as 1 | -1) : undefined;
  return buildWhere(
    isNotNull(aiMessages.feedback),
    eq(aiMessages.role, 'assistant'),
    feedback ? eq(aiMessages.feedback, feedback) : undefined,
    params.status ? eq(aiMessages.feedbackStatus, params.status) : undefined,
    model ? eq(aiMessages.model, model) : undefined,
    ...dateRangeConditions(aiMessages.createdAt, params.startDate, params.endDate),
  );
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
  requireRow(msg, '消息不存在');
  const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, msg.conversationId));
  // 会话属主(发送人)信息:回放时展示真实用户名与头像
  const [owner] = conv
    ? await db.select({ id: users.id, username: users.username, nickname: users.nickname, avatar: users.avatar })
        .from(users).where(eq(users.id, conv.userId))
    : [];

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
    user: owner
      ? { id: owner.id, username: owner.username, nickname: owner.nickname ?? null, avatar: owner.avatar ?? null }
      : null,
    messages,
  };
}

/**
 * 管理员：导出反馈列表 CSV（与列表筛选一致，上限 10000 条）。
 */
export async function exportFeedbackMessages(params: AiFeedbackFilterQuery) {
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
