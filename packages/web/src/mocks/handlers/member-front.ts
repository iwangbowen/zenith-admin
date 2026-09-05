import { http } from 'msw';
import { memberAuthContract, memberSelfContract } from '@zenith/shared/member';
import { mock } from '@/mocks/utils/contract';
import { badRequest, ok, notFound } from '@/mocks/utils/handlers';
import {
  memberView,
  mockMembers,
  mockMemberPointAccount,
  mockMemberPointTxs,
  mockMemberWallet,
  mockMemberWalletTxs,
  mockMemberLevels,
  mockCoupons,
  mockMemberCoupons,
  mockMemberLoginLogs,
  mockMemberBenefits,
  mockMemberNotifications,
  mockInviteSummary,
} from '../data/members';
import { mockDateTime } from '../utils/date';

const MEMBER_TOKEN = 'mock-member-token-demo';
const MEMBER_REFRESH = 'mock-member-refresh-demo';

const demo = mockMembers[0];

/** CMS 会员侧 handler 的分页响应（尚未契约化，沿用固定页大小） */
function paginated<T>(list: T[]) {
  return ok({ list, total: list.length, page: 1, pageSize: 15 });
}

export const memberFrontHandlers = [
  // ── 认证 ──────────────────────────────────────────────────────────────────
  mock(memberAuthContract.smsCode, ({ ok }) => ok({ sent: true, devCode: '123456' }, '验证码已发送')),
  mock(memberAuthContract.login, ({ ok }) =>
    ok({ member: memberView(demo), token: { accessToken: MEMBER_TOKEN, refreshToken: MEMBER_REFRESH } }, '登录成功'),
  ),
  mock(memberAuthContract.register, ({ ok }) =>
    ok({ member: memberView(demo), token: { accessToken: MEMBER_TOKEN, refreshToken: MEMBER_REFRESH } }, '注册成功'),
  ),
  mock(memberAuthContract.refresh, ({ ok }) => ok({ accessToken: MEMBER_TOKEN, refreshToken: MEMBER_REFRESH })),
  mock(memberAuthContract.logout, ({ ok }) => ok(null, '已退出登录')),
  mock(memberAuthContract.resetPassword, ({ ok }) => ok(null, '密码已重置')),
  mock(memberAuthContract.me, ({ ok }) => ok(memberView(demo))),
  mock(memberAuthContract.updateProfile, ({ body, ok }) => {
    Object.assign(demo, body, { updatedAt: mockDateTime() });
    return ok(memberView(demo), '资料已更新');
  }),
  // 头像上传：服务端尚无对应路由（见 api-conformance.allowlist），Demo 模式返回预置头像
  http.post('/api/member/files/avatar', async ({ request }) => {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) return ok({ url: `${import.meta.env.BASE_URL}avatars/avatar-01.svg` });
    const idx = Math.floor(Math.random() * 12) + 1;
    return ok({ url: `${import.meta.env.BASE_URL}avatars/avatar-${String(idx).padStart(2, '0')}.svg` }, '上传成功');
  }),
  mock(memberAuthContract.changePassword, ({ ok }) => ok(null, '密码已修改')),

  // ── 自助：积分 ────────────────────────────────────────────────────────────
  mock(memberSelfContract.pointAccount, ({ ok }) => ok(mockMemberPointAccount)),
  mock(memberSelfContract.pointTransactions, ({ query, ok, paginate }) => {
    const rows = query.type ? mockMemberPointTxs.filter((r) => r.type === query.type) : mockMemberPointTxs;
    return ok(paginate(rows));
  }),

  // ── 自助：钱包 ────────────────────────────────────────────────────────────
  mock(memberSelfContract.wallet, ({ ok }) => ok(mockMemberWallet)),
  mock(memberSelfContract.walletTransactions, ({ query, ok, paginate }) => {
    const rows = query.type ? mockMemberWalletTxs.filter((r) => r.type === query.type) : mockMemberWalletTxs;
    return ok(paginate(rows));
  }),
  mock(memberSelfContract.paymentOptions, ({ ok }) => ok([
    {
      id: 1,
      name: '演示微信支付应用',
      cashierMethods: [{ method: 'wechat_h5', label: '微信支付', icon: null }, { method: 'wechat_native', label: '微信扫码', icon: null }],
      deductMethods: [{ method: 'wechat_papay', label: '微信委托代扣' }],
    },
    {
      id: 3,
      name: '演示支付宝支付应用',
      cashierMethods: [{ method: 'alipay_wap', label: '支付宝', icon: null }],
      deductMethods: [{ method: 'alipay_cycle', label: '支付宝周期扣款' }],
    },
  ])),
  mock(memberSelfContract.recharge, ({ body, ok }) => ok({
    orderNo: `MOCK${Date.now()}`,
    payMethod: body.payMethod,
    channel: body.payMethod.startsWith('wechat') ? 'wechat' : 'alipay',
    codeUrl: 'https://example.com/mock-pay-qr',
    expiredAt: '2027-01-01 00:00:00',
  }, '已创建充值订单（演示）')),

  // ── 自助：等级 ────────────────────────────────────────────────────────────
  mock(memberSelfContract.levels, ({ ok }) => ok(mockMemberLevels)),
  mock(memberSelfContract.benefits, ({ ok }) => ok(mockMemberBenefits)),

  // ── 自助：通知（静态段 /unread-count、/read-all 先于 /:id/read）───────────
  mock(memberSelfContract.unreadCount, ({ ok }) =>
    ok({ count: mockMemberNotifications.filter((n) => !n.readAt).length })),
  mock(memberSelfContract.notifications, ({ query, ok, paginate }) => {
    const rows = query.unreadOnly ? mockMemberNotifications.filter((n) => !n.readAt) : mockMemberNotifications;
    return ok(paginate(rows));
  }),
  mock(memberSelfContract.markAllRead, ({ ok }) => {
    let n = 0;
    for (const item of mockMemberNotifications) {
      if (item.readAt) continue;
      item.readAt = mockDateTime();
      n += 1;
    }
    return ok(null, `已读 ${n} 条`);
  }),
  mock(memberSelfContract.markRead, ({ params, ok }) => {
    const n = mockMemberNotifications.find((x) => x.id === params.id);
    if (!n) return notFound('通知不存在', { status: 404 });
    n.readAt = n.readAt ?? mockDateTime();
    return ok(null, '已读');
  }),

  // ── 自助：邀请 ────────────────────────────────────────────────────────────
  mock(memberSelfContract.inviteSummary, ({ ok }) => ok(mockInviteSummary)),

  // ── 自助：注销 ────────────────────────────────────────────────────────────
  mock(memberAuthContract.deactivate, ({ ok }) => ok(null, '账户已注销')),

  // ── 自助：优惠券（静态段 /available、/exchangeable 先于列表）──────────────
  mock(memberSelfContract.availableCoupons, ({ ok }) => ok(mockCoupons)),
  mock(memberSelfContract.exchangeableCoupons, ({ ok }) => ok(mockCoupons.filter((c) => c.exchangePoints > 0))),
  mock(memberSelfContract.coupons, ({ query, ok, paginate }) => {
    const rows = query.status ? mockMemberCoupons.filter((mc) => mc.status === query.status) : mockMemberCoupons;
    return ok(paginate(rows));
  }),
  mock(memberSelfContract.receiveCoupon, ({ body, ok }) => {
    if (!mockCoupons.some((c) => c.id === body.couponId)) return badRequest('优惠券不可领取', { status: 400 });
    return ok(mockMemberCoupons[0], '领取成功');
  }),
  mock(memberSelfContract.exchangeCoupon, ({ body, ok }) => {
    const coupon = mockCoupons.find((c) => c.id === body.couponId);
    if (!coupon || coupon.exchangePoints <= 0) return badRequest('该优惠券不支持积分兑换', { status: 400 });
    return ok(mockMemberCoupons[0], '兑换成功');
  }),

  // ── 自助：登录历史 ────────────────────────────────────────────────────────
  mock(memberSelfContract.loginLogs, ({ ok, paginate }) => ok(paginate(mockMemberLoginLogs))),

  // ── CMS 会员投稿 ──────────────────────────────────────────────────────────
  http.get('/api/member/cms/channels', () => ok([
    { id: 1, name: 'Zenith 官方网站', channels: [{ id: 2, name: '新闻中心' }, { id: 3, name: '产品中心' }] },
  ])),
  http.get('/api/member/cms/contributions/:id', ({ params }) => {
    const row = mockContributions.find((x) => x.id === Number(params.id));
    return row ? ok(row) : notFound('投稿不存在', { status: 404 });
  }),
  http.get('/api/member/cms/contributions', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const list = status ? mockContributions.filter((x) => x.status === status) : mockContributions;
    return paginated(list);
  }),
  http.post('/api/member/cms/contributions', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = mockDateTime();
    const row = {
      id: mockContributions.length + 100,
      siteId: Number(body.siteId ?? 1),
      channelId: Number(body.channelId ?? 2),
      channelName: '新闻中心',
      title: String(body.title ?? ''),
      summary: (body.summary as string) ?? null,
      coverImage: null,
      body: String(body.body ?? ''),
      status: 'pending' as const,
      rejectReason: null,
      publishedAt: null,
      viewCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockContributions.unshift(row);
    return ok(row, '投稿已提交，等待审核');
  }),
  http.put('/api/member/cms/contributions/:id', async ({ params, request }) => {
    const idx = mockContributions.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return notFound('投稿不存在', { status: 404 });
    Object.assign(mockContributions[idx], await request.json(), { status: 'pending', rejectReason: null, updatedAt: mockDateTime() });
    return ok(mockContributions[idx], '已重新提交，等待审核');
  }),
  http.delete('/api/member/cms/contributions/:id', ({ params }) => {
    const idx = mockContributions.findIndex((x) => x.id === Number(params.id));
    if (idx !== -1) mockContributions.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ── CMS 会员互动：点赞 / 收藏 / 浏览历史（P3）──────────────────────────────
  http.get('/api/member/cms/contents/:id/interaction-state', ({ params }) => {
    const id = Number(params.id);
    return ok({
      liked: mockLikedIds.has(id),
      favorited: mockFavorites.some((f) => f.contentId === id),
      likeCount: mockLikedIds.has(id) ? 13 : 12,
      favoriteCount: mockFavorites.some((f) => f.contentId === id) ? 6 : 5,
    });
  }),
  http.post('/api/member/cms/contents/:id/like', ({ params }) => {
    const id = Number(params.id);
    mockLikedIds.add(id);
    return ok({ liked: true, favorited: mockFavorites.some((f) => f.contentId === id), likeCount: 13, favoriteCount: 5 }, '已点赞');
  }),
  http.delete('/api/member/cms/contents/:id/like', ({ params }) => {
    const id = Number(params.id);
    mockLikedIds.delete(id);
    return ok({ liked: false, favorited: mockFavorites.some((f) => f.contentId === id), likeCount: 12, favoriteCount: 5 }, '已取消点赞');
  }),
  http.post('/api/member/cms/contents/:id/favorite', ({ params }) => {
    const id = Number(params.id);
    if (!mockFavorites.some((f) => f.contentId === id)) {
      mockFavorites.unshift({ contentId: id, title: `内容 #${id}`, url: `/news/${id}.html`, coverThumb: null, contentType: 'article', createdAt: mockDateTime() });
    }
    return ok({ liked: mockLikedIds.has(id), favorited: true, likeCount: 12, favoriteCount: 6 }, '已收藏');
  }),
  http.delete('/api/member/cms/contents/:id/favorite', ({ params }) => {
    const id = Number(params.id);
    const idx = mockFavorites.findIndex((f) => f.contentId === id);
    if (idx !== -1) mockFavorites.splice(idx, 1);
    return ok({ liked: mockLikedIds.has(id), favorited: false, likeCount: 12, favoriteCount: 5 }, '已取消收藏');
  }),
  http.post('/api/member/cms/contents/:id/view', ({ params }) => {
    const id = Number(params.id);
    const hit = mockViewHistory.find((v) => v.contentId === id);
    if (hit) {
      hit.viewCount = (hit.viewCount ?? 1) + 1;
      hit.updatedAt = mockDateTime();
    } else {
      mockViewHistory.unshift({ contentId: id, title: `内容 #${id}`, url: `/news/${id}.html`, coverThumb: null, contentType: 'article', viewCount: 1, createdAt: mockDateTime(), updatedAt: mockDateTime() });
    }
    return ok(null, '已记录');
  }),
  http.get('/api/member/cms/favorites', () => paginated(mockFavorites)),
  http.get('/api/member/cms/view-history', () => paginated(mockViewHistory)),
  http.delete('/api/member/cms/view-history', () => {
    const count = mockViewHistory.length;
    mockViewHistory.length = 0;
    return ok(null, `已清空 ${count} 条浏览记录`);
  }),

  // ── CMS 我的评论（P1 评论会员化）──────────────────────────────────────────
  http.post('/api/member/cms/contents/:id/comments', async ({ params, request }) => {
    const body = (await request.json()) as { content: string; parentId?: number };
    mockMyComments.unshift({
      id: nextMyCommentId++,
      contentId: Number(params.id),
      contentTitle: `内容 #${params.id}`,
      contentUrl: `/news/${params.id}.html`,
      parentId: body.parentId ?? 0,
      content: body.content,
      likeCount: 0,
      status: 'pending',
      createdAt: mockDateTime(),
    });
    return ok(null, '评论已提交，审核通过后显示');
  }),
  http.get('/api/member/cms/comments', () => paginated(mockMyComments)),
  http.delete('/api/member/cms/comments/:id', ({ params }) => {
    const idx = mockMyComments.findIndex((c) => c.id === Number(params.id));
    if (idx >= 0) mockMyComments.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];

interface MockMemberContentItem {
  contentId: number; title: string; url: string | null; coverThumb: string | null;
  contentType: 'article' | 'album' | 'media' | 'link';
  viewCount?: number; createdAt: string; updatedAt?: string;
}

const mockLikedIds = new Set<number>();
const mockFavorites: MockMemberContentItem[] = [
  { contentId: 1, title: 'Zenith Admin 发布 CMS 内容管理模块', url: '/news/1.html', coverThumb: null, contentType: 'article', createdAt: '2026-01-05 10:00:00' },
];
const mockViewHistory: MockMemberContentItem[] = [
  { contentId: 2, title: '内容管理系统选型指南：静态化与全文检索实践', url: '/news/2.html', coverThumb: null, contentType: 'article', viewCount: 3, createdAt: '2026-01-04 09:00:00', updatedAt: '2026-01-06 15:30:00' },
];

interface MockMyComment {
  id: number; contentId: number; contentTitle: string | null; contentUrl: string | null;
  parentId: number; content: string; likeCount: number;
  status: 'pending' | 'approved' | 'rejected'; createdAt: string;
}

const mockMyComments: MockMyComment[] = [
  { id: 3, contentId: 1, contentTitle: 'Zenith Admin 发布 CMS 内容管理模块', contentUrl: '/news/1.html', parentId: 0, content: '登录会员的评论会带会员标识，支持在会员中心统一管理。', likeCount: 1, status: 'approved', createdAt: '2026-01-05 11:00:00' },
];
let nextMyCommentId = 100;

const mockContributions: {
  id: number; siteId: number; channelId: number; channelName: string | null;
  title: string; summary: string | null; coverImage: string | null; body: string | null;
  status: 'draft' | 'pending' | 'published' | 'offline' | 'rejected';
  rejectReason: string | null; publishedAt: string | null; viewCount: number;
  createdAt: string; updatedAt: string;
}[] = [
  { id: 1, siteId: 1, channelId: 2, channelName: '新闻中心', title: '我的第一篇投稿', summary: '演示投稿数据', coverImage: null, body: '<p>投稿正文</p>', status: 'published', rejectReason: null, publishedAt: '2024-06-01 10:00:00', viewCount: 88, createdAt: '2024-05-30 09:00:00', updatedAt: '2024-06-01 10:00:00' },
  { id: 2, siteId: 1, channelId: 3, channelName: '产品中心', title: '待审核的投稿示例', summary: null, coverImage: null, body: '<p>等待审核</p>', status: 'pending', rejectReason: null, publishedAt: null, viewCount: 0, createdAt: '2024-06-02 14:00:00', updatedAt: '2024-06-02 14:00:00' },
  { id: 3, siteId: 1, channelId: 2, channelName: '新闻中心', title: '被驳回的投稿示例', summary: null, coverImage: null, body: '<p>需要修改</p>', status: 'rejected', rejectReason: '内容与栏目主题不符，请调整后重新提交', publishedAt: null, viewCount: 0, createdAt: '2024-06-03 16:00:00', updatedAt: '2024-06-03 18:00:00' },
];
