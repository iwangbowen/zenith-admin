import { mpBroadcastContract, type MpBroadcast } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockMpBroadcasts, getNextMpBroadcastId } from '@/mocks/data/mp-broadcasts';
import { mockDateTime } from '@/mocks/utils/date';

export const mpBroadcastsHandlers = [
  mock(mpBroadcastContract.list, ({ query, ok, paginate }) => {
    const filtered = mockMpBroadcasts.filter((b) => b.accountId === query.accountId && (!query.status || b.status === query.status));
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id)));
  }),

  mock(mpBroadcastContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const item: MpBroadcast = {
      id: getNextMpBroadcastId(), accountId: body.accountId, msgType: body.msgType, target: body.target,
      tagId: body.target === 'tag' ? (body.tagId ?? null) : null,
      content: body.msgType === 'text' ? (body.content ?? null) : null,
      mediaId: body.msgType === 'text' ? null : (body.mediaId ?? null),
      status: 'draft', wechatMsgId: null, scheduledAt: body.scheduledAt ?? null, errorMsg: null, sentAt: null, createdAt: now, updatedAt: now,
    };
    mockMpBroadcasts.push(item);
    return ok(item, '已创建群发草稿');
  }),

  mock(mpBroadcastContract.update, ({ params, body, ok }) => {
    const b = mockMpBroadcasts.find((x) => x.id === params.id);
    if (!b) return notFound('群发记录不存在', { status: 404 });
    if (b.status === 'sent') return badRequest('已发送的群发不可修改', { status: 400 });
    const { scheduledAt, ...rest } = body;
    Object.assign(b, rest, { updatedAt: mockDateTime() });
    if (scheduledAt !== undefined) b.scheduledAt = scheduledAt ?? null;
    if (b.target === 'all') b.tagId = null;
    if (b.msgType === 'text') b.mediaId = null; else b.content = null;
    return ok(b, '更新成功');
  }),

  mock(mpBroadcastContract.send, ({ params, ok }) => {
    const b = mockMpBroadcasts.find((x) => x.id === params.id);
    if (!b) return notFound('群发记录不存在', { status: 404 });
    if (b.status === 'sent') return badRequest('该群发已发送', { status: 400 });
    b.status = 'sent';
    b.wechatMsgId = `mock_mass_${Date.now()}`;
    b.errorMsg = null;
    b.sentAt = mockDateTime();
    b.updatedAt = mockDateTime();
    return ok(b, '发送成功');
  }),

  mock(mpBroadcastContract.preview, ({ params, ok }) => {
    const b = mockMpBroadcasts.find((x) => x.id === params.id);
    if (!b) return notFound('群发记录不存在', { status: 404 });
    return ok(null, '预览已发送');
  }),

  mock(mpBroadcastContract.result, ({ params, ok }) => {
    const b = mockMpBroadcasts.find((x) => x.id === params.id);
    if (!b) return notFound('群发记录不存在', { status: 404 });
    if (!b.wechatMsgId) return badRequest('该群发尚未发送，无发送结果', { status: 400 });
    return ok({ msgStatus: 'SEND_SUCCESS', totalCount: 2, filterCount: 2, sentCount: 2, errorCount: 0 });
  }),

  mock(mpBroadcastContract.remove, ({ params, ok }) => {
    const idx = mockMpBroadcasts.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('群发记录不存在', { status: 404 });
    mockMpBroadcasts.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
