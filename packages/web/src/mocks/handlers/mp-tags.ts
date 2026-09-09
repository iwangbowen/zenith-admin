import { mpTagContract, type MpTag } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { removeItem, requireItem } from '@/mocks/utils/crud';
import { badRequest } from '@/mocks/utils/handlers';
import { mockMpTags, getNextMpTagId } from '@/mocks/data/mp-tags';
import { mockMpFans } from '@/mocks/data/mp-fans';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';

export const mpTagsHandlers = [
  mock(mpTagContract.list, ({ query, ok, paginate }) => {
    const filtered = filterByKeyword(mockMpTags, query.keyword, [(t) => t.name]).filter((t) => t.accountId === query.accountId);
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
    const t = requireItem(mockMpTags, params.id, '标签不存在', { status: 404 });
    if (body.name !== t.name && mockMpTags.some((x) => x.accountId === t.accountId && x.name === body.name)) {
      return badRequest('该标签名称已存在', { status: 400 });
    }
    t.name = body.name;
    t.updatedAt = mockDateTime();
    return ok(t, '更新成功');
  }),

  mock(mpTagContract.remove, ({ params, ok }) => {
    const removed = removeItem(mockMpTags, params.id, '标签不存在', { status: 404 });
    // 从粉丝本地标签中移除
    mockMpFans.forEach((f) => { f.tagIds = f.tagIds.filter((id) => id !== removed.id); });
    return ok(null, '删除成功');
  }),
];
