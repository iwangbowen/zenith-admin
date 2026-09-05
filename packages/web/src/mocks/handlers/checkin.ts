import dayjs from 'dayjs';
import {
  checkinMilestoneContract,
  checkinRuleContract,
  checkinSettingsContract,
  memberCheckinContract,
  memberContract,
  memberSelfContract,
  type CheckinMilestone,
  type CheckinRule,
  type MemberCheckin,
} from '@zenith/shared/member';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { mockCheckinRules, mockCheckinStatus, mockMemberCheckins, mockCheckinSettings, mockCheckinMilestones, buildMilestoneStatus } from '../data/checkin';
import { mockCoupons } from '../data/members';
import { mockDate, mockDateTime } from '../utils/date';

const rules = [...mockCheckinRules];
const memberCheckins = [...mockMemberCheckins];
let checkinStatus = { ...mockCheckinStatus };
const settings = { ...mockCheckinSettings };
const milestones = [...mockCheckinMilestones];

function getReward(days: number) {
  const sorted = [...rules].sort((a, b) => a.dayNumber - b.dayNumber);
  const exact = sorted.find((rule) => rule.dayNumber === days);
  if (exact) return exact;
  return sorted[sorted.length - 1];
}

/** 与服务端 leftJoin coupons 口径一致：奖励券名称按模板回填 */
function couponNameOf(couponId: number | null | undefined): string | null {
  return couponId ? (mockCoupons.find((c) => c.id === couponId)?.name ?? null) : null;
}

/** 管理端签到记录 / 会员端签到历史共用的会员维度筛选 */
function matchesKeyword(item: MemberCheckin, memberKeyword: string | undefined): boolean {
  if (!memberKeyword) return true;
  const numId = /^\d+$/.test(memberKeyword) ? Number(memberKeyword) : null;
  if (numId) return item.memberId === numId;
  return (item.memberNickname ?? '').toLowerCase().includes(memberKeyword.toLowerCase());
}

function inDateRange(item: MemberCheckin, dateStart: string | undefined, dateEnd: string | undefined): boolean {
  if (dateStart && item.checkinDate < dateStart.slice(0, 10)) return false;
  if (dateEnd && item.checkinDate > dateEnd.slice(0, 10)) return false;
  return true;
}

