import { http, HttpResponse } from 'msw';
import {
  mockMembers,
  mockMemberPointAccount,
  mockMemberPointTxs,
  mockMemberWallet,
  mockMemberWalletTxs,
  mockMemberLevels,
  mockCoupons,
  mockMemberCoupons,
  mockMemberLoginLogs,
} from '../data/members';

const MEMBER_TOKEN = 'mock-member-token-demo';
const MEMBER_REFRESH = 'mock-member-refresh-demo';

function memberView(m: (typeof mockMembers)[number]) {
  const { password: _pwd, ...rest } = m;
  return rest;
}

const demo = mockMembers[0];

function ok(data: unknown, message = 'ok') {
  return HttpResponse.json({ code: 0, message, data });
}

function paginated<T>(list: T[]) {
  return HttpResponse.json({ code: 0, message: 'ok', data: { list, total: list.length, page: 1, pageSize: 15 } });
}

export const memberFrontHandlers = [
  // ── 认证 ──────────────────────────────────────────────────────────────────
  http.post('/api/member/auth/sms-code', () => ok({ sent: true, devCode: '123456' }, '验证码已发送')),
  http.post('/api/member/auth/login', () =>
    ok({ member: memberView(demo), token: { accessToken: MEMBER_TOKEN, refreshToken: MEMBER_REFRESH } }, '登录成功'),
  ),
  http.post('/api/member/auth/register', () =>
    ok({ member: memberView(demo), token: { accessToken: MEMBER_TOKEN, refreshToken: MEMBER_REFRESH } }, '注册成功'),
  ),
  http.post('/api/member/auth/refresh', () => ok({ accessToken: MEMBER_TOKEN })),
  http.post('/api/member/auth/logout', () => ok(null, '已退出登录')),
  http.post('/api/member/auth/reset-password', () => ok(null, '密码已重置')),
  http.get('/api/member/auth/me', () => ok(memberView(demo))),
  http.put('/api/member/auth/profile', async ({ request }) => {
    const body = (await request.json()) as Partial<typeof demo>;
    Object.assign(demo, body);
    return ok(memberView(demo), '资料已更新');
  }),
  // Avatar upload (returns a preset URL for demo)
  http.post('/api/member/files/avatar', async ({ request }) => {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) return ok({ url: '/avatars/avatar-01.svg' });
    const idx = Math.floor(Math.random() * 12) + 1;
    return ok({ url: `/avatars/avatar-${String(idx).padStart(2, '0')}.svg` }, '上传成功');
  }),
  http.put('/api/member/auth/password', () => ok(null, '密码已修改')),

  // ── 自助：积分 ────────────────────────────────────────────────────────────
  http.get('/api/member/points/account', () => ok(mockMemberPointAccount)),
  http.get('/api/member/points/transactions', () => paginated(mockMemberPointTxs)),

  // ── 自助：钱包 ────────────────────────────────────────────────────────────
  http.get('/api/member/wallet', () => ok(mockMemberWallet)),
  http.get('/api/member/wallet/transactions', () => paginated(mockMemberWalletTxs)),
  http.post('/api/member/wallet/recharge', async ({ request }) => {
    const body = (await request.json()) as { amount: number; payMethod: string };
    return ok(
      {
        orderNo: `MOCK${Date.now()}`,
        payMethod: body.payMethod,
        channel: body.payMethod.startsWith('wechat') ? 'wechat' : 'alipay',
        codeUrl: 'https://example.com/mock-pay-qr',
        expiredAt: '2027-01-01 00:00:00',
      },
      '已创建充值订单（演示）',
    );
  }),

  // ── 自助：等级 ────────────────────────────────────────────────────────────
  http.get('/api/member/levels', () => ok(mockMemberLevels)),

  // ── 自助：优惠券 ──────────────────────────────────────────────────────────
  http.get('/api/member/coupons', () => paginated(mockMemberCoupons)),
  http.get('/api/member/coupons/available', () => ok(mockCoupons)),
  http.post('/api/member/coupons/receive', () => ok(mockMemberCoupons[0], '领取成功')),

  // ── 自助：登录历史 ────────────────────────────────────────────────────────
  http.get('/api/member/login-logs', ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') ?? '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') ?? '15');
    const start = (page - 1) * pageSize;
    const list = mockMemberLoginLogs.slice(start, start + pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total: mockMemberLoginLogs.length, page, pageSize } });
  }),
];
