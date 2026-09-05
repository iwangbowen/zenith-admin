import { mpFanContract } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockMpFans } from '@/mocks/data/mp-fans';
import { mockDateTime } from '@/mocks/utils/date';

export const mpFansHandlers = [
  mock(mpFanContract.list, ({ query, ok, paginate }) => {
    const filtered = mockMpFans.filter((f) => {
      if (f.accountId !== query.accountId) return false;
      if (query.keyword && !(f.nickname ?? '').includes(query.keyword) && !f.openid.includes(query.keyword) && !(f.remark ?? '').includes(query.keyword)) return false;
      if (query.subscribe && f.subscribe !== query.subscribe) return false;
      if (query.tagId && !f.tagIds.includes(query.tagId)) return false;
      if (query.blacklisted !== undefined && f.blacklisted !== query.blacklisted) return false;
      return true;
    });
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id)));
  }),

  mock(mpFanContract.sync, ({ body, ok }) => {
    const count = mockMpFans.filter((f) => f.accountId === body.accountId).length;
    return ok({ success: true, synced: count, total: count }, '同步完成');
  }),

  mock(mpFanContract.blacklist, ({ body, ok }) => {
    for (const f of mockMpFans) if (f.accountId === body.accountId && body.openids.includes(f.openid)) f.blacklisted = true;
    return ok({ success: true, count: body.openids.length }, '已拉黑');
  }),

  mock(mpFanContract.unblacklist, ({ body, ok }) => {
    for (const f of mockMpFans) if (f.accountId === body.accountId && body.openids.includes(f.openid)) f.blacklisted = false;
    return ok({ success: true, count: body.openids.length }, '已移出');
  }),

  mock(mpFanContract.syncBlacklist, ({ body, ok }) => {
    const count = mockMpFans.filter((f) => f.accountId === body.accountId && f.blacklisted).length;
    return ok({ success: true, synced: count, total: count }, '同步完成');
  }),

  mock(mpFanContract.update, ({ params, body, ok }) => {
    const f = mockMpFans.find((x) => x.id === params.id);
    if (!f) return notFound('粉丝不存在', { status: 404 });
    if (body.remark !== undefined) f.remark = body.remark || null;
    if (body.tagIds !== undefined) f.tagIds = body.tagIds;
    f.updatedAt = mockDateTime();
    return ok(f, '更新成功');
  }),

  mock(mpFanContract.createMember, ({ params, ok }) => {
    const f = mockMpFans.find((x) => x.id === params.id);
    if (!f) return notFound('粉丝不存在', { status: 404 });
    if (f.memberId) return badRequest('该粉丝已绑定会员', { status: 400 });
    f.memberId = 9000 + f.id;
    f.updatedAt = mockDateTime();
    return ok(f, '会员已创建并绑定');
  }),

  mock(mpFanContract.bindMember, ({ params, body, ok }) => {
    const f = mockMpFans.find((x) => x.id === params.id);
    if (!f) return notFound('粉丝不存在', { status: 404 });
    f.memberId = body.memberId;
    f.updatedAt = mockDateTime();
    return ok(f, '绑定成功');
  }),

  mock(mpFanContract.unbindMember, ({ params, ok }) => {
    const f = mockMpFans.find((x) => x.id === params.id);
    if (!f) return notFound('粉丝不存在', { status: 404 });
    f.memberId = null;
    f.updatedAt = mockDateTime();
    return ok(f, '已解绑');
  }),
];
