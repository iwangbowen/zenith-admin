import { and, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { mpBroadcastContract, mpBroadcastSchema } from '@zenith/shared/mp';
import { db } from '../../db';
import { mpAccounts, mpBroadcasts, mpTags } from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { defineCrudService } from '../../lib/crud-service';
import { parseDateTimeInput } from '../../lib/datetime';
import { entityMapper } from '../../lib/entity-map';
import { tenantScope } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { ensureMpAccountExists } from './mp-account.service';
import { assertContentSafe } from './mp-security.service';
import { massSend, previewMassSend, getMassSendResult, WechatApiError } from '../../lib/wechat';
import { mapWechatError } from '../../lib/wechat-error';
import { collectScheduledJobs, listOverdueScheduledJobs, type ScheduledMonitorQuery } from '../../lib/job-monitor/scheduled';

export function mpBroadcastDueCondition(asOf: Date) {
  return and(eq(mpBroadcasts.status, 'draft'), isNotNull(mpBroadcasts.scheduledAt), lte(mpBroadcasts.scheduledAt, asOf));
}

const scheduledMonitor: ScheduledMonitorQuery = {
  key: 'mp-broadcast', label: '公众号定时群发', table: mpBroadcasts, due: mpBroadcastDueCondition,
  id: mpBroadcasts.id, title: sql`'公众号群发 #' || ${mpBroadcasts.id}`, status: mpBroadcasts.status,
  dueAt: mpBroadcasts.scheduledAt, dateColumn: mpBroadcasts.scheduledAt,
  drillDown: { path: '/mp/broadcasts', label: '查看公众号群发' },
};

export function getMpScheduledHealth() { return collectScheduledJobs(scheduledMonitor); }
export function listOverdueMpScheduled(limit: number) { return listOverdueScheduledJobs(scheduledMonitor, limit); }

export const mapMpBroadcast = entityMapper(mpBroadcastSchema);

const mpBroadcastCrud = defineCrudService(mpBroadcastContract, {
  table: mpBroadcasts,
  map: mapMpBroadcast,
  notFound: '群发记录不存在',
  tenant: true,
  list: (q) => ({
    where: [
      eq(mpBroadcasts.accountId, q.accountId),
      q.status ? eq(mpBroadcasts.status, q.status) : undefined,
    ],
    orderBy: [desc(mpBroadcasts.id)],
  }),
  create: {
    before: async (data) => {
      await ensureMpAccountExists(data.accountId);
    },
    toRow: (data) => ({
      accountId: data.accountId,
      msgType: data.msgType,
      target: data.target,
      tagId: data.target === 'tag' ? (data.tagId ?? null) : null,
      content: data.msgType === 'text' ? (data.content ?? null) : null,
      mediaId: data.msgType === 'text' ? null : (data.mediaId ?? null),
      scheduledAt: parseDateTimeInput(data.scheduledAt),
      status: 'draft' as const,
    }),
  },
});

export async function listMpBroadcasts(q: Parameters<typeof mpBroadcastCrud.list>[0]) {
  await ensureMpAccountExists(q.accountId);
  return mpBroadcastCrud.list(q);
}

export const {
  ensure: ensureMpBroadcastExists,
  create: createMpBroadcast,
  remove: deleteMpBroadcast,
} = mpBroadcastCrud;

export const getMpBroadcastBeforeAudit = mpBroadcastCrud.get;

export async function updateMpBroadcast(id: number, data: Parameters<typeof mpBroadcastCrud.update>[1]) {
  const existing = await ensureMpBroadcastExists(id);
  if (existing.status === 'sent') throw new HTTPException(400, { message: '已发送的群发不可修改' });
  const { scheduledAt, ...rest } = data;
  const patch: Partial<typeof mpBroadcasts.$inferInsert> = { ...rest };
  // 规范化关联字段
  if (data.target === 'all') patch.tagId = null;
  if (data.msgType === 'text') patch.mediaId = null;
  else if (data.msgType === 'image' || data.msgType === 'mpnews') patch.content = null;
  if (scheduledAt !== undefined) patch.scheduledAt = parseDateTimeInput(scheduledAt);
  if (Object.keys(patch).length === 0) return mapMpBroadcast(existing);
  const [row] = await db.update(mpBroadcasts).set(patch).where(eq(mpBroadcasts.id, id)).returning();
  return mapMpBroadcast(row);
}

export const mpBroadcastService = {
  ...mpBroadcastCrud,
  list: listMpBroadcasts,
  update: updateMpBroadcast,
};

/** 发送群发：解析标签 → 调微信 mass/sendall；成功回填 msg_id/sentAt，失败落 errorMsg 并抛错。 */
export async function sendMpBroadcast(id: number) {
  const broadcast = await ensureMpBroadcastExists(id);
  if (broadcast.status === 'sent') throw new HTTPException(400, { message: '该群发已发送' });
  const account = await ensureMpAccountExists(broadcast.accountId);

  let wechatTagId: number | null = null;
  if (broadcast.target === 'tag') {
    if (!broadcast.tagId) throw new HTTPException(400, { message: '请先指定群发标签' });
    const [tag] = await db.select({ wechatTagId: mpTags.wechatTagId }).from(mpTags)
      .where(buildWhere(eq(mpTags.id, broadcast.tagId), tenantScope(mpTags))).limit(1);
    requireRow(tag, '群发标签不存在', 400);
    if (tag.wechatTagId == null) throw new HTTPException(400, { message: '该标签尚未同步到微信，无法按标签群发' });
    wechatTagId = tag.wechatTagId;
  }

  try {
    await assertContentSafe(account, broadcast.content);
    const { msgId } = await massSend(account, {
      isToAll: broadcast.target === 'all',
      tagId: wechatTagId,
      msgType: broadcast.msgType,
      content: broadcast.content,
      mediaId: broadcast.mediaId,
    });
    const [row] = await db.update(mpBroadcasts)
      .set({ status: 'sent', wechatMsgId: msgId, errorMsg: null, sentAt: new Date() })
      .where(eq(mpBroadcasts.id, id)).returning();
    return mapMpBroadcast(row);
  } catch (err) {
    const message = err instanceof WechatApiError ? err.message : '调用微信接口失败，请检查网络或稍后重试';
    await db.update(mpBroadcasts).set({ status: 'failed', errorMsg: message }).where(eq(mpBroadcasts.id, id));
    mapWechatError(err);
  }
}

/** 群发预览：发送给指定 openid 预览（不改变群发状态） */
export async function previewMpBroadcast(id: number, openid: string) {
  const broadcast = await ensureMpBroadcastExists(id);
  const account = await ensureMpAccountExists(broadcast.accountId);
  try {
    await assertContentSafe(account, broadcast.content);
    await previewMassSend(account, { msgType: broadcast.msgType, content: broadcast.content, mediaId: broadcast.mediaId, openid });
  } catch (err) {
    mapWechatError(err);
  }
  return { success: true };
}

/** 查询群发发送结果与统计 */
export async function getMpBroadcastResult(id: number) {
  const broadcast = await ensureMpBroadcastExists(id);
  if (!broadcast.wechatMsgId) throw new HTTPException(400, { message: '该群发尚未发送，无发送结果' });
  const account = await ensureMpAccountExists(broadcast.accountId);
  try {
    return await getMassSendResult(account, broadcast.wechatMsgId);
  } catch (err) {
    return mapWechatError(err);
  }
}

/** 定时群发扫描：发送所有到期（scheduledAt<=now）且仍为草稿的群发。供 mp-broadcast-tick 调用（无登录上下文）。 */
export async function runDueMpBroadcasts(): Promise<{ sent: number; failed: number }> {
  const due = await db.select().from(mpBroadcasts)
    .where(mpBroadcastDueCondition(new Date()));
  if (due.length === 0) return { sent: 0, failed: 0 };
  // 批量预取账号与标签，避免循环内逐条查询（N+1）
  const accountIds = [...new Set(due.map((b) => b.accountId))];
  const tagIds = [...new Set(due.map((b) => (b.target === 'tag' ? b.tagId : null)).filter((id): id is number => id != null))];
  const [accounts, tags] = await Promise.all([
    db.select().from(mpAccounts).where(inArray(mpAccounts.id, accountIds)),
    tagIds.length > 0
      ? db.select({ id: mpTags.id, wechatTagId: mpTags.wechatTagId }).from(mpTags).where(inArray(mpTags.id, tagIds))
      : Promise.resolve([]),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const wechatTagIdByTagId = new Map(tags.map((t) => [t.id, t.wechatTagId]));
  let sent = 0;
  let failed = 0;
  for (const b of due) {
    try {
      const account = accountById.get(b.accountId);
      if (!account || account.status === 'disabled') continue;
      const wechatTagId = b.target === 'tag' && b.tagId ? (wechatTagIdByTagId.get(b.tagId) ?? null) : null;
      await assertContentSafe(account, b.content);
      const { msgId } = await massSend(account, { isToAll: b.target === 'all', tagId: wechatTagId, msgType: b.msgType, content: b.content, mediaId: b.mediaId });
      await db.update(mpBroadcasts).set({ status: 'sent', wechatMsgId: msgId, errorMsg: null, sentAt: new Date() }).where(eq(mpBroadcasts.id, b.id));
      sent += 1;
    } catch (err) {
      await db.update(mpBroadcasts).set({ status: 'failed', errorMsg: (err as Error).message.slice(0, 500) }).where(eq(mpBroadcasts.id, b.id));
      failed += 1;
    }
  }
  return { sent, failed };
}
