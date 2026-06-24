import { http, HttpResponse } from 'msw';
import { mockMpBroadcasts, getNextMpBroadcastId } from '@/mocks/data/mp-broadcasts';
import { mockDateTime } from '@/mocks/utils/date';
import type { MpBroadcast } from '@zenith/shared';

export const mpBroadcastsHandlers = [
  http.get('/api/mp/broadcasts', ({ request }) => {
    const url = new URL(request.url);
    const accountId = Number(url.searchParams.get('accountId') ?? '0');
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const filtered = mockMpBroadcasts.filter((b) => b.accountId === accountId && (!status || b.status === status));
    const total = filtered.length;
    const list = [...filtered].sort((a, b) => b.id - a.id).slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.post('/api/mp/broadcasts', async ({ request }) => {
    const body = await request.json() as Partial<MpBroadcast> & { accountId: number };
    const now = mockDateTime();
    const item: MpBroadcast = {
      id: getNextMpBroadcastId(), accountId: body.accountId, msgType: body.msgType ?? 'text', target: body.target ?? 'all',
      tagId: body.target === 'tag' ? (body.tagId ?? null) : null,
      content: body.msgType === 'text' ? (body.content ?? null) : null,
      mediaId: body.msgType === 'text' ? null : (body.mediaId ?? null),
      status: 'draft', wechatMsgId: null, scheduledAt: body.scheduledAt ?? null, errorMsg: null, sentAt: null, createdAt: now, updatedAt: now,
    };
    mockMpBroadcasts.push(item);
    return HttpResponse.json({ code: 0, message: '已创建群发草稿', data: item });
  }),

  http.put('/api/mp/broadcasts/:id', async ({ params, request }) => {
    const b = mockMpBroadcasts.find((x) => x.id === Number(params.id));
    if (!b) return HttpResponse.json({ code: 404, message: '群发记录不存在', data: null }, { status: 404 });
    if (b.status === 'sent') return HttpResponse.json({ code: 400, message: '已发送的群发不可修改', data: null }, { status: 400 });
    const body = await request.json() as Partial<MpBroadcast>;
    Object.assign(b, body, { updatedAt: mockDateTime() });
    if (b.target === 'all') b.tagId = null;
    if (b.msgType === 'text') b.mediaId = null; else b.content = null;
    return HttpResponse.json({ code: 0, message: '更新成功', data: b });
  }),

  http.post('/api/mp/broadcasts/:id/send', ({ params }) => {
    const b = mockMpBroadcasts.find((x) => x.id === Number(params.id));
    if (!b) return HttpResponse.json({ code: 404, message: '群发记录不存在', data: null }, { status: 404 });
    if (b.status === 'sent') return HttpResponse.json({ code: 400, message: '该群发已发送', data: null }, { status: 400 });
    b.status = 'sent';
    b.wechatMsgId = `mock_mass_${Date.now()}`;
    b.errorMsg = null;
    b.sentAt = mockDateTime();
    b.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '发送成功', data: b });
  }),

  http.post('/api/mp/broadcasts/:id/preview', async ({ params }) => {
    const b = mockMpBroadcasts.find((x) => x.id === Number(params.id));
    if (!b) return HttpResponse.json({ code: 404, message: '群发记录不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: '预览已发送', data: null });
  }),

  http.get('/api/mp/broadcasts/:id/result', ({ params }) => {
    const b = mockMpBroadcasts.find((x) => x.id === Number(params.id));
    if (!b) return HttpResponse.json({ code: 404, message: '群发记录不存在', data: null }, { status: 404 });
    if (!b.wechatMsgId) return HttpResponse.json({ code: 400, message: '该群发尚未发送，无发送结果', data: null }, { status: 400 });
    return HttpResponse.json({ code: 0, message: 'ok', data: { msgStatus: 'SEND_SUCCESS', totalCount: 2, filterCount: 2, sentCount: 2, errorCount: 0 } });
  }),

  http.delete('/api/mp/broadcasts/:id', ({ params }) => {
    const idx = mockMpBroadcasts.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '群发记录不存在', data: null }, { status: 404 });
    mockMpBroadcasts.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
