import { http, HttpResponse } from 'msw';
import {
  mockMpKfSessions, mockMpKfSessionEvents, mockMpKfMessages,
  buildMpKfStats, ensureMpKfConfig, getNextMpKfEventId, getNextMpKfMessageId,
} from '@/mocks/data/mp-kf-sessions';
import { mockMpKfAccounts } from '@/mocks/data/mp-kf-accounts';
import { mockDateTime } from '@/mocks/utils/date';
import type { MpMessage } from '@zenith/shared';

function kfNick(kfId: number | null): string | null {
  if (!kfId) return null;
  return mockMpKfAccounts.find((k) => k.id === kfId)?.nickname ?? null;
}

export const mpKfSessionsHandlers = [
  // 列表（注意：静态子路径 stats/config 必须在 :id 之前注册）
  http.get('/api/mp/kf-sessions', ({ request }) => {
    const url = new URL(request.url);
    const accountId = Number(url.searchParams.get('accountId') ?? '0');
    const status = url.searchParams.get('status') ?? '';
    const keyword = url.searchParams.get('keyword') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '50');
    const filtered = mockMpKfSessions.filter((s) =>
      s.accountId === accountId
      && (!status || s.status === status)
      && (!keyword || s.openid.includes(keyword) || (s.fanNickname ?? '').includes(keyword)));
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.get('/api/mp/kf-sessions/stats', ({ request }) => {
    const accountId = Number(new URL(request.url).searchParams.get('accountId') ?? '0');
    return HttpResponse.json({ code: 0, message: 'ok', data: buildMpKfStats(accountId) });
  }),

  http.get('/api/mp/kf-sessions/config', ({ request }) => {
    const accountId = Number(new URL(request.url).searchParams.get('accountId') ?? '0');
    return HttpResponse.json({ code: 0, message: 'ok', data: ensureMpKfConfig(accountId) });
  }),

  http.put('/api/mp/kf-sessions/config', async ({ request }) => {
    const accountId = Number(new URL(request.url).searchParams.get('accountId') ?? '0');
    const body = await request.json() as Record<string, unknown>;
    const cfg = ensureMpKfConfig(accountId);
    Object.assign(cfg, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '已保存', data: cfg });
  }),

  http.post('/api/mp/kf-sessions/:id/accept', async ({ params, request }) => {
    const s = mockMpKfSessions.find((x) => x.id === Number(params.id));
    if (!s) return HttpResponse.json({ code: 404, message: '会话不存在', data: null }, { status: 404 });
    const body = await request.json() as { kfId: number };
    const now = mockDateTime();
    s.status = 'active'; s.kfId = body.kfId; s.kfNickname = kfNick(body.kfId); s.acceptedAt = now; s.waitingSince = null; s.waitSeconds = undefined; s.lastMsgAt = now;
    mockMpKfSessionEvents.push({ id: getNextMpKfEventId(), sessionId: s.id, accountId: s.accountId, type: 'accept', fromKfId: null, toKfId: body.kfId, fromKfNickname: null, toKfNickname: kfNick(body.kfId), operatorId: null, operatorName: '管理员', detail: '人工接入', createdAt: now });
    return HttpResponse.json({ code: 0, message: '接入成功', data: s });
  }),

  http.post('/api/mp/kf-sessions/:id/transfer', async ({ params, request }) => {
    const s = mockMpKfSessions.find((x) => x.id === Number(params.id));
    if (!s) return HttpResponse.json({ code: 404, message: '会话不存在', data: null }, { status: 404 });
    const body = await request.json() as { toKfId: number; remark?: string };
    const now = mockDateTime();
    const fromKfId = s.kfId;
    s.kfId = body.toKfId; s.kfNickname = kfNick(body.toKfId); s.lastMsgAt = now;
    mockMpKfSessionEvents.push({ id: getNextMpKfEventId(), sessionId: s.id, accountId: s.accountId, type: 'transfer', fromKfId, toKfId: body.toKfId, fromKfNickname: kfNick(fromKfId), toKfNickname: kfNick(body.toKfId), operatorId: null, operatorName: '管理员', detail: body.remark ? `转接：${body.remark}` : '人工转接', createdAt: now });
    return HttpResponse.json({ code: 0, message: '转接成功', data: s });
  }),

  http.post('/api/mp/kf-sessions/:id/close', ({ params }) => {
    const s = mockMpKfSessions.find((x) => x.id === Number(params.id));
    if (!s) return HttpResponse.json({ code: 404, message: '会话不存在', data: null }, { status: 404 });
    const now = mockDateTime();
    s.status = 'closed'; s.closedAt = now; s.closeReason = 'manual'; s.unreadCount = 0;
    mockMpKfSessionEvents.push({ id: getNextMpKfEventId(), sessionId: s.id, accountId: s.accountId, type: 'close', fromKfId: s.kfId, toKfId: null, fromKfNickname: kfNick(s.kfId), toKfNickname: null, operatorId: null, operatorName: '管理员', detail: '手动结束', createdAt: now });
    return HttpResponse.json({ code: 0, message: '已结束', data: s });
  }),

  http.post('/api/mp/kf-sessions/:id/reply', async ({ params, request }) => {
    const s = mockMpKfSessions.find((x) => x.id === Number(params.id));
    if (!s) return HttpResponse.json({ code: 404, message: '会话不存在', data: null }, { status: 404 });
    const body = await request.json() as { msgType: string; content?: string };
    const now = mockDateTime();
    const msg: MpMessage = {
      id: getNextMpKfMessageId(), accountId: s.accountId, openid: s.openid, direction: 'out',
      msgType: 'text', content: body.content ?? '', mediaId: null, mediaUrl: null, event: null,
      msgId: null, status: 'sent', errorMsg: null, createdAt: now,
    };
    mockMpKfMessages.push(msg);
    s.lastKfMsgAt = now; s.lastMsgAt = now; s.unreadCount = 0;
    return HttpResponse.json({ code: 0, message: '已发送', data: s });
  }),

  // 详情（含消息与事件时间线）—— 必须在 stats/config 之后注册
  http.get('/api/mp/kf-sessions/:id', ({ params }) => {
    const s = mockMpKfSessions.find((x) => x.id === Number(params.id));
    if (!s) return HttpResponse.json({ code: 404, message: '会话不存在', data: null }, { status: 404 });
    const events = mockMpKfSessionEvents.filter((e) => e.sessionId === s.id).sort((a, b) => a.id - b.id);
    const messages = mockMpKfMessages.filter((m) => m.accountId === s.accountId && m.openid === s.openid).slice(-50);
    return HttpResponse.json({ code: 0, message: 'ok', data: { ...s, events, messages } });
  }),
];
