/**
 * 聊天入站 Webhook 机器人服务
 *
 * - 后台 CRUD：管理 webhook（名称、头像、目标会话、令牌）
 * - 入站推送：外部系统以令牌 POST 文本/卡片，落库为目标会话内一条
 *   senderId=null + extra.bot 的消息（展示为该 webhook 的身份）。
 */
import { randomBytes } from 'node:crypto';
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { chatWebhooks, chatConversations } from '../db/schema';
import { currentUser } from '../lib/context';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';
import { pageOffset } from '../lib/pagination';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { escapeLike } from '../lib/where-helpers';
import { HTTPException } from 'hono/http-exception';
import type { ChatWebhook, CreateChatWebhookInput, UpdateChatWebhookInput, ChatWebhookPayloadInput, ChatMessageExtra } from '@zenith/shared';
import { postBotMessage } from './chat.service';

const TOKEN_PREFIX = 'cwh_';

function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
}

function webhookUrl(token: string): string {
  return `/api/public/chat/webhook/${token}`;
}

type WebhookRow = typeof chatWebhooks.$inferSelect;

function mapChatWebhook(row: WebhookRow, conversationName: string | null): ChatWebhook {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar ?? null,
    description: row.description ?? null,
    conversationId: row.conversationId,
    conversationName,
    enabled: row.enabled,
    webhookUrl: webhookUrl(row.token),
    token: row.token,
    lastUsedAt: formatNullableDateTime(row.lastUsedAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function ensureConversationExists(conversationId: number): Promise<void> {
  const conv = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, conversationId),
    columns: { id: true },
  });
  if (!conv) throw new HTTPException(400, { message: '目标会话不存在' });
}

export async function listChatWebhooks(params: { page: number; pageSize: number; keyword?: string }) {
  const where = params.keyword
    ? sql`${chatWebhooks.name} ILIKE ${'%' + escapeLike(params.keyword) + '%'}`
    : undefined;

  const [total, rows] = await Promise.all([
    db.$count(chatWebhooks, where),
    db.query.chatWebhooks.findMany({
      where,
      with: { conversation: { columns: { name: true } } },
      orderBy: desc(chatWebhooks.id),
      limit: params.pageSize,
      offset: pageOffset(params.page, params.pageSize),
    }),
  ]);

  const list = rows.map((r) => mapChatWebhook(r, r.conversation?.name ?? null));
  return { list, total, page: params.page, pageSize: params.pageSize };
}

export async function createChatWebhook(input: CreateChatWebhookInput): Promise<ChatWebhook> {
  await ensureConversationExists(input.conversationId);
  const me = currentUser();
  try {
    const [row] = await db.insert(chatWebhooks).values({
      name: input.name,
      avatar: input.avatar ?? null,
      description: input.description ?? null,
      conversationId: input.conversationId,
      enabled: input.enabled ?? true,
      token: generateToken(),
      tenantId: me.tenantId,
    }).returning();
    const conv = await db.query.chatConversations.findFirst({ where: eq(chatConversations.id, row.conversationId), columns: { name: true } });
    return mapChatWebhook(row, conv?.name ?? null);
  } catch (err) {
    rethrowPgUniqueViolation(err, '令牌冲突，请重试');
    throw err;
  }
}

async function getWebhookOr404(id: number): Promise<WebhookRow> {
  const row = await db.query.chatWebhooks.findFirst({ where: eq(chatWebhooks.id, id) });
  if (!row) throw new HTTPException(404, { message: 'Webhook 不存在' });
  return row;
}

export async function updateChatWebhook(id: number, input: UpdateChatWebhookInput): Promise<ChatWebhook> {
  await getWebhookOr404(id);
  const [row] = await db.update(chatWebhooks).set({
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
  }).where(eq(chatWebhooks.id, id)).returning();
  const conv = await db.query.chatConversations.findFirst({ where: eq(chatConversations.id, row.conversationId), columns: { name: true } });
  return mapChatWebhook(row, conv?.name ?? null);
}

export async function regenerateChatWebhookToken(id: number): Promise<ChatWebhook> {
  await getWebhookOr404(id);
  const [row] = await db.update(chatWebhooks).set({ token: generateToken() }).where(eq(chatWebhooks.id, id)).returning();
  const conv = await db.query.chatConversations.findFirst({ where: eq(chatConversations.id, row.conversationId), columns: { name: true } });
  return mapChatWebhook(row, conv?.name ?? null);
}

export async function deleteChatWebhook(id: number): Promise<void> {
  await getWebhookOr404(id);
  await db.delete(chatWebhooks).where(eq(chatWebhooks.id, id));
}

/** 入站推送：以令牌投递一条文本/卡片消息到目标会话（无鉴权上下文） */
export async function ingestChatWebhook(token: string, payload: ChatWebhookPayloadInput): Promise<void> {
  const hook = await db.query.chatWebhooks.findFirst({ where: eq(chatWebhooks.token, token) });
  if (!hook || !hook.enabled) throw new HTTPException(404, { message: 'Webhook 不存在或已停用' });

  const bot = { name: hook.name, avatar: hook.avatar ?? null };
  if (payload.type === 'card' && payload.card) {
    const extra: ChatMessageExtra = { card: payload.card, bot };
    await postBotMessage(hook.conversationId, null, { type: 'card', content: payload.card.title, extra });
  } else {
    const extra: ChatMessageExtra = { bot };
    await postBotMessage(hook.conversationId, null, { type: 'text', content: payload.text ?? '', extra });
  }

  await db.update(chatWebhooks).set({ lastUsedAt: new Date() }).where(eq(chatWebhooks.id, hook.id));
}
