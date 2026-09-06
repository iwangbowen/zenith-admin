import { and, desc, eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { requireRow } from '../../db-assert';
import { db } from '../../../db';
import { chatConversationMembers, chatMessages, users } from '../../../db/schema';
import { batchIterable } from '../../excel-export';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';
import type { JwtPayload } from '../../../middleware/auth';

interface ChatMessagesExportQuery extends Record<string, unknown> {
  conversationId?: number | string;
}

const columns: ExportColumn[] = [
  { key: 'id', header: '消息 ID', width: 10, type: 'number' },
  { key: 'createdAt', header: '时间', width: 22, type: 'datetime' },
  { key: 'senderName', header: '发送人', width: 16 },
  {
    key: 'type', header: '类型', width: 10,
    enumMap: { text: '文本', image: '图片', file: '文件', system: '系统', forward: '转发', vote: '投票', voice: '语音', card: '卡片' },
  },
  { key: 'content', header: '内容', width: 60 },
  { key: 'isRecalled', header: '已撤回', width: 8, type: 'boolean' },
];

function parseConversationId(query: ChatMessagesExportQuery): number {
  const id = Number(query.conversationId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HTTPException(400, { message: '缺少有效的会话 ID' });
  }
  return id;
}

/** 导出人必须是会话成员，且只导出对其可见（未被删除隐藏）的消息 */
async function assertMemberAndBuildWhere(query: ChatMessagesExportQuery, user: JwtPayload) {
  const conversationId = parseConversationId(query);
  const maybeMember = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, user.userId),
    ),
  });
  requireRow(maybeMember, '无权导出该会话', 403);
  return and(
    eq(chatMessages.conversationId, conversationId),
    sql`NOT COALESCE(${chatMessages.extra}->'hiddenFor', '[]'::jsonb) @> to_jsonb(CAST(${user.userId} AS integer))`,
  );
}

export const chatMessagesExportDefinition = defineExport<ChatMessagesExportQuery, Record<string, unknown>>({
  entity: 'chat.messages',
  moduleName: '消息中心',
  filenamePrefix: '聊天记录',
  sourcePath: '/chat',
  sheetName: '聊天记录',
  permissions: { export: 'chat:message:export' },
  execution: { mode: 'sync', syncMaxRows: 5000, syncModeOverridesAsyncPolicies: true },
  retention: { normalDays: 7, sensitiveDays: 3, rawDays: 3 },
  columns,
  countRows: async (query, user) => {
    const where = await assertMemberAndBuildWhere(query, user);
    return db.$count(chatMessages, where);
  },
  streamRows: async (query, user) => {
    const where = await assertMemberAndBuildWhere(query, user);
    return batchIterable(async (limit, offset) => {
      const rows = await db
        .select({
          id: chatMessages.id,
          createdAt: chatMessages.createdAt,
          senderName: users.nickname,
          type: chatMessages.type,
          content: chatMessages.content,
          isRecalled: chatMessages.isRecalled,
        })
        .from(chatMessages)
        .leftJoin(users, eq(chatMessages.senderId, users.id))
        .where(where)
        .orderBy(desc(chatMessages.id))
        .limit(limit)
        .offset(offset);
      return rows.map((r) => ({
        ...r,
        senderName: r.senderName ?? '系统',
        content: r.isRecalled ? '（已撤回）' : r.content,
      }));
    });
  },
});
