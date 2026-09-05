import { mpKfAccountContract, type MpKfAccount } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockMpKfAccounts, getNextMpKfAccountId } from '@/mocks/data/mp-kf-accounts';
import { mockDateTime } from '@/mocks/utils/date';

export const mpKfAccountsHandlers = [
  mock(mpKfAccountContract.list, ({ query, ok, paginate }) => {
    const filtered = mockMpKfAccounts.filter((k) => k.accountId === query.accountId && (!query.keyword || k.nickname.includes(query.keyword)));
    return ok(paginate(filtered));
  }),

  mock(mpKfAccountContract.sync, ({ body, ok }) => {
    const total = mockMpKfAccounts.filter((k) => k.accountId === body.accountId).length;
    return ok({ success: true, created: 0, updated: total, total }, '同步完成');
  }),

  mock(mpKfAccountContract.create, ({ body, ok }) => {
    if (mockMpKfAccounts.some((k) => k.accountId === body.accountId && k.kfAccount === body.kfAccount)) {
      return badRequest('该客服账号已存在', { status: 400 });
    }
    const now = mockDateTime();
    const item: MpKfAccount = {
      id: getNextMpKfAccountId(), accountId: body.accountId, kfAccount: body.kfAccount, nickname: body.nickname,
      avatar: null, kfId: null, inviteStatus: 'none', inviteWx: null, status: 'enabled', createdAt: now, updatedAt: now,
    };
    mockMpKfAccounts.push(item);
    return ok(item, '创建成功');
  }),

  mock(mpKfAccountContract.update, ({ params, body, ok }) => {
    const k = mockMpKfAccounts.find((x) => x.id === params.id);
    if (!k) return notFound('客服账号不存在', { status: 404 });
    k.nickname = body.nickname;
    k.updatedAt = mockDateTime();
    return ok(k, '更新成功');
  }),

  mock(mpKfAccountContract.remove, ({ params, ok }) => {
    const idx = mockMpKfAccounts.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('客服账号不存在', { status: 404 });
    mockMpKfAccounts.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
