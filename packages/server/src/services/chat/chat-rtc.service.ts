import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { chatConversations, chatConversationMembers, chatMessages } from '../../db/schema';
import { scheduleSendToUsers, isUserOnline, getUserLastSeen } from '../../lib/ws-manager';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { config } from '../../config';
import { requireRow } from '../../lib/db-assert';
import type { ChatCallRecordInput, ChatPresence, RtcConfig } from '@zenith/shared/chat';
import { mapChatMessage, listConversationMemberIds } from './chat-shared';

// ─── 在线状态：批量查询用户在线/最近在线 ───────────────────────────────────────

export function getPresenceForUsers(userIds: number[]): ChatPresence[] {
  const unique = [...new Set(userIds)];
  return unique.map((userId) => {
    const online = isUserOnline(userId);
    const lastSeenMs = online ? null : getUserLastSeen(userId);
    return {
      userId,
      online,
      lastSeen: lastSeenMs ? formatDateTime(new Date(lastSeenMs)) : null,
    };
  });
}

// ─── WebRTC 音视频通话 ───────────────────────────────────────────────────────

/** 返回 ICE 服务器配置（STUN 默认 + 可选 TURN） */
export function getRtcConfig(): RtcConfig {
  const iceServers: RtcConfig['iceServers'] = [];
  if (config.webrtc.stunUrls.length > 0) {
    iceServers.push({ urls: config.webrtc.stunUrls });
  }
  if (config.webrtc.turnUrls.length > 0) {
    iceServers.push({
      urls: config.webrtc.turnUrls,
      username: config.webrtc.turnUsername || undefined,
      credential: config.webrtc.turnCredential || undefined,
    });
  }
  return { iceServers };
}

function buildCallRecordText(input: ChatCallRecordInput): string {
  const label = input.callType === 'video' ? '视频通话' : (input.mode === 'group' ? '群语音通话' : '语音通话');
  if (input.status === 'completed') {
    const m = Math.floor(input.durationSec / 60);
    const s = input.durationSec % 60;
    const dur = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${label}结束 · 时长 ${dur}`;
  }
  if (input.status === 'missed') return `未接听的${label}`;
  if (input.status === 'rejected') return `对方已拒绝${label}`;
  return `已取消的${label}`;
}

/** 通话结束后向会话写入一条系统消息（通话记录） */
export async function postCallRecord(conversationId: number, input: ChatCallRecordInput): Promise<void> {
  const me = currentUser();
  const maybeMember = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  requireRow(maybeMember, '无权访问该会话', 403);

  const [row] = await db.insert(chatMessages).values({
    conversationId,
    senderId: null,
    type: 'system',
    content: buildCallRecordText(input),
  }).returning();

  const [, members] = await Promise.all([
    db.update(chatConversations).set({ updatedAt: new Date() }).where(eq(chatConversations.id, conversationId)),
    listConversationMemberIds(conversationId),
  ]);

  scheduleSendToUsers(members, { type: 'chat:message', payload: mapChatMessage(row, null) });
}
