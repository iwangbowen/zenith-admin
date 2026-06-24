import { http, HttpResponse } from 'msw';
import { mockMpQrcodes, getNextMpQrcodeId } from '@/mocks/data/mp-qrcodes';
import { mockDateTime } from '@/mocks/utils/date';
import type { MpQrcode } from '@zenith/shared';

export const mpQrcodesHandlers = [
  http.get('/api/mp/qrcodes', ({ request }) => {
    const url = new URL(request.url);
    const accountId = Number(url.searchParams.get('accountId') ?? '0');
    const type = url.searchParams.get('type') ?? '';
    const keyword = url.searchParams.get('keyword') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const filtered = mockMpQrcodes.filter((q) => {
      if (q.accountId !== accountId) return false;
      if (type && q.type !== type) return false;
      if (keyword && !q.name.includes(keyword) && !q.sceneStr.includes(keyword)) return false;
      return true;
    });
    const total = filtered.length;
    const list = [...filtered].sort((a, b) => b.id - a.id).slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.post('/api/mp/qrcodes', async ({ request }) => {
    const body = await request.json() as Partial<MpQrcode> & { accountId: number };
    const now = mockDateTime();
    const ticket = `MOCK_TICKET_${Date.now()}`;
    const item: MpQrcode = {
      id: getNextMpQrcodeId(), accountId: body.accountId, type: body.type ?? 'permanent', sceneStr: body.sceneStr ?? '',
      name: body.name ?? '', ticket, url: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${ticket}`,
      expireSeconds: body.type === 'temporary' ? (body.expireSeconds ?? 604800) : null, scanCount: 0, rewardPoints: body.rewardPoints ?? 0, createdAt: now, updatedAt: now,
    };
    mockMpQrcodes.push(item);
    return HttpResponse.json({ code: 0, message: '生成成功', data: item });
  }),

  http.delete('/api/mp/qrcodes/:id', ({ params }) => {
    const idx = mockMpQrcodes.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '二维码不存在', data: null }, { status: 404 });
    mockMpQrcodes.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
