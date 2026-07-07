/**
 * 会员签到服务单测（连续签到计数 + 阶梯奖励 + 防重复 + 里程碑发放 + 成长值闭环）。
 *
 * 覆盖要点：
 *  1. doCheckin：当日重复签到 400、首次签到 consecutive=1、昨日连续 +1、
 *     阶梯奖励精确命中 / 向下回退 / 超出最后档取最后档、无规则零奖励、
 *     并发唯一约束 → 400、积分入账 + 流水 + 经验值更新 + 成长值定级
 *  2. 里程碑：达标未领 → 原子加积分 + 发放记录；已领过跳过
 *
 * Mock 策略：db / member-context / coupons.service(grantCouponInTx) mock；
 * dayjs 真实（用 fake timers 固定今天/昨天）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../db', () => {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    $count: vi.fn(),
    transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
    query: {
      memberCheckins: { findFirst: vi.fn(), findMany: vi.fn() },
    },
  };
  return { db };
});

vi.mock('../../lib/member-context', () => ({
  currentMemberId: vi.fn().mockReturnValue(7),
}));

vi.mock('../../lib/redis', () => ({
  default: { get: vi.fn(), set: vi.fn(), del: vi.fn(), exists: vi.fn() },
}));

vi.mock('./coupons.service', () => ({
  grantCouponInTx: vi.fn(),
}));

import { db } from '../../db';
import { currentMemberId } from '../../lib/member-context';
import { doCheckin } from './member-checkin.service';

const dbMock = vi.mocked(db);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[] | (() => Promise<unknown[]>)): any {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'offset', 'orderBy', 'set', 'values', 'returning', 'onConflictDoNothing']) {
    chain[m] = vi.fn(() => chain);
  }
  const resolveResult = () => (typeof result === 'function' ? result() : Promise.resolve(result));
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    resolveResult().then(resolve, reject);
  return chain;
}

const RULES = [
  { id: 1, dayNumber: 1, points: 5, experience: 2 },
  { id: 2, dayNumber: 3, points: 10, experience: 4 },
  { id: 3, dayNumber: 7, points: 20, experience: 8 },
];

/**
 * doCheckin 的 select 序列：
 *  1. 今日签到记录  2. 昨日签到记录  3. 签到规则
 *  4.（points>0 时）积分账户
 *  5.（experience>0 时）applyGrowthDeltaInTx：会员成长值  6. 匹配等级
 *  7. 里程碑列表  8. 已领里程碑
 */
function mockCheckinFlow(opts: {
  today?: unknown[];
  yesterday?: unknown[];
  rules?: unknown[];
  account?: unknown[];
  growth?: unknown[];
  matchedLevel?: unknown[];
  milestones?: unknown[];
  awarded?: unknown[];
}) {
  dbMock.select.mockReturnValueOnce(createChain(opts.today ?? []));
  if ((opts.today ?? []).length > 0) return;
  dbMock.select.mockReturnValueOnce(createChain(opts.yesterday ?? []));
  dbMock.select.mockReturnValueOnce(createChain(opts.rules ?? RULES));
  const hasReward = (opts.rules ?? RULES).length > 0;
  if (hasReward) {
    dbMock.select.mockReturnValueOnce(createChain(opts.account ?? [{ id: 1 }]));
    // 成长值闭环：applyGrowthDeltaInTx 读会员成长值 + 匹配等级
    dbMock.select.mockReturnValueOnce(createChain(opts.growth ?? [{ growthValue: 100 }]));
    dbMock.select.mockReturnValueOnce(createChain(opts.matchedLevel ?? []));
  }
  dbMock.select.mockReturnValueOnce(createChain(opts.milestones ?? []));
  if ((opts.milestones ?? []).length > 0) {
    dbMock.select.mockReturnValueOnce(createChain(opts.awarded ?? []));
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(currentMemberId).mockReturnValue(7);
  dbMock.transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));
  dbMock.insert.mockImplementation(() => createChain([]));
  dbMock.update.mockImplementation(() => createChain([{ balance: 105 }]));
  dbMock.$count.mockResolvedValue(1);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-05T09:00:00'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('doCheckin - 防重复与连续计数', () => {
  it('今天已签到 → 400', async () => {
    mockCheckinFlow({ today: [{ id: 1, checkinDate: '2026-07-05' }] });
    await expect(doCheckin()).rejects.toMatchObject({ status: 400, message: '今天已经签到过了' });
    expect(dbMock.transaction).not.toHaveBeenCalled();
  });

  it('首次签到：consecutiveDays=1，命中第 1 天规则', async () => {
    mockCheckinFlow({ yesterday: [] });
    const result = await doCheckin();
    expect(result).toEqual({ consecutiveDays: 1, points: 5, experience: 2, checkinDate: '2026-07-05' });
  });

  it('昨日已签：连续天数 +1（6 → 7），精确命中第 7 天档', async () => {
    mockCheckinFlow({ yesterday: [{ consecutiveDays: 6 }] });
    const result = await doCheckin();
    expect(result.consecutiveDays).toBe(7);
    expect(result.points).toBe(20);
    expect(result.experience).toBe(8);
  });

  it('断签后重新开始：昨日无记录 → consecutive 重置为 1', async () => {
    mockCheckinFlow({ yesterday: [] });
    const result = await doCheckin();
    expect(result.consecutiveDays).toBe(1);
  });

  it('并发双签撞唯一约束 → 映射 400', async () => {
    mockCheckinFlow({ yesterday: [] });
    dbMock.insert.mockReturnValueOnce(createChain(() => Promise.reject({ cause: { code: '23505' } })));
    await expect(doCheckin()).rejects.toMatchObject({ status: 400, message: '今天已经签到过了' });
  });
});