export const checkinHandlers = [
  // ── 签到规则 ────────────────────────────────────────────────────
  mock(checkinRuleContract.list, ({ ok }) => ok([...rules].sort((a, b) => a.dayNumber - b.dayNumber))),
  mock(checkinRuleContract.create, ({ body, ok }) => {
    const created: CheckinRule = {
      id: nextIdFrom(rules),
      dayNumber: body.dayNumber,
      points: body.points,
      experience: body.experience,
      remark: body.remark ?? null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    rules.push(created);
    return ok(created, '创建成功');
  }),
  mock(checkinRuleContract.update, ({ params, body, ok }) => {
    const target = rules.find((rule) => rule.id === params.id);
    if (!target) return notFound('签到规则不存在', { status: 404 });
    Object.assign(target, body, { updatedAt: mockDateTime() });
    return ok(target, '更新成功');
  }),
  mock(checkinRuleContract.remove, ({ params, ok }) => {
    const index = rules.findIndex((rule) => rule.id === params.id);
    if (index >= 0) rules.splice(index, 1);
    return ok(null, '删除成功');
  }),

  // ── 管理端签到记录 / 日历 ────────────────────────────────────────
  mock(memberCheckinContract.list, ({ query, ok, paginate }) => {
    const filtered = memberCheckins.filter((item) => matchesKeyword(item, query.memberKeyword) && inDateRange(item, query.dateStart, query.dateEnd));
    return ok(paginate(filtered));
  }),
  mock(memberCheckinContract.calendar, ({ query, ok }) => {
    const byDate = new Map<string, { date: string; count: number; makeupCount: number }>();
    for (const item of memberCheckins) {
      if (!item.checkinDate.startsWith(query.month)) continue;
      const day = byDate.get(item.checkinDate) ?? { date: item.checkinDate, count: 0, makeupCount: 0 };
      day.count += 1;
      if (item.isMakeup) day.makeupCount += 1;
      byDate.set(item.checkinDate, day);
    }
    return ok([...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)));
  }),

  // ── 会员端签到 ──────────────────────────────────────────────────
  mock(memberSelfContract.checkinStatus, ({ ok }) => ok(checkinStatus)),
  mock(memberSelfContract.checkin, ({ ok }) => {
    if (checkinStatus.checkedToday) {
      return badRequest('今天已经签到过了', { status: 400 });
    }
    const reward = getReward(checkinStatus.consecutiveDays + 1);
    const result = {
      consecutiveDays: checkinStatus.consecutiveDays + 1,
      points: reward?.points ?? 0,
      experience: reward?.experience ?? 0,
      checkinDate: mockDate(),
    };
    checkinStatus = {
      ...checkinStatus,
      checkedToday: true,
      consecutiveDays: result.consecutiveDays,
      totalDays: checkinStatus.totalDays + 1,
      todayPoints: result.points,
      todayExperience: result.experience,
      nextDayPoints: getReward(result.consecutiveDays + 1)?.points ?? result.points,
      nextDayExperience: getReward(result.consecutiveDays + 1)?.experience ?? result.experience,
      thisMonthDates: Array.from(new Set([...checkinStatus.thisMonthDates, result.checkinDate])).sort(),
    };
    memberCheckins.unshift({
      id: nextIdFrom(memberCheckins),
      memberId: 1,
      memberNickname: '演示会员',
      checkinDate: result.checkinDate,
      consecutiveDays: result.consecutiveDays,
      pointsAwarded: result.points,
      experienceAwarded: result.experience,
      isMakeup: false,
      remark: null,
      createdAt: mockDateTime(dayjs().hour(9).minute(0).second(0).toDate()),
    });
    return ok(result, '签到成功');
  }),
  mock(memberSelfContract.checkinHistory, ({ query, ok, paginate }) => {
    const filtered = memberCheckins.filter((item) => inDateRange(item, query.dateStart, query.dateEnd));
    return ok(paginate(filtered));
  }),

  // ── 签到设置 ──────────────────────────────────────────────────
  mock(checkinSettingsContract.get, ({ ok }) => ok(settings)),
  mock(checkinSettingsContract.update, ({ body, ok }) => {
    Object.assign(settings, body, { updatedAt: mockDateTime() });
    return ok(settings, '更新成功');
  }),

  // ── 签到里程碑 ────────────────────────────────────────────────
  mock(checkinMilestoneContract.list, ({ ok }) => ok([...milestones].sort((a, b) => a.cumulativeDays - b.cumulativeDays))),
  mock(checkinMilestoneContract.create, ({ body, ok }) => {
    const created: CheckinMilestone = {
      id: nextIdFrom(milestones),
      title: body.title,
      cumulativeDays: body.cumulativeDays,
      rewardType: body.rewardType,
      rewardPoints: body.rewardPoints,
      couponId: body.couponId ?? null,
      couponName: couponNameOf(body.couponId),
      enabled: body.enabled,
      remark: body.remark ?? null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    milestones.push(created);
    return ok(created, '创建成功');
  }),
  mock(checkinMilestoneContract.update, ({ params, body, ok }) => {
    const target = milestones.find((m) => m.id === params.id);
    if (!target) return notFound('里程碑不存在', { status: 404 });
    Object.assign(target, body, {
      couponName: couponNameOf(body.couponId ?? target.couponId),
      updatedAt: mockDateTime(),
    });
    return ok(target, '更新成功');
  }),
  mock(checkinMilestoneContract.remove, ({ params, ok }) => {
    const index = milestones.findIndex((m) => m.id === params.id);
    if (index >= 0) milestones.splice(index, 1);
    return ok(null, '删除成功');
  }),

  // ── 我的里程碑（C 端）─────────────────────────────────────────
  mock(memberSelfContract.checkinMilestones, ({ ok }) => ok(buildMilestoneStatus(checkinStatus.totalDays))),

  // ── 后台为会员补签 ────────────────────────────────────────────
  mock(memberContract.makeupCheckin, ({ params, body, ok }) => {
    const reward = getReward(1);
    const created: MemberCheckin = {
      id: nextIdFrom(memberCheckins),
      memberId: params.id,
      memberNickname: `会员#${params.id}`,
      checkinDate: body.date,
      consecutiveDays: 1,
      pointsAwarded: reward?.points ?? 0,
      experienceAwarded: reward?.experience ?? 0,
      isMakeup: true,
      remark: body.reason,
      createdAt: mockDateTime(),
    };
    memberCheckins.unshift(created);
    return ok({
      checkinDate: body.date,
      pointsAwarded: created.pointsAwarded,
      experienceAwarded: created.experienceAwarded,
      costPoints: 0,
      consecutiveDays: 1,
    }, '补签成功');
  }),

  // ── 会员自助补签（C 端）───────────────────────────────────────
  mock(memberSelfContract.makeupCheckin, ({ body, ok }) => {
    if (!settings.makeupEnabled) {
      return badRequest('补签功能未开放', { status: 400 });
    }
    const reward = getReward(1);
    checkinStatus = { ...checkinStatus, totalDays: checkinStatus.totalDays + 1 };
    memberCheckins.unshift({
      id: nextIdFrom(memberCheckins),
      memberId: 1,
      memberNickname: '演示会员',
      checkinDate: body.date,
      consecutiveDays: 1,
      pointsAwarded: reward?.points ?? 0,
      experienceAwarded: reward?.experience ?? 0,
      isMakeup: true,
      remark: null,
      createdAt: mockDateTime(),
    });
    return ok({
      checkinDate: body.date,
      pointsAwarded: reward?.points ?? 0,
      experienceAwarded: reward?.experience ?? 0,
      costPoints: settings.makeupCostPoints,
      consecutiveDays: 1,
    }, '补签成功');
  }),
];
