import { mpKfSessionContract, type MpKfSessionReportItem, type MpMessage } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import {
  mockMpKfSessions, mockMpKfSessionEvents, mockMpKfMessages,
  buildMpKfStats, ensureMpKfConfig, getNextMpKfEventId, getNextMpKfMessageId,
} from '@/mocks/data/mp-kf-sessions';
import { mockMpKfAccounts } from '@/mocks/data/mp-kf-accounts';
import { mockDateTime } from '@/mocks/utils/date';

function kfNick(kfId: number | null): string | null {
  if (!kfId) return null;
  return mockMpKfAccounts.find((k) => k.id === kfId)?.nickname ?? null;
}

export const mpKfSessionsHandlers = [
  // 静态子路径 stats / config / report 必须在 :id 之前注册
  mock(mpKfSessionContract.list, ({ query, ok, paginate }) => {
    const filtered = mockMpKfSessions.filter((s) =>
      s.accountId === query.accountId
      && (!query.status || s.status === query.status)
      && (!query.kfId || s.kfId === query.kfId)
      && (!query.keyword || s.openid.includes(query.keyword) || (s.fanNickname ?? '').includes(query.keyword)));
    return ok(paginate(filtered));
  }),

  mock(mpKfSessionContract.stats, ({ query, ok }) => ok(buildMpKfStats(query.accountId))),

  mock(mpKfSessionContract.config, ({ query, ok }) => ok(ensureMpKfConfig(query.accountId))),

  mock(mpKfSessionContract.report, ({ query, ok }) => {
    const out: MpKfSessionReportItem[] = [];
    for (let i = (query.days ?? 7) - 1; i >= 0; i -= 1) {
      const d = new Date(); d.setDate(d.getDate() - i);
      out.push({ date: d.toISOString().slice(0, 10), created: Math.floor(Math.random() * 6), closed: Math.floor(Math.random() * 5), avgWaitSeconds: 20 + Math.floor(Math.random() * 40), avgRating: 4 + Math.round(Math.random() * 10) / 10 });
    }
    return ok(out);
  }),

  mock(mpKfSessionContract.updateConfig, ({ query, body, ok }) => {
    const cfg = ensureMpKfConfig(query.accountId);
    Object.assign(cfg, body, { updatedAt: mockDateTime() });
    return ok(cfg, '已保存');
  }),

  mock(mpKfSessionContract.accept, ({ params, body, ok }) => {
    const s = mockMpKfSessions.find((x) => x.id === params.id);
    if (!s) return notFound('会话不存在', { status: 404 });
    const now = mockDateTime();
    s.status = 'active'; s.kfId = body.kfId; s.kfNickname = kfNick(body.kfId); s.acceptedAt = now; s.waitingSince = null; s.waitSeconds = undefined; s.lastMsgAt = now;
    mockMpKfSessionEvents.push({ id: getNextMpKfEventId(), sessionId: s.id, accountId: s.accountId, type: 'accept', fromKfId: null, toKfId: body.kfId, fromKfNickname: null, toKfNickname: kfNick(body.kfId), operatorId: null, operatorName: '管理员', detail: '人工接入', createdAt: now });
    return ok(s, '接入成功');
  }),

  mock(mpKfSessionContract.transfer, ({ params, body, ok }) => {
    const s = mockMpKfSessions.find((x) => x.id === params.id);
    if (!s) return notFound('会话不存在', { status: 404 });
    const now = mockDateTime();
    const fromKfId = s.kfId;
    s.kfId = body.toKfId; s.kfNickname = kfNick(body.toKfId); s.lastMsgAt = now;
    mockMpKfSessionEvents.push({ id: getNextMpKfEventId(), sessionId: s.id, accountId: s.accountId, type: 'transfer', fromKfId, toKfId: body.toKfId, fromKfNickname: kfNick(fromKfId), toKfNickname: kfNick(body.toKfId), operatorId: null, operatorName: '管理员', detail: body.remark ? `转接：${body.remark}` : '人工转接', createdAt: now });
    return ok(s, '转接成功');
  }),

  mock(mpKfSessionContract.close, ({ params, body, ok }) => {
    const s = mockMpKfSessions.find((x) => x.id === params.id);
    if (!s) return notFound('会话不存在', { status: 404 });
    const now = mockDateTime();
    s.status = 'closed'; s.closedAt = now; s.closeReason = 'manual'; s.unreadCount = 0; s.remark = body.remark ?? s.remark;
    mockMpKfSessionEvents.push({ id: getNextMpKfEventId(), sessionId: s.id, accountId: s.accountId, type: 'close', fromKfId: s.kfId, toKfId: null, fromKfNickname: kfNick(s.kfId), toKfNickname: null, operatorId: null, operatorName: '管理员', detail: '手动结束', createdAt: now });
    return ok(s, '已结束');
  }),

  mock(mpKfSessionContract.rate, ({ params, body, ok }) => {
    const s = mockMpKfSessions.find((x) => x.id === params.id);
    if (!s) return notFound('会话不存在', { status: 404 });
    s.rating = body.rating; s.ratingRemark = body.remark ?? null;
    return ok(s, '已记录');
  }),

  mock(mpKfSessionContract.reply, ({ params, body, ok }) => {
    const s = mockMpKfSessions.find((x) => x.id === params.id);
    if (!s) return notFound('会话不存在', { status: 404 });
    const now = mockDateTime();
    const msg: MpMessage = {
      id: getNextMpKfMessageId(), accountId: s.accountId, openid: s.openid, direction: 'out',
      msgType: body.msgType === 'news' ? 'text' : body.msgType, content: body.content ?? '', mediaId: body.mediaId ?? null, mediaUrl: null, event: null,
      msgId: null, status: 'sent', errorMsg: null, createdAt: now,
    };
    mockMpKfMessages.push(msg);
    s.lastKfMsgAt = now; s.lastMsgAt = now; s.unreadCount = 0;
    return ok(s, '已发送');
  }),

  // 详情（含消息与事件时间线）：动态 :id 放在静态子路径之后
  mock(mpKfSessionContract.detail, ({ params, ok }) => {
    const s = mockMpKfSessions.find((x) => x.id === params.id);
    if (!s) return notFound('会话不存在', { status: 404 });
    const events = mockMpKfSessionEvents.filter((e) => e.sessionId === s.id).sort((a, b) => a.id - b.id);
    const messages = mockMpKfMessages.filter((m) => m.accountId === s.accountId && m.openid === s.openid).slice(-50);
    return ok({ ...s, events, messages });
  }),
];
