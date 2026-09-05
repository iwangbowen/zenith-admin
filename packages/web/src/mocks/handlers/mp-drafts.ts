import { mpDraftContract, type MpDraft } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockMpDrafts, getNextMpDraftId } from '@/mocks/data/mp-drafts';
import { mockDateTime } from '@/mocks/utils/date';

export const mpDraftsHandlers = [
  mock(mpDraftContract.list, ({ query, ok, paginate }) => {
    const filtered = mockMpDrafts.filter((d) => d.accountId === query.accountId && (!query.keyword || d.title.includes(query.keyword)));
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id)));
  }),

  mock(mpDraftContract.detail, ({ params, ok }) => {
    const d = mockMpDrafts.find((x) => x.id === params.id);
    if (!d) return notFound('图文草稿不存在', { status: 404 });
    return ok(d);
  }),

  mock(mpDraftContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const item: MpDraft = {
      id: getNextMpDraftId(), accountId: body.accountId, title: body.articles[0]?.title ?? '未命名图文',
      articles: body.articles, wechatMediaId: null, status: 'draft', createdAt: now, updatedAt: now,
    };
    mockMpDrafts.push(item);
    return ok(item, '创建成功');
  }),

  mock(mpDraftContract.update, ({ params, body, ok }) => {
    const d = mockMpDrafts.find((x) => x.id === params.id);
    if (!d) return notFound('图文草稿不存在', { status: 404 });
    d.articles = body.articles;
    d.title = body.articles[0]?.title ?? '未命名图文';
    d.status = 'draft';
    d.wechatMediaId = null;
    d.updatedAt = mockDateTime();
    return ok(d, '更新成功');
  }),

  mock(mpDraftContract.push, ({ params, ok }) => {
    const d = mockMpDrafts.find((x) => x.id === params.id);
    if (!d) return notFound('图文草稿不存在', { status: 404 });
    d.status = 'published';
    d.wechatMediaId = `mock_draft_${d.id}`;
    d.updatedAt = mockDateTime();
    return ok(d, '推送成功');
  }),

  mock(mpDraftContract.remove, ({ params, ok }) => {
    const idx = mockMpDrafts.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('图文草稿不存在', { status: 404 });
    mockMpDrafts.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
