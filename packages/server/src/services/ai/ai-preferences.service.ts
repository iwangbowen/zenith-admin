import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { aiUserPreferences } from '../../db/schema';
import { currentUser } from '../../lib/context';
import type { SaveAiPreferenceInput } from '@zenith/shared';

function mapRow(row: typeof aiUserPreferences.$inferSelect | undefined) {
  return {
    aboutMe: row?.aboutMe ?? null,
    replyStyle: row?.replyStyle ?? null,
    isEnabled: row?.isEnabled ?? true,
  };
}

/** 获取当前用户的个性化指令（无记录返回默认空值） */
export async function getMyAiPreference() {
  const user = currentUser();
  const [row] = await db.select().from(aiUserPreferences).where(eq(aiUserPreferences.userId, user.userId));
  return mapRow(row);
}

/** 保存当前用户的个性化指令（upsert） */
export async function saveMyAiPreference(input: SaveAiPreferenceInput) {
  const user = currentUser();
  const values = {
    aboutMe: input.aboutMe?.trim() || null,
    replyStyle: input.replyStyle?.trim() || null,
    ...(input.isEnabled !== undefined && { isEnabled: input.isEnabled }),
  };
  const [row] = await db
    .insert(aiUserPreferences)
    .values({ userId: user.userId, ...values, isEnabled: input.isEnabled ?? true })
    .onConflictDoUpdate({ target: aiUserPreferences.userId, set: values })
    .returning();
  return mapRow(row);
}

/**
 * 组装个人指令片段（拼接进对话 system prompt 末尾）。
 * 未启用或内容为空时返回 null。
 */
export async function buildPreferencePrompt(userId: number): Promise<string | null> {
  const [row] = await db.select().from(aiUserPreferences).where(eq(aiUserPreferences.userId, userId));
  if (!row?.isEnabled) return null;
  const parts: string[] = [];
  if (row.aboutMe?.trim()) parts.push(`关于用户的背景信息：${row.aboutMe.trim()}`);
  if (row.replyStyle?.trim()) parts.push(`用户对回答风格的要求：${row.replyStyle.trim()}`);
  return parts.length > 0 ? parts.join('\n') : null;
}
