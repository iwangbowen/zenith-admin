import { eq, desc, and, or, ilike, inArray, isNotNull, gt, gte, lte, sql, arrayContains } from 'drizzle-orm';
import { db } from '../../db';
import { aiConversations, aiMessages, users } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime, formatNullableDateTime, formatFileTimestamp, parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import { truncateHistoryByBudget } from '../../lib/ai/tokens';
import { escapeLike, withPagination } from '../../lib/where-helpers';
import { streamToCsv } from '../../lib/excel-export';
import { HTTPException } from 'hono/http-exception';
import { resolveAgentForChat, incrementAgentUsage } from './ai-agents.service';
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
    createdAt: formatDateTime(row.createdAt),
  };
}

// ─── 消息分支树 ───────────────────────────────────────────────────────────────
// 数据模型（对齐 ChatGPT）：消息带 parentId 组成树；对话的 activeLeafMsgId 指定当前
// 激活分支的叶子，激活路径 = 叶子的祖先链。历史数据 parentId 为 null（线性），按
// 时间序推导隐式父节点兼容；所有新写入均带显式 parentId。

interface MsgNode {
  id: number;
  parentId: number | null;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

function sortByTime<T extends { id: number; createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
}

/** 有效父节点：显式 parentId 优先；legacy 空值按时间序链接前一条 legacy 消息 */
function buildEffectiveParents(rows: MsgNode[]): Map<number, number | null> {
  const idSet = new Set(rows.map((r) => r.id));
  const map = new Map<number, number | null>();
  let prevLegacyId: number | null = null;
  for (const row of sortByTime(rows)) {
    if (row.parentId !== null) {
      map.set(row.id, idSet.has(row.parentId) ? row.parentId : null);
    } else {
      map.set(row.id, prevLegacyId);
      prevLegacyId = row.id;
    }
  }
  return map;
}

function buildChildren(rows: MsgNode[]): Map<number | null, MsgNode[]> {
  const parents = buildEffectiveParents(rows);
  const children = new Map<number | null, MsgNode[]>();
  for (const row of sortByTime(rows)) {
    const p = parents.get(row.id) ?? null;
    const list = children.get(p) ?? [];
    list.push(row);
    children.set(p, list);
  }
  return children;
}

/** 从指定节点沿"最新子分支"下探到叶子 */
function descendToLeaf(rows: MsgNode[], fromId: number): number {
  const children = buildChildren(rows);
  let cur = fromId;
  const guard = new Set<number>();
  while (!guard.has(cur)) {
    guard.add(cur);
    const kids = children.get(cur) ?? [];
    if (kids.length === 0) return cur;
    cur = kids[kids.length - 1].id;
  }
  return cur;
}

/** 激活路径：activeLeaf 的祖先链（含自身）；未设置时取时间最新消息为叶子 */
function resolveActivePath(rows: MsgNode[], activeLeafMsgId: number | null): MsgNode[] {
  if (rows.length === 0) return [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parents = buildEffectiveParents(rows);
  const sorted = sortByTime(rows);
  const leafId = activeLeafMsgId !== null && byId.has(activeLeafMsgId) ? activeLeafMsgId : sorted[sorted.length - 1].id;
  const path: MsgNode[] = [];
  let cur: number | null = leafId;
  const guard = new Set<number>();
  while (cur !== null && !guard.has(cur)) {
    guard.add(cur);
    const node = byId.get(cur);
    if (!node) break;
    path.unshift(node);
    cur = parents.get(cur) ?? null;
  }
  return path;
}

/** 祖先链（含 upToMsgId 自身）——编辑重发时以某条消息为终点构造上下文 */
function resolveAncestorPath(rows: MsgNode[], upToMsgId: number): MsgNode[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!byId.has(upToMsgId)) return [];
  const parents = buildEffectiveParents(rows);
  const path: MsgNode[] = [];
  let cur: number | null = upToMsgId;
  const guard = new Set<number>();
  while (cur !== null && !guard.has(cur)) {
    guard.add(cur);
    const node = byId.get(cur);
    if (!node) break;
    path.unshift(node);
    cur = parents.get(cur) ?? null;
  }
  return path;
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
  await ensureConversationOwner(conversationId);
  const rows = await loadMsgNodes(conversationId);
  if (!rows.some((r) => r.id === msgId)) throw new HTTPException(404, { message: '消息不存在' });
  const leafId = descendToLeaf(rows, msgId);
  await db.update(aiConversations).set({ activeLeafMsgId: leafId }).where(eq(aiConversations.id, conversationId));
  return leafId;
}

export async function listConversations(opts: { archived?: boolean; keyword?: string; tag?: string; limit?: number; offset?: number } = {}) {
  const user = currentUser();
  const archived = opts.archived ?? false;
  const keyword = opts.keyword?.trim();

  const conds = [
    eq(aiConversations.userId, user.userId),
    eq(aiConversations.isArchived, archived),
  ];

  if (opts.tag?.trim()) {
    conds.push(arrayContains(aiConversations.tags, [opts.tag.trim()]));
  }

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

export async function createConversation(input: { title?: string; agentId?: number } = {}) {
  const user = currentUser();
  let agentId: number | null = null;
  let title = input.title?.trim() || '新对话';
  if (input.agentId) {
    const agent = await resolveAgentForChat(input.agentId, user.userId);
    if (!agent) throw new HTTPException(404, { message: '智能体不存在或未上架' });
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
  // 对外统一输出"有效父节点"（legacy 线性数据按时间序推导），前端据此构建分支树
  const parents = buildEffectiveParents(rows.map((r) => ({ id: r.id, parentId: r.parentId, role: r.role, content: '', createdAt: r.createdAt })));
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
}

export async function saveMessages(
  conversationId: number,
  userContent: string,
  assistantContent: string,
  tokensInput: number,
  tokensOutput: number,
  snapshot: { provider: string; model: string; configId?: number } | null,
  meta: AssistantMessageMeta = {},
  /** user 消息的分支树父节点（发送时的激活叶子；编辑重发时为被编辑消息的父节点） */
  userParentId: number | null = null,
) {
  const [userRow] = await db.insert(aiMessages).values(
    { conversationId, parentId: userParentId, role: 'user', content: userContent, tokensInput: 0, tokensOutput: 0 },
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
  snapshot: { provider: string; model: string; configId?: number } | null,
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

export async function getHistoryMessages(
  conversationId: number,
  options: { maxTokens?: number; maxCount?: number; activeLeafMsgId?: number | null; upToMsgId?: number | null } = {},
) {
  const maxCount = options.maxCount ?? 50;
  const nodes = await loadMsgNodes(conversationId);
  // 分支树：历史 = 激活路径（或编辑重发时指定消息的祖先链）
  const path = options.upToMsgId
    ? resolveAncestorPath(nodes, options.upToMsgId)
    : resolveActivePath(nodes, options.activeLeafMsgId ?? null);
  const rows = path.slice(-maxCount).map((n) => ({ role: n.role, content: n.content }));
  // truncateHistoryByBudget 接受时间倒序输入，返回升序
  return truncateHistoryByBudget([...rows].reverse(), { maxTokens: options.maxTokens });
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
 * 删除一条消息及其整个子树（所有后代分支）。
 * 若激活叶子位于被删子树内，激活分支回退到被删节点的父链最新叶子。
 */
export async function deleteMessageCascade(conversationId: number, messageId: number) {
  const conv = await ensureConversationOwner(conversationId);
  const nodes = await loadMsgNodes(conversationId);
  if (!nodes.some((n) => n.id === messageId)) throw new HTTPException(404, { message: '消息不存在' });

  // BFS 收集子树（基于有效父节点）
  const children = buildChildren(nodes);
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
      newLeaf = sortByTime(remaining)[remaining.length - 1].id;
    }
  }
  if (conv.activeLeafMsgId === null || toDelete.has(conv.activeLeafMsgId) || newLeaf === null) {
    await db.update(aiConversations).set({ activeLeafMsgId: newLeaf }).where(eq(aiConversations.id, conversationId));
  }
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
