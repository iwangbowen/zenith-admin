/**
 * 频道群发消息模板（运营常用群发内容保存复用）
 */
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { channelMessageTemplates, type ChannelMessageTemplateRow } from '../db/schema';
import type { ChannelMessageTemplate, ChatMessageExtra, CreateChannelTemplateInput, UpdateChannelTemplateInput } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime } from '../lib/datetime';

function mapTemplate(row: ChannelMessageTemplateRow): ChannelMessageTemplate {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    title: row.title,
    content: row.content,
    extra: (row.extra as ChatMessageExtra | null) ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listChannelTemplates(): Promise<ChannelMessageTemplate[]> {
  const rows = await db.query.channelMessageTemplates.findMany({
    orderBy: [asc(channelMessageTemplates.id)],
  });
  return rows.map(mapTemplate);
}

export async function getChannelTemplateBeforeAudit(id: number): Promise<ChannelMessageTemplate> {
  const row = await db.query.channelMessageTemplates.findFirst({ where: eq(channelMessageTemplates.id, id) });
  if (!row) throw new HTTPException(404, { message: '模板不存在' });
  return mapTemplate(row);
}

export async function createChannelTemplate(input: CreateChannelTemplateInput): Promise<ChannelMessageTemplate> {
  const [row] = await db.insert(channelMessageTemplates).values({
    name: input.name,
    type: input.type,
    title: input.title ?? null,
    content: input.content,
    extra: (input.extra as ChatMessageExtra | null) ?? null,
  }).returning();
  return mapTemplate(row);
}

export async function updateChannelTemplate(id: number, input: UpdateChannelTemplateInput): Promise<ChannelMessageTemplate> {
  const existing = await db.query.channelMessageTemplates.findFirst({ where: eq(channelMessageTemplates.id, id) });
  if (!existing) throw new HTTPException(404, { message: '模板不存在' });
  const [row] = await db.update(channelMessageTemplates).set({
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.type === undefined ? {} : { type: input.type }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.content === undefined ? {} : { content: input.content }),
    ...(input.extra === undefined ? {} : { extra: (input.extra as ChatMessageExtra | null) ?? null }),
  }).where(eq(channelMessageTemplates.id, id)).returning();
  return mapTemplate(row);
}

export async function deleteChannelTemplate(id: number): Promise<void> {
  const existing = await db.query.channelMessageTemplates.findFirst({ where: eq(channelMessageTemplates.id, id) });
  if (!existing) throw new HTTPException(404, { message: '模板不存在' });
  await db.delete(channelMessageTemplates).where(eq(channelMessageTemplates.id, id));
}
