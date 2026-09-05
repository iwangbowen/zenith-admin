/**
 * 管理端实时 WebSocket 通道。
 *
 * 安全边界：
 * - 升级鉴权复用 HTTP 口径（lib/ws-auth.ts）：只接受管理端 access token，实时校验用户 / 租户状态与黑名单
 * - 入站帧经 zod 校验，只接受 ping / chat:typing / rtc:* 有限类型；其余静默丢弃
 * - 身份字段（typing 的 userId / nickname、rtc 的 from）一律由服务端按连接主体覆写，客户端声明无效
 * - typing 与 rtc 信令要求发送者是目标会话成员；rtc 的 callId 绑定到发起时的会话，
 *   定向目标 `to` 也必须是该会话成员（不能给任意用户推送信令）
 * - 每连接令牌桶限速；单帧大小由 WebSocketServer.maxPayload 限制（见 src/index.ts）
 */
import { Hono } from 'hono';
import type { UpgradeWebSocket } from 'hono/ws';
import { z } from 'zod';
import type { JwtPayload } from '../../middleware/auth';
import { authenticateAdminWs } from '../../lib/ws-auth';
import { registerConnection, removeConnection, sendToUser, incWsRecv } from '../../lib/ws-manager';
import { getCallConversation, joinRoom, leaveAllRooms, leaveRoom } from '../../lib/rtc-manager';
import { getConversationMemberIds } from '../../lib/chat-member-cache';
import type { RtcPeerInfo } from '@zenith/shared/chat';
import type { WsMessage } from '@zenith/shared/platform';

// ─── 入站帧 schema ────────────────────────────────────────────────────────────

const positiveInt = z.number().int().positive();
const callId = z.string().min(1).max(128);
const sdp = z.string().min(1).max(64 * 1024);
const peerInfo = z.object({ userId: z.number(), nickname: z.string().max(200), avatar: z.string().max(2048).nullable() }).passthrough();
const iceCandidate = z.object({
  candidate: z.string().max(4096).optional(),
  sdpMid: z.string().max(64).nullable().optional(),
  sdpMLineIndex: z.number().int().nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});

const inboundFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('chat:typing'), payload: z.object({ conversationId: positiveInt }).passthrough() }),
  z.object({
    type: z.literal('rtc:invite'),
    payload: z.object({
      callId,
      conversationId: positiveInt,
      callType: z.enum(['audio', 'video']),
      mode: z.enum(['p2p', 'group']),
      from: peerInfo.optional(),
      to: positiveInt.optional(),
      conversationName: z.string().max(200).nullable().optional(),
    }),
  }),
  z.object({ type: z.literal('rtc:join'), payload: z.object({ callId, conversationId: positiveInt, from: peerInfo.optional() }) }),
  z.object({ type: z.literal('rtc:accept'), payload: z.object({ callId, to: positiveInt, from: peerInfo.optional() }) }),
  z.object({ type: z.literal('rtc:reject'), payload: z.object({ callId, to: positiveInt, reason: z.string().max(200).optional() }) }),
  z.object({ type: z.literal('rtc:busy'), payload: z.object({ callId, to: positiveInt }) }),
  z.object({ type: z.literal('rtc:cancel'), payload: z.object({ callId, conversationId: positiveInt, to: positiveInt.optional() }) }),
  z.object({ type: z.literal('rtc:leave'), payload: z.object({ callId, conversationId: positiveInt.or(z.literal(0)), from: z.number().optional(), to: positiveInt.optional() }) }),
  z.object({ type: z.literal('rtc:offer'), payload: z.object({ callId, to: positiveInt, from: z.number().optional(), sdp }) }),
  z.object({ type: z.literal('rtc:answer'), payload: z.object({ callId, to: positiveInt, from: z.number().optional(), sdp }) }),
  z.object({ type: z.literal('rtc:ice'), payload: z.object({ callId, to: positiveInt, from: z.number().optional(), candidate: iceCandidate }) }),
]);

