import { http, HttpResponse } from 'msw';
import { mockDateTime } from '../utils/date';
import {
  mockMembers,
  mockMemberLevels,
  mockMemberTags,
  mockMemberPointTxs,
  mockMemberWalletTxs,
  mockMemberCoupons,
  mockCoupons,
  mockMemberPointAccount,
  mockMemberWallet,
  mockMemberLoginLogs,
  mockMemberRecharges,
  mockMemberStatsOverview,
  mockMemberStatsCharts,
} from '../data/members';

function memberView(m: (typeof mockMembers)[number]) {
  const { password: _pwd, ...rest } = m;
  return rest;
}

function loginLogView(l: (typeof mockMemberLoginLogs)[number]) {
  const m = mockMembers.find((x) => x.id === l.memberId);
  return { ...l, memberNickname: m?.nickname ?? null };
}

function ok(data: unknown, message = 'ok') {
  return HttpResponse.json({ code: 0, message, data });
}

function paginated<T>(list: T[], page = 1, pageSize = 10) {
  return HttpResponse.json({ code: 0, message: 'ok', data: { list, total: list.length, page, pageSize } });
}

export const memberAdminHandlers = [
  http.put('/api/members/batch-status', () => ok(null, '已更新状态')),
  http.put('/api/members/batch-level', () => ok(null, '已调整等级')),
  http.put('/api/members/batch-tags', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { ids?: number[]; tagIds?: number[] };
    const tagIds = body.tagIds ?? [];
    for (const id of body.ids ?? []) {
      const m = mockMembers.find((x) => x.id === id);
      if (!m) continue;
      const existing = new Set(m.tags.map((t) => t.id));
      for (const tid of tagIds) {
        if (existing.has(tid)) continue;
        const tag = mockMemberTags.find((t) => t.id === tid);
        if (tag) m.tags.push({ id: tag.id, name: tag.name, color: tag.color ?? null });
      }
    }
    return ok(null, `已为 ${(body.ids ?? []).length} 名会员追加标签`);
  }),
  http.get('/api/members', () => paginated(mockMembers.map(memberView))),
  http.get('/api/members/options', ({ request }) => {
    const kw = (new URL(request.url).searchParams.get('keyword') ?? '').trim().toLowerCase();
    const rows = mockMembers
      .filter((m) => !kw
        || m.nickname.toLowerCase().includes(kw)
        || (m.phone ?? '').includes(kw)
        || (m.username ?? '').toLowerCase().includes(kw))
      .slice(0, 20)
      .map((m) => ({ id: m.id, nickname: m.nickname, phone: m.phone, username: m.username, levelName: m.levelName }));
    return ok(rows);
  }),
  http.get('/api/members/login-logs', ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const kw = (sp.get('keyword') ?? '').trim().toLowerCase();
    const status = sp.get('status');
    let rows = mockMemberLoginLogs.map(loginLogView);
    if (status) rows = rows.filter((r) => r.status === status);
    if (kw) rows = rows.filter((r) => (r.memberNickname ?? '').toLowerCase().includes(kw));
    return paginated(rows);
  }),
  http.get('/api/members/:id/overview', ({ params }) => {
    const m = mockMembers.find((x) => x.id === Number(params.id));
    if (!m) return HttpResponse.json({ code: 404, message: '不存在', data: null }, { status: 404 });
    return ok({
      member: memberView(m),
      points: mockMemberPointAccount,
      wallet: mockMemberWallet,
      recentPointTxs: mockMemberPointTxs.slice(0, 5),
      recentWalletTxs: mockMemberWalletTxs.slice(0, 5),
      recentLoginLogs: mockMemberLoginLogs.slice(0, 5).map(loginLogView),
      activeCouponCount: 2,
      loginLogCount: 8,
      checkinTotal: 15,
      inviteCode: 'ZENITH88',
      inviter: null,
      invitedCount: 2,
      mpFans: [{ id: 1, nickname: '小明', openid: 'oDemoFan0000000000000001' }],
    });
  }),
  http.get('/api/members/:id', ({ params }) => {
    const m = mockMembers.find((x) => x.id === Number(params.id));
    return ok(m ? memberView(m) : null);
  }),
  http.post('/api/members', () => ok(memberView(mockMembers[0]), '创建成功')),
  http.put('/api/members/:id/status', () => ok(null, '状态已更新')),
  http.post('/api/members/:id/reset-password', () => ok(null, '密码已重置')),
  http.post('/api/members/:id/growth', async ({ params, request }) => {
    const m = mockMembers.find((x) => x.id === Number(params.id));
    if (!m) return HttpResponse.json({ code: 404, message: '会员不存在', data: null }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { delta?: number };
    m.growthValue = Math.max(0, m.growthValue + (body.delta ?? 0));
    // 与后端一致：按成长值门槛自动重定级
    const lvl = [...mockMemberLevels]
      .filter((l) => l.status === 'enabled' && l.growthThreshold <= m.growthValue)
      .sort((a, b) => b.growthThreshold - a.growthThreshold)[0];
    m.levelId = lvl?.id ?? null;
    m.levelName = lvl?.name ?? null;
    return ok(memberView(m), '已调整');
  }),
  http.put('/api/members/:id/tags', async ({ params, request }) => {
    const m = mockMembers.find((x) => x.id === Number(params.id));
    if (!m) return HttpResponse.json({ code: 404, message: '会员不存在', data: null }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { tagIds?: number[] };
    m.tags = (body.tagIds ?? [])
      .map((tid) => mockMemberTags.find((t) => t.id === tid))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({ id: t.id, name: t.name, color: t.color ?? null }));
    return ok(memberView(m), '已更新');
  }),
  http.put('/api/members/:id', () => ok(memberView(mockMembers[0]), '更新成功')),
  http.delete('/api/members/:id', () => ok(null, '删除成功')),

  // ── 会员标签 ─────────────────────────────────────────────────────────────
  http.get('/api/member-tags', () => ok(mockMemberTags)),
  http.post('/api/member-tags', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const created = {
      id: mockMemberTags.length ? Math.max(...mockMemberTags.map((t) => t.id)) + 1 : 1,
      name: String(body.name ?? '新标签'),
      color: (body.color as string | null) ?? 'blue',
      description: (body.description as string | null) ?? null,
      sort: Number(body.sort ?? 0),
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      memberCount: 0,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockMemberTags.push(created);
    return ok(created, '创建成功');
  }),
  http.put('/api/member-tags/:id', async ({ params, request }) => {
    const t = mockMemberTags.find((x) => x.id === Number(params.id));
    if (!t) return HttpResponse.json({ code: 404, message: '标签不存在', data: null }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    Object.assign(t, body, { updatedAt: mockDateTime() });
    return ok(t, '更新成功');
  }),
  http.delete('/api/member-tags/:id', ({ params }) => {
    const idx = mockMemberTags.findIndex((x) => x.id === Number(params.id));
    if (idx >= 0) {
      const [removed] = mockMemberTags.splice(idx, 1);
      for (const m of mockMembers) m.tags = m.tags.filter((t) => t.id !== removed.id);
    }
    return ok(null, '删除成功');
  }),

  // ── 会员充值记录 ─────────────────────────────────────────────────────────────
  http.get('/api/member-recharges', ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const kw = (sp.get('keyword') ?? '').trim().toLowerCase();
    const status = sp.get('status');
    const channel = sp.get('channel');
    let rows = mockMemberRecharges;
    if (status) rows = rows.filter((r) => r.status === status);
    if (channel) rows = rows.filter((r) => r.channel === channel);
    if (kw) {
      rows = rows.filter((r) =>
        (r.memberNickname ?? '').toLowerCase().includes(kw)
        || (r.memberPhone ?? '').includes(kw)
        || r.orderNo.toLowerCase().includes(kw));
    }
    return paginated(rows);
  }),

  // ── 会员看板 ─────────────────────────────────────────────────────────────
  http.get('/api/member-stats/overview', () => ok(mockMemberStatsOverview)),
  http.get('/api/member-stats/charts', () => ok(mockMemberStatsCharts)),

  // ── 会员等级 ─────────────────────────────────────────────────────────────
  http.get('/api/member-levels', () => ok(mockMemberLevels)),
  http.get('/api/member-levels/:id', ({ params }) =>
    ok(mockMemberLevels.find((l) => l.id === Number(params.id)) ?? null),
  ),
  http.post('/api/member-levels', () => ok(mockMemberLevels[0], '创建成功')),
  http.put('/api/member-levels/:id', () => ok(mockMemberLevels[0], '更新成功')),
  http.delete('/api/member-levels/:id', () => ok(null, '删除成功')),

  // ── 会员积分 ─────────────────────────────────────────────────────────────
  http.get('/api/member-points/transactions', () => paginated(mockMemberPointTxs)),
  http.get('/api/member-points/account/:id', () => ok(mockMemberPointAccount)),
  http.post('/api/member-points/adjust', () => ok(null, '积分已调整')),

  // ── 会员钱包 ─────────────────────────────────────────────────────────────
  http.get('/api/member-wallets/transactions', () => paginated(mockMemberWalletTxs)),
  http.get('/api/member-wallets/account/:id', () => ok(mockMemberWallet)),
  http.post('/api/member-wallets/adjust', () => ok(null, '余额已调整')),
  http.post('/api/member-wallets/refund', () => ok(null, '已退款')),

  // ── 优惠券（/records、/code、/redeem 必须在 /:id 之前）────────────────────
  http.get('/api/coupons/records', () => paginated(mockMemberCoupons)),
  http.post('/api/coupons/records/:id/revoke', () => ok(null, '券码已作废')),
  http.get('/api/coupons/code/:code', ({ params }) => {
    const mc = mockMemberCoupons.find((c) => c.code === String(params.code));
    if (!mc) return HttpResponse.json({ code: 404, message: '券码不存在', data: null }, { status: 404 });
    return ok(mc);
  }),
  http.post('/api/coupons/redeem', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { code?: string };
    const mc = mockMemberCoupons.find((c) => c.code === body.code);
    if (!mc) return HttpResponse.json({ code: 404, message: '券码不存在', data: null }, { status: 404 });
    if (mc.status !== 'unused') return HttpResponse.json({ code: 400, message: '优惠券不可用', data: null }, { status: 400 });
    mc.status = 'used';
    mc.usedAt = mockDateTime();
    return ok(mc, '核销成功');
  }),
  http.get('/api/coupons', () => paginated(mockCoupons)),
  http.get('/api/coupons/:id', ({ params }) => ok(mockCoupons.find((c) => c.id === Number(params.id)) ?? null)),
  http.post('/api/coupons/:id/issue', () => ok(null, '发券成功')),
  http.post('/api/coupons', () => ok(mockCoupons[0], '创建成功')),
  http.put('/api/coupons/:id', () => ok(mockCoupons[0], '更新成功')),
  http.delete('/api/coupons/:id', () => ok(null, '删除成功')),
];
