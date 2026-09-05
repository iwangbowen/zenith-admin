/**
 * 站内信渠道适配器。
 *
 * 直接落 `in_app_messages` 并推 WebSocket：站内信是唯一必然可达的渠道，
 * 只要收件人有账号就一定能投递，因此不做地址探测。
 */
import { eq } from 'drizzle-orm';
import type { InAppMessageType, NotificationRecipient } from '@zenith/shared/messaging';
import { db } from '../../../db';
import { inAppMessages, users } from '../../../db/schema';
import { formatDateTime } from '../../datetime';
import { scheduleSendToUsers } from '../../ws-manager';
import type { DeliveryContext, DeliveryResult, NotificationChannelAdapter } from '../types';

/** 事件级别 → 站内信视觉类型 */
const SEVERITY_TO_TYPE: Record<string, InAppMessageType> = {
  normal: 'info',
  important: 'warning',
  critical: 'error',
};

async function userExists(id: number): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  return Boolean(row);
}

export const inAppAdapter: NotificationChannelAdapter = {
  channel: 'inapp',

  async resolveAddress(recipient: NotificationRecipient): Promise<string | null> {
    // 站内信收件箱挂在系统用户上；会员前台与外部地址没有这个收件箱
    if (recipient.type !== 'user') return null;
    return (await userExists(recipient.id)) ? String(recipient.id) : null;
  },

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    const userId = ctx.target.subjectId;
    if (userId === null) throw new Error('站内信收件人缺少用户 ID');

    const type = ctx.options?.inapp?.type ?? SEVERITY_TO_TYPE[ctx.event.severity] ?? 'info';
    const [inserted] = await db.insert(inAppMessages).values({
      userId,
      title: ctx.title,
      content: ctx.content,
      type,
      source: 'system',
      link: ctx.link,
      dedupeKey: ctx.dedupeKey,
      tenantId: ctx.tenantId,
    }).onConflictDoNothing({ target: inAppMessages.dedupeKey }).returning();

    // 命中幂等键时不产生新消息，也就没有必要再推一次 WebSocket
    if (!inserted) return {};

    scheduleSendToUsers([{ userId }], {
      type: 'in-app-message:new',
      payload: {
        id: inserted.id,
        templateId: null,
        templateName: null,
        userId,
        username: null,
        title: ctx.title,
        content: ctx.content,
        type,
        isRead: false,
        readAt: null,
        source: 'system',
        senderId: null,
        senderName: null,
        link: ctx.link,
        createdAt: formatDateTime(inserted.createdAt),
      },
    });
    return { providerMsgId: String(inserted.id) };
  },
};
