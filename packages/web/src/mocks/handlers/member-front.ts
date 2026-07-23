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
  mockMemberBenefits,
  mockMemberNotifications,
  mockInviteSummary,
} from '../data/members';
import { mockDateTime } from '../utils/date';

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
  http.get('/api/member/benefits', () => ok(mockMemberBenefits)),

  // ── 自助：通知 ────────────────────────────────────────────────────────────
  http.get('/api/member/notifications/unread-count', () =>
    ok({ count: mockMemberNotifications.filter((n) => !n.readAt).length })),
  http.get('/api/member/notifications', () => paginated(mockMemberNotifications)),
  http.put('/api/member/notifications/read-all', () => {
    for (const n of mockMemberNotifications) n.readAt = n.readAt ?? mockDateTime();
    return ok(null, '已全部已读');
  }),
  http.put('/api/member/notifications/:id/read', ({ params }) => {
    const n = mockMemberNotifications.find((x) => x.id === Number(params.id));
    if (n) n.readAt = n.readAt ?? mockDateTime();
    return ok(null, '已读');
  }),

  // ── 自助：邀请 ────────────────────────────────────────────────────────────
  http.get('/api/member/invite/summary', () => ok(mockInviteSummary)),

  // ── 自助：注销 ────────────────────────────────────────────────────────────
  http.post('/api/member/auth/deactivate', () => ok(null, '账户已注销')),

  // ── 自助：优惠券 ──────────────────────────────────────────────────────────
  http.get('/api/member/coupons', () => paginated(mockMemberCoupons)),
  http.get('/api/member/coupons/available', () => ok(mockCoupons)),
  http.get('/api/member/coupons/exchangeable', () => ok(mockCoupons.filter((c) => (c.exchangePoints ?? 0) > 0))),
  http.post('/api/member/coupons/receive', () => ok(mockMemberCoupons[0], '领取成功')),
  http.post('/api/member/coupons/exchange', () => ok(mockMemberCoupons[0], '兑换成功')),

  // ── 自助：登录历史 ────────────────────────────────────────────────────────
  http.get('/api/member/login-logs', ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') ?? '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') ?? '15');
    const start = (page - 1) * pageSize;
    const list = mockMemberLoginLogs.slice(start, start + pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total: mockMemberLoginLogs.length, page, pageSize } });
  }),

  // ── CMS 会员投稿 ──────────────────────────────────────────────────────────
  http.get('/api/member/cms/channels', () => ok([
    { id: 1, name: 'Zenith 官方网站', channels: [{ id: 2, name: '新闻中心' }, { id: 3, name: '产品中心' }] },
  ])),
  http.get('/api/member/cms/contributions/:id', ({ params }) => {
    const row = mockContributions.find((x) => x.id === Number(params.id));
    return row ? ok(row) : HttpResponse.json({ code: 404, message: '投稿不存在', data: null }, { status: 404 });
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
    if (idx === -1) return HttpResponse.json({ code: 404, message: '投稿不存在', data: null }, { status: 404 });
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
