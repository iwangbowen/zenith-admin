/**
 * 聊天通知（卡片）服务
 *
 * 供事件订阅器（工作流、系统告警等）在请求上下文之外，
 * 通过「系统机器人 → 用户单聊」推送卡片消息。
 */
import type { ChatCard } from '@zenith/shared';
import { getSystemBotUserId, ensureBotDirectConversation, postBotMessage } from './chat.service';
import logger from '../lib/logger';

/** 向某个用户推送一张卡片（经系统机器人单聊） */
export async function notifyUserWithCard(userId: number, card: ChatCard): Promise<void> {
  try {
    const botId = await getSystemBotUserId();
    if (!botId) {
      logger.warn('[chat-notify] 系统机器人用户不存在，已跳过卡片推送');
      return;
    }
    const conversationId = await ensureBotDirectConversation(botId, userId);
    await postBotMessage(conversationId, botId, { type: 'card', content: card.title, extra: { card } });
  } catch (err) {
    logger.error('[chat-notify] notifyUserWithCard 失败', { err, userId });
  }
}

/** 向多个用户推送同一张卡片 */
export async function notifyUsersWithCard(userIds: number[], card: ChatCard): Promise<void> {
  const unique = [...new Set(userIds)].filter((id) => id > 0);
  await Promise.all(unique.map((id) => notifyUserWithCard(id, card)));
}
