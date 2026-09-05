import { mpAutoReplyContract, type MpAutoReply, type MpUnmatchedKeyword } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockMpAutoReplies, getNextMpAutoReplyId } from '@/mocks/data/mp-auto-replies';
import { mockDateTime } from '@/mocks/utils/date';

export const mpAutoRepliesHandlers = [
  mock(mpAutoReplyContract.unmatched, ({ query, ok, paginate }) => {
    const demo: MpUnmatchedKeyword[] = [
      { id: 1, accountId: query.accountId, keyword: '退款', count: 12, lastAt: mockDateTime() },
      { id: 2, accountId: query.accountId, keyword: '发货时间', count: 7, lastAt: mockDateTime() },
      { id: 3, accountId: query.accountId, keyword: '怎么投诉', count: 3, lastAt: mockDateTime() },
    ];
    return ok(paginate(demo));
  }),

  mock(mpAutoReplyContract.removeUnmatched, ({ ok }) => ok(null, '已删除')),

  mock(mpAutoReplyContract.list, ({ query, ok, paginate }) => {
    const filtered = mockMpAutoReplies.filter((r) => {
      if (r.accountId !== query.accountId) return false;
      if (query.replyType && r.replyType !== query.replyType) return false;
      if (query.keyword && !(r.keyword ?? '').includes(query.keyword)) return false;
      return true;
    });
    return ok(paginate(filtered));
  }),

  mock(mpAutoReplyContract.create, ({ body, ok }) => {
    if ((body.replyType === 'subscribe' || body.replyType === 'default')
      && mockMpAutoReplies.some((r) => r.accountId === body.accountId && r.replyType === body.replyType)) {
      return badRequest(body.replyType === 'subscribe' ? '已存在关注回复，请直接编辑' : '已存在默认回复，请直接编辑', { status: 400 });
    }
    const now = mockDateTime();
    const item: MpAutoReply = {
      id: getNextMpAutoReplyId(),
      accountId: body.accountId,
      replyType: body.replyType,
      keyword: body.keyword ?? null,
      matchType: body.matchType,
      contentType: body.contentType,
      content: body.content ?? null,
      mediaId: body.mediaId ?? null,
      newsArticles: body.newsArticles ?? null,
      transferToKf: body.transferToKf,
      status: body.status,
      sort: body.sort,
      createdAt: now,
      updatedAt: now,
    };
    mockMpAutoReplies.push(item);
    return ok(item, '创建成功');
  }),

  mock(mpAutoReplyContract.update, ({ params, body, ok }) => {
    const r = mockMpAutoReplies.find((x) => x.id === params.id);
    if (!r) return notFound('自动回复不存在', { status: 404 });
    Object.assign(r, body, { updatedAt: mockDateTime() });
    return ok(r, '更新成功');
  }),

  mock(mpAutoReplyContract.remove, ({ params, ok }) => {
    const idx = mockMpAutoReplies.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('自动回复不存在', { status: 404 });
    mockMpAutoReplies.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
