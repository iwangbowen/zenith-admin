import { mpTagContract, type MpTag } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockMpTags, getNextMpTagId } from '@/mocks/data/mp-tags';
import { mockMpFans } from '@/mocks/data/mp-fans';
import { mockDateTime } from '@/mocks/utils/date';

export const mpTagsHandlers = [
  mock(mpTagContract.list, ({ query, ok, paginate }) => {
    const filtered = mockMpTags.filter((t) => t.accountId === query.accountId && (!query.keyword || t.name.includes(query.keyword)));
    return ok(paginate(filtered));
  }),

  mock(mpTagContract.sync, ({ body, ok }) => {
    const total = mockMpTags.filter((t) => t.accountId === body.accountId).length;
    return ok({ success: true, created: 0, updated: total, total }, '同步完成');
  }),

  mock(mpTagContract.create, ({ body, ok }) => {
    if (mockMpTags.some((t) => t.accountId === body.accountId && t.name === body.name)) {
      return badRequest('该标签名称已存在', { status: 400 });
    }
    const now = mockDateTime();
    const item: MpTag = { id: getNextMpTagId(), accountId: body.accountId, wechatTagId: null, name: body.name, fansCount: 0, createdAt: now, updatedAt: now };
    mockMpTags.push(item);
    return ok(item, '创建成功');
  }),

  mock(mpTagContract.update, ({ params, body, ok }) => {
    const t = mockMpTags.find((x) => x.id === params.id);
    if (!t) return notFound('标签不存在', { status: 404 });
    if (body.name !== t.name && mockMpTags.some((x) => x.accountId === t.accountId && x.name === body.name)) {
      return badRequest('该标签名称已存在', { status: 400 });
    }
    t.name = body.name;
    t.updatedAt = mockDateTime();
    return ok(t, '更新成功');
  }),

  mock(mpTagContract.remove, ({ params, ok }) => {
    const idx = mockMpTags.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('标签不存在', { status: 404 });
    const [removed] = mockMpTags.splice(idx, 1);
    // 从粉丝本地标签中移除
    mockMpFans.forEach((f) => { f.tagIds = f.tagIds.filter((id) => id !== removed.id); });
    return ok(null, '删除成功');
  }),
];
