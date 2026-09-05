import { mpQrcodeContract, type MpQrcode } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockMpQrcodes, getNextMpQrcodeId } from '@/mocks/data/mp-qrcodes';
import { mockDateTime } from '@/mocks/utils/date';

export const mpQrcodesHandlers = [
  mock(mpQrcodeContract.list, ({ query, ok, paginate }) => {
    const filtered = mockMpQrcodes.filter((q) => {
      if (q.accountId !== query.accountId) return false;
      if (query.type && q.type !== query.type) return false;
      if (query.keyword && !q.name.includes(query.keyword) && !q.sceneStr.includes(query.keyword)) return false;
      return true;
    });
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id)));
  }),

  mock(mpQrcodeContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const ticket = `MOCK_TICKET_${Date.now()}`;
    const item: MpQrcode = {
      id: getNextMpQrcodeId(), accountId: body.accountId, type: body.type, sceneStr: body.sceneStr,
      name: body.name, ticket, url: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${ticket}`,
      expireSeconds: body.type === 'temporary' ? (body.expireSeconds ?? 604800) : null, scanCount: 0, rewardPoints: body.rewardPoints, createdAt: now, updatedAt: now,
    };
    mockMpQrcodes.push(item);
    return ok(item, '生成成功');
  }),

  mock(mpQrcodeContract.remove, ({ params, ok }) => {
    const idx = mockMpQrcodes.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('二维码不存在', { status: 404 });
    mockMpQrcodes.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
