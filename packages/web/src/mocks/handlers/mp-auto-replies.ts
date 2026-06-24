import { http, HttpResponse } from 'msw';
import { mockMpAutoReplies, getNextMpAutoReplyId } from '@/mocks/data/mp-auto-replies';
import { mockDateTime } from '@/mocks/utils/date';
import type { MpAutoReply } from '@zenith/shared';

export const mpAutoRepliesHandlers = [
  http.get('/api/mp/auto-replies', ({ request }) => {
    const url = new URL(request.url);
    const accountId = Number(url.searchParams.get('accountId') ?? '0');
    const replyType = url.searchParams.get('replyType') ?? '';
    const keyword = url.searchParams.get('keyword') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const filtered = mockMpAutoReplies.filter((r) => {
      if (r.accountId !== accountId) return false;
      if (replyType && r.replyType !== replyType) return false;
      if (keyword && !(r.keyword ?? '').includes(keyword)) return false;
      return true;
    });
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.post('/api/mp/auto-replies', async ({ request }) => {
    const body = await request.json() as Partial<MpAutoReply> & { accountId: number; replyType: MpAutoReply['replyType'] };
    if ((body.replyType === 'subscribe' || body.replyType === 'default')
      && mockMpAutoReplies.some((r) => r.accountId === body.accountId && r.replyType === body.replyType)) {
      return HttpResponse.json({ code: 400, message: body.replyType === 'subscribe' ? '已存在关注回复，请直接编辑' : '已存在默认回复，请直接编辑', data: null }, { status: 400 });
    }
    const now = mockDateTime();
    const item: MpAutoReply = {
      id: getNextMpAutoReplyId(),
      accountId: body.accountId,
      replyType: body.replyType,
      keyword: body.keyword ?? null,
      matchType: body.matchType ?? 'contain',
      contentType: body.contentType ?? 'text',
      content: body.content ?? null,
      mediaId: body.mediaId ?? null,
      newsArticles: body.newsArticles ?? null,
      transferToKf: body.transferToKf ?? false,
      status: body.status ?? 'enabled',
      sort: body.sort ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    mockMpAutoReplies.push(item);
    return HttpResponse.json({ code: 0, message: '创建成功', data: item });
  }),

  http.put('/api/mp/auto-replies/:id', async ({ params, request }) => {
    const r = mockMpAutoReplies.find((x) => x.id === Number(params.id));
    if (!r) return HttpResponse.json({ code: 404, message: '自动回复不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<MpAutoReply>;
    Object.assign(r, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: r });
  }),

  http.delete('/api/mp/auto-replies/:id', ({ params }) => {
    const idx = mockMpAutoReplies.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '自动回复不存在', data: null }, { status: 404 });
    mockMpAutoReplies.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