type InboundFrame = z.infer<typeof inboundFrameSchema>;

/** 单连接令牌桶：ICE 候选在建连瞬间会成簇到达，上限放宽到 60 帧 / 秒（突发 120） */
const RATE_CAPACITY = 120;
const RATE_REFILL_PER_MS = 60 / 1000;

class TokenBucket {
  private tokens = RATE_CAPACITY;
  private last = Date.now();

  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(RATE_CAPACITY, this.tokens + (now - this.last) * RATE_REFILL_PER_MS);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** 单帧最大字节数（与 WebSocketServer.maxPayload 对齐，这里再挡一次以兼容其它适配器） */
const MAX_FRAME_BYTES = 64 * 1024;

// ─── 转发 ─────────────────────────────────────────────────────────────────────

async function isMember(conversationId: number, userId: number): Promise<boolean> {
  return (await getConversationMemberIds(conversationId)).includes(userId);
}

/** 转发给会话内其他成员（成员列表走短 TTL 缓存，避免 typing 等高频事件反复查库） */
async function relayToConversation(conversationId: number, senderId: number, msg: WsMessage): Promise<void> {
  const memberIds = await getConversationMemberIds(conversationId);
  for (const userId of memberIds) {
    if (userId !== senderId) sendToUser(userId, msg);
  }
}

/**
 * 定向信令：`to` 必须与发送者同属该通话所在会话；否则丢弃。
 * 没有定向目标时按会话广播。
 */
async function relayRtc(conversationId: number, senderId: number, to: number | undefined, msg: WsMessage): Promise<void> {
  const memberIds = await getConversationMemberIds(conversationId);
  if (!memberIds.includes(senderId)) return;
  if (to !== undefined) {
    if (to !== senderId && memberIds.includes(to)) sendToUser(to, msg);
    return;
  }
  for (const userId of memberIds) {
    if (userId !== senderId) sendToUser(userId, msg);
  }
}

interface ConnectionIdentity {
  payload: JwtPayload;
  self: RtcPeerInfo;
}

async function handleRtc(identity: ConnectionIdentity, frame: Exclude<InboundFrame, { type: 'ping' | 'chat:typing' }>): Promise<void> {
  const senderId = identity.payload.userId;
  switch (frame.type) {
    case 'rtc:invite': {
      const { conversationId, callId: id } = frame.payload;
      if (!(await isMember(conversationId, senderId))) return;
      // 发起方登记房间（把 callId 绑定到会话）；已存在但会话不一致 → 拒绝
      if (joinRoom(id, conversationId, identity.self) === null) return;
      const outbound: WsMessage = { type: 'rtc:invite', payload: { ...frame.payload, from: identity.self } };
      await relayRtc(conversationId, senderId, frame.payload.to, outbound);
      return;
    }
    case 'rtc:join': {
      const { conversationId, callId: id } = frame.payload;
      if (!(await isMember(conversationId, senderId))) return;
      const existing = joinRoom(id, conversationId, identity.self);
      if (existing === null) return;
      sendToUser(senderId, { type: 'rtc:room-participants', payload: { callId: id, participants: existing } });
      return;
    }
    case 'rtc:accept': {
      const conversationId = getCallConversation(frame.payload.callId);
      if (conversationId === null) return;
      if (joinRoom(frame.payload.callId, conversationId, identity.self) === null) return;
      await relayRtc(conversationId, senderId, frame.payload.to, { type: 'rtc:accept', payload: { ...frame.payload, from: identity.self } });
      return;
    }
    case 'rtc:reject':
    case 'rtc:busy': {
      const conversationId = getCallConversation(frame.payload.callId);
      if (conversationId === null) return;
      await relayRtc(conversationId, senderId, frame.payload.to, frame as WsMessage);
      // 单聊被拒 / 忙线即结束：把发起方移出房间，房间随之回收
      leaveRoom(frame.payload.callId, frame.payload.to);
      return;
    }
    case 'rtc:cancel': {
      // 取消可能发生在被叫尚未加入前，但房间已由发起方登记；会话必须一致
      const conversationId = getCallConversation(frame.payload.callId);
      if (conversationId === null || conversationId !== frame.payload.conversationId) return;
      await relayRtc(conversationId, senderId, frame.payload.to, frame as WsMessage);
      leaveRoom(frame.payload.callId, senderId);
      return;
    }
    case 'rtc:leave': {
      const conversationId = getCallConversation(frame.payload.callId);
      if (conversationId === null) return;
      const outbound: WsMessage = { type: 'rtc:leave', payload: { ...frame.payload, conversationId, from: senderId } };
      await relayRtc(conversationId, senderId, frame.payload.to, outbound);
      leaveRoom(frame.payload.callId, senderId);
      return;
    }
    case 'rtc:offer':
    case 'rtc:answer':
    case 'rtc:ice': {
      const conversationId = getCallConversation(frame.payload.callId);
      if (conversationId === null) return;
      const outbound = { type: frame.type, payload: { ...frame.payload, from: senderId } } as WsMessage;
      await relayRtc(conversationId, senderId, frame.payload.to, outbound);
      return;
    }
    default:
      return;
  }
}

function parseFrame(raw: unknown): InboundFrame | null {
  if (typeof raw !== 'string' || raw.length > MAX_FRAME_BYTES) return null;
  try {
    const parsed = inboundFrameSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Create the WebSocket route.
 * Requires `upgradeWebSocket` from `@hono/node-server`（以参数注入便于测试替身）。
 */
export function createWsRoute(upgradeWebSocket: UpgradeWebSocket) {
  const wsApp = new Hono();

  wsApp.get(
    '/',
    upgradeWebSocket(async (c) => {
      const auth = await authenticateAdminWs(c);
      const identity: ConnectionIdentity | null = auth
        ? { payload: auth.payload, self: { userId: auth.payload.userId, nickname: auth.nickname, avatar: null } }
        : null;
      const bucket = new TokenBucket();

      return {
        onOpen(_evt, ws) {
          if (!identity) {
            ws.close(4001, 'Unauthorized');
            return;
          }
          registerConnection(identity.payload.userId, identity.payload.jti ?? '', ws);
        },
        async onMessage(evt, ws) {
          if (!identity) return;
          incWsRecv(identity.payload.jti ?? '');
          if (!bucket.take()) return;
          const frame = parseFrame(evt.data);
          if (!frame) return;
          try {
            if (frame.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong' }));
              return;
            }
            if (frame.type === 'chat:typing') {
              const { conversationId } = frame.payload;
              if (!(await isMember(conversationId, identity.payload.userId))) return;
              await relayToConversation(conversationId, identity.payload.userId, {
                type: 'chat:typing',
                payload: { conversationId, userId: identity.payload.userId, nickname: identity.self.nickname },
              });
              return;
            }
            await handleRtc(identity, frame);
          } catch { /* 成员查询失败等：丢弃该帧 */ }
        },
        onClose(evt, _ws) {
          if (!identity) return;
          const { userId, jti } = identity.payload;
          // 断线：离开所有群通话房间并通知其余成员
          for (const { callId: id, conversationId, remaining } of leaveAllRooms(userId)) {
            for (const target of remaining) {
              sendToUser(target, { type: 'rtc:leave', payload: { callId: id, conversationId, from: userId, to: target } });
            }
          }
          const reason = evt && typeof evt === 'object' && 'reason' in evt && typeof (evt as { reason: unknown }).reason === 'string'
            ? ((evt as { reason: string }).reason || 'close')
            : 'close';
          removeConnection(userId, jti ?? '', reason);
        },
        onError() {
          // 连接级错误由 @hono/node-server 的 WS 适配器内部处理
        },
      };
    }),
  );

  return wsApp;
}