describe('doCheckin - 阶梯奖励匹配', () => {
  it('无精确档位向下回退（第 5 天 → 取第 3 天档）', async () => {
    mockCheckinFlow({ yesterday: [{ consecutiveDays: 4 }] });
    const result = await doCheckin();
    expect(result.consecutiveDays).toBe(5);
    expect(result.points).toBe(10);
  });

  it('超出最后档（第 30 天）→ 沿用最后档奖励', async () => {
    mockCheckinFlow({ yesterday: [{ consecutiveDays: 29 }] });
    const result = await doCheckin();
    expect(result.points).toBe(20);
  });

  it('未配置任何规则 → 零奖励，不做积分入账', async () => {
    mockCheckinFlow({ yesterday: [], rules: [] });
    const result = await doCheckin();
    expect(result).toMatchObject({ points: 0, experience: 0 });
    expect(dbMock.update).not.toHaveBeenCalled(); // 无积分/经验更新
  });
});

describe('doCheckin - 入账与里程碑', () => {
  it('积分入账：原子加余额 + 写 earn 流水 + 更新经验值与成长值定级', async () => {
    mockCheckinFlow({ yesterday: [] });
    const checkinInsert = createChain([]);
    const txInsert = createChain([]);
    dbMock.insert.mockReturnValueOnce(checkinInsert).mockReturnValueOnce(txInsert);

    await doCheckin();

    expect(checkinInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 7, checkinDate: '2026-07-05', consecutiveDays: 1, pointsAwarded: 5 }),
    );
    expect(txInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'earn', amount: 5, bizType: 'checkin', balanceAfter: 105 }),
    );
    expect(dbMock.update).toHaveBeenCalledTimes(3); // 积分账户 + 会员经验 + 成长值定级
  });

  it('经验值同步累加成长值并按阈值重定级（等级成长闭环）', async () => {
    mockCheckinFlow({ yesterday: [], growth: [{ growthValue: 100 }], matchedLevel: [{ id: 3 }] });
    const updates: ReturnType<typeof createChain>[] = [];
    dbMock.update.mockImplementation(() => {
      const c = createChain([{ balance: 105 }]);
      updates.push(c);
      return c;
    });

    await doCheckin();

    // 第 3 次 update 为 applyGrowthDeltaInTx：growthValue = 100 + 2（第 1 天经验），命中等级 3
    expect(updates).toHaveLength(3);
    expect(updates[2].set).toHaveBeenCalledWith({ growthValue: 102, levelId: 3 });
  });

  it('积分账户不存在时先初始化再入账', async () => {
    mockCheckinFlow({ yesterday: [], account: [] });
    const inserts: ReturnType<typeof createChain>[] = [];
    dbMock.insert.mockImplementation(() => {
      const c = createChain([]);
      inserts.push(c);
      return c;
    });

    await doCheckin();

    // 插入顺序：签到记录 → 积分账户初始化 → 积分流水
    expect(inserts[1].values).toHaveBeenCalledWith({ memberId: 7 });
  });

  it('达成里程碑且未领取 → 原子加积分并写发放记录', async () => {
    dbMock.$count.mockResolvedValue(7); // 累计签到 7 天
    mockCheckinFlow({
      yesterday: [{ consecutiveDays: 6 }],
      milestones: [{ id: 1, cumulativeDays: 7, enabled: true, rewardType: 'points', rewardPoints: 50, couponId: null }],
      awarded: [],
    });
    dbMock.select.mockReturnValueOnce(createChain([{ id: 1 }])); // ensurePointAccount（里程碑积分前置检查）
    const inserts: ReturnType<typeof createChain>[] = [];
    dbMock.insert.mockImplementation(() => {
      const c = createChain([]);
      inserts.push(c);
      return c;
    });

    await doCheckin();

    // 里程碑发放记录（最后一次 insert 带 onConflictDoNothing）
    const awardInsert = inserts.at(-1)!;
    expect(awardInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 7, milestoneId: 1, rewardType: 'points', rewardPoints: 50 }),
    );
    expect(awardInsert.onConflictDoNothing).toHaveBeenCalled();
    // 里程碑流水（倒数第二次 insert）
    expect(inserts.at(-2)!.values).toHaveBeenCalledWith(
      expect.objectContaining({ bizType: 'checkin_milestone', amount: 50 }),
    );
  });

  it('里程碑已领取过 → 跳过不重复发放', async () => {
    dbMock.$count.mockResolvedValue(7);
    mockCheckinFlow({
      yesterday: [{ consecutiveDays: 6 }],
      milestones: [{ id: 1, cumulativeDays: 7, enabled: true, rewardType: 'points', rewardPoints: 50, couponId: null }],
      awarded: [{ milestoneId: 1 }],
    });
    const inserts: ReturnType<typeof createChain>[] = [];
    dbMock.insert.mockImplementation(() => {
      const c = createChain([]);
      inserts.push(c);
      return c;
    });

    await doCheckin();

    // 仅签到记录 + 签到积分流水，两次 insert，无里程碑相关写入
    expect(inserts).toHaveLength(2);
  });
});
