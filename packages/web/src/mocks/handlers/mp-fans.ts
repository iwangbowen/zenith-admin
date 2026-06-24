import { http, HttpResponse } from 'msw';
import { mockMpFans } from '@/mocks/data/mp-fans';
import { mockDateTime } from '@/mocks/utils/date';
import type { MpFan } from '@zenith/shared';

export const mpFansHandlers = [
  http.get('/api/mp/fans', ({ request }) => {
    const url = new URL(request.url);
    const accountId = Number(url.searchParams.get('accountId') ?? '0');
    const keyword = url.searchParams.get('keyword') ?? '';
    const subscribe = url.searchParams.get('subscribe') ?? '';
    const tagId = url.searchParams.get('tagId');
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const filtered = mockMpFans.filter((f) => {
      if (f.accountId !== accountId) return false;
      if (keyword && !(f.nickname ?? '').includes(keyword) && !f.openid.includes(keyword) && !(f.remark ?? '').includes(keyword)) return false;
      if (subscribe && f.subscribe !== subscribe) return false;
      if (tagId && !f.tagIds.includes(Number(tagId))) return false;
      return true;
    });
    const total = filtered.length;
    const sorted = [...filtered].sort((a, b) => b.id - a.id);
    const list = sorted.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.post('/api/mp/fans/sync', async ({ request }) => {
    const body = await request.json() as { accountId: number };
    const count = mockMpFans.filter((f) => f.accountId === body.accountId).length;
    return HttpResponse.json({ code: 0, message: '同步完成', data: { success: true, synced: count, total: count } });
  }),

  http.put('/api/mp/fans/:id', async ({ params, request }) => {
    const f = mockMpFans.find((x) => x.id === Number(params.id));
    if (!f) return HttpResponse.json({ code: 404, message: '粉丝不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<Pick<MpFan, 'remark' | 'tagIds'>>;
    if (body.remark !== undefined) f.remark = body.remark || null;
    if (body.tagIds !== undefined) f.tagIds = body.tagIds;
    f.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '更新成功', data: f });
  }),

  http.post('/api/mp/fans/:id/create-member', ({ params }) => {
    const f = mockMpFans.find((x) => x.id === Number(params.id));
    if (!f) return HttpResponse.json({ code: 404, message: '粉丝不存在', data: null }, { status: 404 });
    if (f.memberId) return HttpResponse.json({ code: 400, message: '该粉丝已绑定会员', data: null }, { status: 400 });
    f.memberId = 9000 + f.id;
    f.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '会员已创建并绑定', data: f });
  }),

  http.post('/api/mp/fans/:id/bind-member', async ({ params, request }) => {
    const f = mockMpFans.find((x) => x.id === Number(params.id));
    if (!f) return HttpResponse.json({ code: 404, message: '粉丝不存在', data: null }, { status: 404 });
    const body = await request.json() as { memberId: number };
    f.memberId = body.memberId;
    f.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '绑定成功', data: f });
  }),

  http.post('/api/mp/fans/:id/unbind-member', ({ params }) => {
    const f = mockMpFans.find((x) => x.id === Number(params.id));
    if (!f) return HttpResponse.json({ code: 404, message: '粉丝不存在', data: null }, { status: 404 });
    f.memberId = null;
    f.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '已解绑', data: f });
  }),
];
