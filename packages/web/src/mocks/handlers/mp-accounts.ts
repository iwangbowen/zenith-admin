import { http, HttpResponse } from 'msw';
import { mockMpAccounts, getNextMpAccountId } from '@/mocks/data/mp-accounts';
import { mockDateTime } from '@/mocks/utils/date';
import type { MpAccount } from '@zenith/shared';

/** 列表脱敏：appSecret 显示掩码 */
function maskSafe(a: MpAccount): MpAccount {
  return { ...a, appSecret: a.appSecret ? '******' : '' };
}

/** 编辑回显：appSecret 留空 */
function maskForEdit(a: MpAccount): MpAccount {
  return { ...a, appSecret: '' };
}

export const mpAccountsHandlers = [
  http.get('/api/mp/accounts', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const type = url.searchParams.get('type') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const filtered = mockMpAccounts.filter((a) => {
      if (keyword && !a.name.includes(keyword) && !(a.account ?? '').includes(keyword) && !a.appId.includes(keyword)) return false;
      if (type && a.type !== type) return false;
      if (status && a.status !== status) return false;
      return true;
    });
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize).map(maskSafe);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.get('/api/mp/accounts/:id', ({ params }) => {
    const a = mockMpAccounts.find((x) => x.id === Number(params.id));
    if (!a) return HttpResponse.json({ code: 404, message: '公众号不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: maskForEdit(a) });
  }),

  http.post('/api/mp/accounts', async ({ request }) => {
    const body = await request.json() as Partial<MpAccount>;
    if (mockMpAccounts.some((a) => a.appId === body.appId)) {
      return HttpResponse.json({ code: 400, message: '该 AppID 已存在', data: null }, { status: 400 });
    }
    const now = mockDateTime();
    const item: MpAccount = {
      id: getNextMpAccountId(),
      name: body.name ?? '',
      account: body.account ?? null,
      appId: body.appId ?? '',
      appSecret: body.appSecret ?? '',
      token: body.token ?? '',
      encodingAesKey: body.encodingAesKey ?? null,
      encryptMode: body.encryptMode ?? 'plaintext',
      type: body.type ?? 'service',
      qrCodeUrl: body.qrCodeUrl ?? null,
      isDefault: body.isDefault ?? false,
      autoCreateMember: body.autoCreateMember ?? false,
      status: body.status ?? 'enabled',
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    if (item.isDefault) mockMpAccounts.forEach((a) => { a.isDefault = false; });
    mockMpAccounts.push(item);
    return HttpResponse.json({ code: 0, message: '创建成功', data: maskSafe(item) });
  }),

  http.put('/api/mp/accounts/:id', async ({ params, request }) => {
    const a = mockMpAccounts.find((x) => x.id === Number(params.id));
    if (!a) return HttpResponse.json({ code: 404, message: '公众号不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<MpAccount>;
    if (body.appId && body.appId !== a.appId && mockMpAccounts.some((x) => x.appId === body.appId)) {
      return HttpResponse.json({ code: 400, message: '该 AppID 已存在', data: null }, { status: 400 });
    }
    const next = { ...body };
    if (!next.appSecret) delete next.appSecret; // 留空表示保持原值
    if (next.isDefault) mockMpAccounts.forEach((x) => { if (x.id !== a.id) x.isDefault = false; });
    Object.assign(a, next, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: maskSafe(a) });
  }),

  http.post('/api/mp/accounts/:id/default', ({ params }) => {
    const a = mockMpAccounts.find((x) => x.id === Number(params.id));
    if (!a) return HttpResponse.json({ code: 404, message: '公众号不存在', data: null }, { status: 404 });
    mockMpAccounts.forEach((x) => { x.isDefault = x.id === a.id; });
    a.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '操作成功', data: maskSafe(a) });
  }),

  http.post('/api/mp/accounts/:id/test', ({ params }) => {
    const a = mockMpAccounts.find((x) => x.id === Number(params.id));
    if (!a) return HttpResponse.json({ code: 404, message: '公众号不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: '连接成功', data: { success: true, message: '连接成功（Demo 模式，未真实调用微信接口）' } });
  }),

  http.delete('/api/mp/accounts/:id', ({ params }) => {
    const idx = mockMpAccounts.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '公众号不存在', data: null }, { status: 404 });
    mockMpAccounts.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
