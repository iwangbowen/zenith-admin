import {
  couponContract,
  memberContract,
  memberLevelContract,
  memberPointContract,
  memberRechargeContract,
  memberStatsContract,
  memberTagContract,
  memberWalletContract,
  type MemberLevel,
  type MemberLoginLog,
  type MemberTag,
} from '@zenith/shared/member';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { mockDateTime } from '../utils/date';
import {
  memberView,
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

/** 后台跨会员查询附加会员昵称（与服务端 leftJoin members 口径一致） */
function loginLogView(l: MemberLoginLog): MemberLoginLog {
  const m = mockMembers.find((x) => x.id === l.memberId);
  return { ...l, memberNickname: m?.nickname ?? null };
}

export const memberAdminHandlers = [
  // ── 会员：批量操作（静态段先于 /:id）────────────────────────────────────────
  mock(memberContract.batchStatus, ({ body, ok }) => {
    for (const m of mockMembers) if (body.ids.includes(m.id)) m.status = body.status;
    return ok(null, `已更新 ${body.ids.length} 名会员状态`);
  }),
  mock(memberContract.batchLevel, ({ body, ok }) => {
    const level = mockMemberLevels.find((l) => l.id === body.levelId) ?? null;
    for (const m of mockMembers) {
      if (!body.ids.includes(m.id)) continue;
      m.levelId = level?.id ?? null;
      m.levelName = level?.name ?? null;
    }
    return ok(null, `已调整 ${body.ids.length} 名会员等级`);
  }),
  mock(memberContract.batchTags, ({ body, ok }) => {
    for (const id of body.ids) {
      const m = mockMembers.find((x) => x.id === id);
      if (!m) continue;
      if (!m.tags) m.tags = [];
      const tags = m.tags;
      const existing = new Set(tags.map((t) => t.id));
      for (const tid of body.tagIds) {
        if (existing.has(tid)) continue;
        const tag = mockMemberTags.find((t) => t.id === tid);
        if (tag) tags.push({ id: tag.id, name: tag.name, color: tag.color ?? null });
      }
    }
    return ok(null, `已为 ${body.ids.length} 名会员追加标签`);
  }),

  // ── 会员：列表 / 下拉 / 登录日志 / 概览 ─────────────────────────────────────
  mock(memberContract.list, ({ query, ok, paginate }) => {
    let list = mockMembers.map(memberView);
    if (query.keyword) {
      const kw = query.keyword.trim().toLowerCase();
      list = list.filter((m) => m.nickname.toLowerCase().includes(kw) || (m.phone ?? '').includes(kw) || (m.username ?? '').toLowerCase().includes(kw) || (m.email ?? '').toLowerCase().includes(kw));
    }
    if (query.status) list = list.filter((m) => m.status === query.status);
    if (query.levelId) list = list.filter((m) => m.levelId === query.levelId);
    if (query.tagId) list = list.filter((m) => (m.tags ?? []).some((t) => t.id === query.tagId));
    return ok(paginate(list));
  }),
  mock(memberContract.options, ({ query, ok }) => {
    const kw = (query.keyword ?? '').trim().toLowerCase();
    const rows = mockMembers
      .filter((m) => !kw
        || m.nickname.toLowerCase().includes(kw)
        || (m.phone ?? '').includes(kw)
        || (m.username ?? '').toLowerCase().includes(kw))
      .slice(0, 20)
      .map((m) => ({ id: m.id, nickname: m.nickname, phone: m.phone, username: m.username, levelName: m.levelName }));
    return ok(rows);
  }),
  mock(memberContract.loginLogs, ({ query, ok, paginate }) => {
    let rows = mockMemberLoginLogs.map(loginLogView);
    if (query.status) rows = rows.filter((r) => r.status === query.status);
    if (query.keyword) {
      const kw = query.keyword.trim().toLowerCase();
      rows = rows.filter((r) => (r.memberNickname ?? '').toLowerCase().includes(kw));
    }
    return ok(paginate(rows));
  }),
  mock(memberContract.overview, ({ params, ok }) => {
    const m = mockMembers.find((x) => x.id === params.id);
    if (!m) return notFound('不存在', { status: 404 });
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

  // ── 会员：单条读写 ──────────────────────────────────────────────────────────
  mock(memberContract.detail, ({ params, ok }) => {
    const m = mockMembers.find((x) => x.id === params.id);
    return m ? ok(memberView(m)) : notFound('会员不存在', { status: 404 });
  }),
  mock(memberContract.create, ({ ok }) => ok(memberView(mockMembers[0]), '创建成功')),
  mock(memberContract.setStatus, ({ params, body, ok }) => {
    const m = mockMembers.find((x) => x.id === params.id);
    if (!m) return notFound('会员不存在', { status: 404 });
    m.status = body.status;
    return ok(memberView(m), '已更新');
  }),
  mock(memberContract.resetPassword, ({ ok }) => ok(null, '密码已重置')),
  mock(memberContract.adjustGrowth, ({ params, body, ok }) => {
    const m = mockMembers.find((x) => x.id === params.id);
    if (!m) return notFound('会员不存在', { status: 404 });
    m.growthValue = Math.max(0, m.growthValue + body.delta);
    // 与后端一致：按成长值门槛自动重定级
    const lvl = [...mockMemberLevels]
      .filter((l) => l.status === 'enabled' && l.growthThreshold <= m.growthValue)
      .sort((a, b) => b.growthThreshold - a.growthThreshold)[0];
    m.levelId = lvl?.id ?? null;
    m.levelName = lvl?.name ?? null;
    return ok(memberView(m), '已调整');
  }),
  mock(memberContract.setTags, ({ params, body, ok }) => {
    const m = mockMembers.find((x) => x.id === params.id);
    if (!m) return notFound('会员不存在', { status: 404 });
    m.tags = body.tagIds
      .map((tid) => mockMemberTags.find((t) => t.id === tid))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({ id: t.id, name: t.name, color: t.color ?? null }));
    return ok(memberView(m), '已更新');
  }),
  mock(memberContract.update, ({ params, body, ok }) => {
    const m = mockMembers.find((x) => x.id === params.id);
    if (!m) return notFound('会员不存在', { status: 404 });
    Object.assign(m, body, { updatedAt: mockDateTime() });
    return ok(memberView(m), '更新成功');
  }),
  mock(memberContract.remove, ({ ok }) => ok(null, '删除成功')),

  // ── 会员标签 ─────────────────────────────────────────────────────────────
  mock(memberTagContract.list, ({ ok }) => ok(mockMemberTags)),
  mock(memberTagContract.create, ({ body, ok }) => {
    const created: MemberTag = {
      id: nextIdFrom(mockMemberTags),
      name: body.name,
      color: body.color ?? 'blue',
      description: body.description ?? null,
      sort: body.sort ?? 0,
      status: body.status ?? 'enabled',
      memberCount: 0,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockMemberTags.push(created);
    return ok(created, '创建成功');
  }),
  mock(memberTagContract.update, ({ params, body, ok }) => {
    const t = mockMemberTags.find((x) => x.id === params.id);
    if (!t) return notFound('标签不存在', { status: 404 });
    Object.assign(t, body, { updatedAt: mockDateTime() });
    return ok(t, '更新成功');
  }),
  mock(memberTagContract.remove, ({ params, ok }) => {
    const idx = mockMemberTags.findIndex((x) => x.id === params.id);
    if (idx >= 0) {
      const [removed] = mockMemberTags.splice(idx, 1);
      for (const m of mockMembers) m.tags = (m.tags ?? []).filter((t) => t.id !== removed.id);
    }
    return ok(null, '删除成功');
  }),

  // ── 会员充值记录 ─────────────────────────────────────────────────────────────
  mock(memberRechargeContract.list, ({ query, ok, paginate }) => {
    let rows = mockMemberRecharges;
    if (query.status) rows = rows.filter((r) => r.status === query.status);
    if (query.channel) rows = rows.filter((r) => r.channel === query.channel);
    if (query.keyword) {
      const kw = query.keyword.trim().toLowerCase();
      rows = rows.filter((r) =>
        (r.memberNickname ?? '').toLowerCase().includes(kw)
        || (r.memberPhone ?? '').includes(kw)
        || r.orderNo.toLowerCase().includes(kw));
    }
    return ok(paginate(rows));
  }),

  // ── 会员看板 ─────────────────────────────────────────────────────────────
  mock(memberStatsContract.overview, ({ ok }) => ok(mockMemberStatsOverview)),
  mock(memberStatsContract.charts, ({ ok }) => ok(mockMemberStatsCharts)),

  // ── 会员等级 ─────────────────────────────────────────────────────────────
  mock(memberLevelContract.list, ({ ok }) => ok(mockMemberLevels)),
  mock(memberLevelContract.detail, ({ params, ok }) => {
    const level = mockMemberLevels.find((l) => l.id === params.id);
    return level ? ok(level) : notFound('会员等级不存在', { status: 404 });
  }),
  mock(memberLevelContract.create, ({ body, ok }) => {
    const created: MemberLevel = {
      id: nextIdFrom(mockMemberLevels),
      name: body.name,
      level: body.level,
      growthThreshold: body.growthThreshold,
      discount: body.discount,
      icon: body.icon ?? null,
      benefits: body.benefits ?? [],
      description: body.description ?? null,
      sort: body.sort ?? 0,
      status: body.status ?? 'enabled',
      memberCount: 0,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockMemberLevels.push(created);
    return ok(created, '创建成功');
  }),
  mock(memberLevelContract.update, ({ params, body, ok }) => {
    const level = mockMemberLevels.find((l) => l.id === params.id);
    if (!level) return notFound('会员等级不存在', { status: 404 });
    Object.assign(level, body, { updatedAt: mockDateTime() });
    return ok(level, '更新成功');
  }),
  mock(memberLevelContract.remove, ({ params, ok }) => {
    const idx = mockMemberLevels.findIndex((l) => l.id === params.id);
    if (idx >= 0) mockMemberLevels.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ── 会员积分 ─────────────────────────────────────────────────────────────
  mock(memberPointContract.transactions, ({ query, ok, paginate }) => {
    let rows = mockMemberPointTxs;
    if (query.type) rows = rows.filter((r) => r.type === query.type);
    return ok(paginate(rows));
  }),
  mock(memberPointContract.account, ({ params, ok }) => ok({ ...mockMemberPointAccount, memberId: params.id })),
  mock(memberPointContract.adjust, ({ body, ok }) => {
    mockMemberPointAccount.balance += body.delta;
    if (body.delta > 0) mockMemberPointAccount.totalEarned += body.delta;
    else mockMemberPointAccount.totalSpent += -body.delta;
    mockMemberPointTxs.unshift({
      id: nextIdFrom(mockMemberPointTxs),
      memberId: body.memberId,
      type: 'adjust',
      amount: body.delta,
      balanceAfter: mockMemberPointAccount.balance,
      bizType: 'admin_adjust',
      bizId: null,
      remark: body.remark ?? null,
      memberName: mockMembers.find((m) => m.id === body.memberId)?.nickname,
      createdAt: mockDateTime(),
    });
    return ok({ ...mockMemberPointAccount, memberId: body.memberId }, '已调整');
  }),

  // ── 会员钱包 ─────────────────────────────────────────────────────────────
  mock(memberWalletContract.transactions, ({ query, ok, paginate }) => {
    let rows = mockMemberWalletTxs;
    if (query.type) rows = rows.filter((r) => r.type === query.type);
    return ok(paginate(rows));
  }),
  mock(memberWalletContract.account, ({ params, ok }) => ok({ ...mockMemberWallet, memberId: params.id })),
  mock(memberWalletContract.adjust, ({ body, ok }) => {
    mockMemberWallet.balance += body.amount;
    mockMemberWalletTxs.unshift({
      id: nextIdFrom(mockMemberWalletTxs),
      memberId: body.memberId,
      type: 'adjust',
      amount: body.amount,
      balanceAfter: mockMemberWallet.balance,
      bizType: 'admin_adjust',
      bizId: null,
      remark: body.remark ?? null,
      memberName: mockMembers.find((m) => m.id === body.memberId)?.nickname,
      createdAt: mockDateTime(),
    });
    return ok({ ...mockMemberWallet, memberId: body.memberId }, '已调整');
  }),
  mock(memberWalletContract.refund, ({ body, ok }) => {
    mockMemberWallet.balance += body.amount;
    mockMemberWalletTxs.unshift({
      id: nextIdFrom(mockMemberWalletTxs),
      memberId: body.memberId,
      type: 'refund',
      amount: body.amount,
      balanceAfter: mockMemberWallet.balance,
      bizType: 'admin_refund',
      bizId: body.bizId ?? null,
      remark: body.remark,
      memberName: mockMembers.find((m) => m.id === body.memberId)?.nickname,
      createdAt: mockDateTime(),
    });
    return ok({ ...mockMemberWallet, memberId: body.memberId }, '已退款');
  }),

  // ── 优惠券（/records、/code、/redeem 必须在 /:id 之前）────────────────────
  mock(couponContract.records, ({ query, ok, paginate }) => {
    let rows = mockMemberCoupons;
    if (query.couponId) rows = rows.filter((r) => r.couponId === query.couponId);
    if (query.status) rows = rows.filter((r) => r.status === query.status);
    return ok(paginate(rows));
  }),
  mock(couponContract.revokeRecord, ({ params, ok }) => {
    const mc = mockMemberCoupons.find((c) => c.id === params.id);
    if (!mc) return notFound('领券记录不存在', { status: 404 });
    if (mc.status === 'used') return badRequest('已使用的券不可作废', { status: 400 });
    mc.status = 'frozen';
    return ok(null, '券码已作废');
  }),
  mock(couponContract.byCode, ({ params, ok }) => {
    const mc = mockMemberCoupons.find((c) => c.code === params.code);
    if (!mc) return notFound('券码不存在', { status: 404 });
    return ok(mc);
  }),
  mock(couponContract.redeem, ({ body, ok }) => {
    const mc = mockMemberCoupons.find((c) => c.code === body.code);
    if (!mc) return notFound('券码不存在', { status: 404 });
    if (mc.status !== 'unused') return badRequest('优惠券不可用', { status: 400 });
    mc.status = 'used';
    mc.usedAt = mockDateTime();
    return ok(mc, '核销成功');
  }),
  mock(couponContract.list, ({ query, ok, paginate }) => {
    let rows = mockCoupons;
    if (query.keyword) rows = rows.filter((c) => c.name.includes(query.keyword!));
    if (query.status) rows = rows.filter((c) => c.status === query.status);
    if (query.type) rows = rows.filter((c) => c.type === query.type);
    return ok(paginate(rows));
  }),
  mock(couponContract.detail, ({ params, ok }) => {
    const coupon = mockCoupons.find((c) => c.id === params.id);
    return coupon ? ok(coupon) : notFound('优惠券不存在', { status: 404 });
  }),
  mock(couponContract.issue, ({ params, body, ok }) => {
    const coupon = mockCoupons.find((c) => c.id === params.id);
    if (!coupon) return notFound('优惠券不存在', { status: 404 });
    coupon.issuedQuantity += 1;
    const issued = {
      id: nextIdFrom(mockMemberCoupons),
      couponId: coupon.id,
      memberId: body.memberId,
      code: `CP${Date.now().toString(16).toUpperCase()}`,
      status: 'unused' as const,
      receivedAt: mockDateTime(),
      usedAt: null,
      expireAt: '2027-01-01 00:00:00',
      coupon,
      memberName: mockMembers.find((m) => m.id === body.memberId)?.nickname,
      createdAt: mockDateTime(),
    };
    mockMemberCoupons.unshift(issued);
    return ok(issued, '发券成功');
  }),
  mock(couponContract.create, ({ ok }) => ok(mockCoupons[0], '创建成功')),
  mock(couponContract.update, ({ params, body, ok }) => {
    const coupon = mockCoupons.find((c) => c.id === params.id);
    if (!coupon) return notFound('优惠券不存在', { status: 404 });
    Object.assign(coupon, body, { updatedAt: mockDateTime() });
    return ok(coupon, '更新成功');
  }),
  mock(couponContract.remove, ({ ok }) => ok(null, '删除成功')),
];
