import { asc, desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { chatCustomEmojis } from '../../db/schema';
import type { ChatCustomEmojiRow } from '../../db/schema/chat';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import type { ChatCustomEmoji } from '@zenith/shared';

const MAX_EMOJIS = 100;

function mapEmoji(row: ChatCustomEmojiRow): ChatCustomEmoji {
  return {
    id: row.id,
    url: row.url,
    fileId: row.fileId,
    name: row.name,
    width: row.width,
    height: row.height,
    createdAt: formatDateTime(row.createdAt),
  };
}

/** 我的自定义表情列表（最近添加在前） */
export async function listMyCustomEmojis(): Promise<ChatCustomEmoji[]> {
  const me = currentUser();
  const rows = await db.query.chatCustomEmojis.findMany({
    where: eq(chatCustomEmojis.userId, me.userId),
    orderBy: [desc(chatCustomEmojis.id)],
  });
  return rows.map(mapEmoji);
}

/** 添加自定义表情（每人上限 100 个，按 URL 去重） */
export async function addCustomEmoji(input: {
  url: string;
  fileId?: string | null;
  name?: string | null;
  width?: number | null;
  height?: number | null;
}): Promise<ChatCustomEmoji> {
  const me = currentUser();

  const existing = await db.query.chatCustomEmojis.findMany({
    where: eq(chatCustomEmojis.userId, me.userId),
    orderBy: [asc(chatCustomEmojis.id)],
    columns: { id: true, url: true },
  });
  const dup = existing.find((r) => r.url === input.url);
  if (dup) {
    const row = await db.query.chatCustomEmojis.findFirst({ where: eq(chatCustomEmojis.id, dup.id) });
    return mapEmoji(row!);
  }
  if (existing.length >= MAX_EMOJIS) {
    throw new HTTPException(400, { message: `自定义表情最多 ${MAX_EMOJIS} 个` });
  }

  const [row] = await db.insert(chatCustomEmojis).values({
    userId: me.userId,
    url: input.url,
    fileId: input.fileId ?? null,
    name: input.name ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
  }).returning();
  return mapEmoji(row);
}

/** 删除自定义表情（仅本人） */
export async function deleteCustomEmoji(id: number): Promise<void> {
  const me = currentUser();
  const row = await db.query.chatCustomEmojis.findFirst({ where: eq(chatCustomEmojis.id, id) });
  if (!row || row.userId !== me.userId) throw new HTTPException(404, { message: '表情不存在' });
  await db.delete(chatCustomEmojis).where(eq(chatCustomEmojis.id, id));
}
