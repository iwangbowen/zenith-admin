import { mpAccountContract, type MpAccount } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockMpAccounts, getNextMpAccountId } from '@/mocks/data/mp-accounts';
import { mockDateTime } from '@/mocks/utils/date';

/** 列表脱敏：appSecret 显示掩码 */
function maskSafe(a: MpAccount): MpAccount {
  return { ...a, appSecret: a.appSecret ? '******' : '' };
}

/** 编辑回显：appSecret 留空 */
function maskForEdit(a: MpAccount): MpAccount {
  return { ...a, appSecret: '' };
}

export const mpAccountsHandlers = [
  mock(mpAccountContract.list, ({ query, ok, paginate }) => {
    const filtered = mockMpAccounts.filter((a) => {
      if (query.keyword && !a.name.includes(query.keyword) && !(a.account ?? '').includes(query.keyword) && !a.appId.includes(query.keyword)) return false;
      if (query.type && a.type !== query.type) return false;
      if (query.status && a.status !== query.status) return false;
      return true;
    });
    return ok(paginate(filtered.map(maskSafe)));
  }),

  mock(mpAccountContract.detail, ({ params, ok }) => {
    const a = mockMpAccounts.find((x) => x.id === params.id);
    if (!a) return notFound('公众号不存在', { status: 404 });
    return ok(maskForEdit(a));
  }),

  mock(mpAccountContract.create, ({ body, ok }) => {
    if (mockMpAccounts.some((a) => a.appId === body.appId)) {
      return badRequest('该 AppID 已存在', { status: 400 });
    }
    const now = mockDateTime();
    const item: MpAccount = {
      id: getNextMpAccountId(),
      name: body.name,
      account: body.account ?? null,
      appId: body.appId,
      appSecret: body.appSecret,
      token: body.token,
      encodingAesKey: body.encodingAesKey ?? null,
      encryptMode: body.encryptMode,
      type: body.type,
      qrCodeUrl: body.qrCodeUrl ?? null,
      isDefault: body.isDefault,
      autoCreateMember: body.autoCreateMember,
      contentCheckEnabled: body.contentCheckEnabled,
      status: body.status,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    if (item.isDefault) mockMpAccounts.forEach((a) => { a.isDefault = false; });
    mockMpAccounts.push(item);
    return ok(maskSafe(item), '创建成功');
  }),

  mock(mpAccountContract.update, ({ params, body, ok }) => {
    const a = mockMpAccounts.find((x) => x.id === params.id);
    if (!a) return notFound('公众号不存在', { status: 404 });
    if (body.appId && body.appId !== a.appId && mockMpAccounts.some((x) => x.appId === body.appId)) {
      return badRequest('该 AppID 已存在', { status: 400 });
    }
    const next = { ...body };
    if (!next.appSecret) delete next.appSecret; // 留空表示保持原值
    if (next.isDefault) mockMpAccounts.forEach((x) => { if (x.id !== a.id) x.isDefault = false; });
    Object.assign(a, next, { updatedAt: mockDateTime() });
    return ok(maskSafe(a), '更新成功');
  }),

  mock(mpAccountContract.setDefault, ({ params, ok }) => {
    const a = mockMpAccounts.find((x) => x.id === params.id);
    if (!a) return notFound('公众号不存在', { status: 404 });
    mockMpAccounts.forEach((x) => { x.isDefault = x.id === a.id; });
    a.updatedAt = mockDateTime();
    return ok(maskSafe(a), '操作成功');
  }),

  mock(mpAccountContract.testConnection, ({ params, ok }) => {
    const a = mockMpAccounts.find((x) => x.id === params.id);
    if (!a) return notFound('公众号不存在', { status: 404 });
    return ok({ success: true, message: '连接成功（Demo 模式，未真实调用微信接口）' }, '连接成功');
  }),

  mock(mpAccountContract.remove, ({ params, ok }) => {
    const idx = mockMpAccounts.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('公众号不存在', { status: 404 });
    mockMpAccounts.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
