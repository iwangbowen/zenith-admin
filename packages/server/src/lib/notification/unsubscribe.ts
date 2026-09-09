/**
 * 邮件退订令牌：HMAC 签名的无状态令牌。
 *
 * 不建令牌表——退订的最终状态本来就落在 notification_preferences，
 * 令牌只需要证明「这个链接确实是我们发给这位收件人的」。撤销即删除偏好行。
 */
import { config } from '../../config';
import { createSignedTokenCodec } from '../signed-token';

export interface UnsubscribePayload {
  recipientType: 'user' | 'member';
  recipientId: number;
  /** event = 退订该事件的邮件；all-email = 退订全部事件的邮件 */
  scope: 'event' | 'all-email';
  eventKey?: string;
  /** 过期时间戳（ms） */
  exp: number;
}

const DEFAULT_TTL_DAYS = 60;

/** 无版本段：`<data>.<sig>`，签名输入 `notification-unsubscribe:<data>`（已发出邮件中的链接依赖此格式） */
const codec = createSignedTokenCodec<UnsubscribePayload>({ purpose: 'notification-unsubscribe' });

export function createUnsubscribeToken(
  payload: Omit<UnsubscribePayload, 'exp'>,
  ttlDays = DEFAULT_TTL_DAYS,
): string {
  return codec.encode({ ...payload, exp: Date.now() + ttlDays * 86_400_000 });
}

export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  const payload = codec.decode(token);
  if (!payload) return null;
  if (payload.exp < Date.now()) return null;
  if (payload.recipientType !== 'user' && payload.recipientType !== 'member') return null;
  if (!Number.isInteger(payload.recipientId) || payload.recipientId <= 0) return null;
  if (payload.scope !== 'event' && payload.scope !== 'all-email') return null;
  if (payload.scope === 'event' && !payload.eventKey) return null;
  return payload;
}

/** 退订链接（指向公开确认页，人点确认、邮件客户端 One-Click 直接 POST）。 */
export function buildUnsubscribeUrl(payload: Omit<UnsubscribePayload, 'exp'>): string {
  return `${config.publicBaseUrl}/api/notification-unsubscribe/${createUnsubscribeToken(payload)}`;
}
