/**
 * 登录失败防护守卫单元测试。
 *
 * 覆盖要点（用内存假 Redis 验证发出的命令与状态迁移，而非真实连接）：
 *   1. 失败按「账号 × 来源」计数：达阈值只让失败的来源过验证码，别的来源不受影响
 *      —— 这是「攻击者不能用别人的用户名把真正的用户锁在门外」的核心保证
 *   2. 窗口内失败来源 IP 数达到 sourceLimit 时，整个账号都需验证码（分布式猜解）
 *   3. 登录成功只清该来源的计数与来源级要求，账号级要求保留到窗口结束
 *   4. batchRequired / clearAll 的账号级读写
 *   5. 突增告警：多来源 / 失败总量阈值各触发一次，同一账号同一原因每窗口只触发一次
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLoginChallengeGuard, type LoginChallengePolicy } from './login-challenge-guard';

const state = vi.hoisted(() => ({
  counters: new Map<string, number>(),
  sets: new Map<string, Set<string>>(),
  flags: new Map<string, string>(),
  zsets: new Map<string, Map<string, number>>(),
}));

function deleteKeys(keys: string[]): void {
  for (const key of keys) {
    state.counters.delete(key);
    state.sets.delete(key);
    state.flags.delete(key);
    state.zsets.delete(key);
  }
}

vi.mock('./redis', () => ({
  default: {
    incr: vi.fn(async (key: string) => {
      const next = (state.counters.get(key) ?? 0) + 1;
      state.counters.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (...keys: string[]) => { deleteKeys(keys); return keys.length; }),
    set: vi.fn(async (key: string, value: string, _ex: string, _ttl: number, nx?: string) => {
      if (nx === 'NX' && state.flags.has(key)) return null;
      state.flags.set(key, value);
      return 'OK';
    }),
    sadd: vi.fn(async (key: string, ...members: string[]) => {
      const set = state.sets.get(key) ?? new Set<string>();
      for (const member of members) set.add(member);
      state.sets.set(key, set);
      return members.length;
    }),
    srem: vi.fn(async (key: string, ...members: string[]) => {
      const set = state.sets.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const member of members) if (set.delete(member)) removed += 1;
      return removed;
    }),
    smembers: vi.fn(async (key: string) => [...(state.sets.get(key) ?? [])]),
    sismember: vi.fn(async (key: string, member: string) => (state.sets.get(key)?.has(member) ? 1 : 0)),
    zadd: vi.fn(async (key: string, score: string, member: string) => {
      const zset = state.zsets.get(key) ?? new Map<string, number>();
      zset.set(member, Number(score));
      state.zsets.set(key, zset);
      return 1;
    }),
    zrem: vi.fn(async (key: string, ...members: string[]) => {
      const zset = state.zsets.get(key);
      if (!zset) return 0;
      let removed = 0;
      for (const member of members) if (zset.delete(member)) removed += 1;
      return removed;
    }),
    zrange: vi.fn(async (key: string) => [...(state.zsets.get(key)?.keys() ?? [])]),
    zcard: vi.fn(async (key: string) => state.zsets.get(key)?.size ?? 0),
    zremrangebyscore: vi.fn(async () => 0),
    pipeline: vi.fn(() => {
      const keys: string[] = [];
      const chain: Record<string, unknown> = {};
      chain.exists = (key: string) => { keys.push(key); return chain; };
      chain.exec = async () => keys.map((key) => [null, state.sets.has(key) ? 1 : 0]);
      return chain;
    }),
  },
}));

const guard = createLoginChallengeGuard('zenith:login_');

/** 防护阈值：3 次单来源失败即要求验证码，2 个来源即账号级；告警关闭 */
const POLICY: LoginChallengePolicy = {
  maxAttemptsPerSource: 3,
  sourceLimit: 2,
  windowMinutes: 30,
  alert: { enabled: false, sourceThreshold: 3, failureThreshold: 5 },
};

/** 3 个来源 / 5 次失败即告警 */
const ALERT_POLICY: LoginChallengePolicy = {
  ...POLICY,
  alert: { enabled: true, sourceThreshold: 3, failureThreshold: 5 },
};

/** 连续失败 n 次（模拟同一来源的连续尝试），返回最后一次的剩余次数 */
async function failTimes(username: string, ip: string, times: number, policy: LoginChallengePolicy = POLICY) {
  let remaining = Number.NaN;
  for (let i = 0; i < times; i += 1) remaining = (await guard.recordFailure(username, ip, policy)).remaining;
  return remaining;
}

beforeEach(() => {
  state.counters.clear();
  state.sets.clear();
  state.flags.clear();
  state.zsets.clear();
});

describe('按 账号 × 来源 隔离', () => {
  it('达到来源阈值只要求该来源过验证码，其它来源不受影响', async () => {
    const remaining = await failTimes('alice', '1.1.1.1', 3);
    expect(remaining).toBe(0);

    expect(await guard.check('alice', '1.1.1.1')).toBe(true);
    // 真正的用户从自己的出口登录：既不需要验证码，也不被拒绝
    expect(await guard.check('alice', '2.2.2.2')).toBe(false);
  });

  it('阈值以下是普通失败，不进入验证码防护', async () => {
    const remaining = await failTimes('alice', '1.1.1.1', 2);
    expect(remaining).toBe(1);
    expect(await guard.check('alice', '1.1.1.1')).toBe(false);
  });

  it('不同账号互不影响', async () => {
    await failTimes('alice', '1.1.1.1', 3);
    expect(await guard.check('bob', '1.1.1.1')).toBe(false);
  });
});

describe('多来源失败升级为账号级验证码', () => {
  it('窗口内失败来源数达到 sourceLimit 时，该账号所有来源都要验证码', async () => {
    await failTimes('alice', '1.1.1.1', 1);
    await failTimes('alice', '2.2.2.2', 1);

    expect(await guard.check('alice', '3.3.3.3')).toBe(true);
  });

  it('同一来源重复失败只算一个来源，不会误升级为账号级', async () => {
    await failTimes('alice', '1.1.1.1', 2);
    expect(await guard.check('alice', '2.2.2.2')).toBe(false);
  });
});

describe('登录成功后的清理', () => {
  it('只清该来源的计数与来源级要求，账号级要求保留到窗口结束', async () => {
    await failTimes('alice', '1.1.1.1', 3);
    await failTimes('alice', '2.2.2.2', 3);
    await failTimes('alice', '1.1.1.1', 1);
    await failTimes('alice', '2.2.2.2', 1);

    await guard.clear('alice', '1.1.1.1');

    // 该来源恢复自由（计数清零后重新从 1 计）
    expect(await failTimes('alice', '1.1.1.1', 1)).toBe(2);
    expect(await guard.isSourceChallenged('alice', '1.1.1.1')).toBe(false);
    // 账号级要求仍在：攻击还在继续，但真正的用户凭验证码照样能登录
    expect(await guard.check('alice', '9.9.9.9')).toBe(true);
  });
});

describe('批量查询与管理员清除', () => {
  it('batchRequired 只返回当前要求验证码的账号', async () => {
    await failTimes('alice', '1.1.1.1', 3);
    await failTimes('bob', '2.2.2.2', 1);

    expect(await guard.batchRequired(['alice', 'bob', 'carol'])).toEqual(new Set(['alice']));
    expect(await guard.batchRequired([])).toEqual(new Set());
  });

  it('clearAll 清空全部来源的计数与验证码要求', async () => {
    await failTimes('alice', '1.1.1.1', 3);
    await failTimes('alice', '2.2.2.2', 1);

    await guard.clearAll('alice');

    expect(await guard.check('alice', '1.1.1.1')).toBe(false);
    expect(await guard.check('alice', '2.2.2.2')).toBe(false);
    expect(await failTimes('alice', '1.1.1.1', 1)).toBe(2);
  });
});

describe('突增告警', () => {
  it('窗口内失败来源数达到告警阈值时返回多来源告警，且同窗口不再重复', async () => {
    await failTimes('alice', '1.1.1.1', 1, ALERT_POLICY);
    await failTimes('alice', '2.2.2.2', 1, ALERT_POLICY);

    const hit = await guard.recordFailure('alice', '3.3.3.3', ALERT_POLICY);
    expect(hit.bursts).toEqual(['multi-source']);
    expect(hit).toMatchObject({ sourceCount: 3, failureCount: 3 });

    // 攻击继续，但同一窗口不再重复告警（否则管理员会被同一场攻击刷屏）
    const again = await guard.recordFailure('alice', '4.4.4.4', ALERT_POLICY);
    expect(again.bursts).toEqual([]);
  });

  it('失败总量达到告警阈值时返回失败量告警', async () => {
    // 2 个来源（低于多来源阈值 3），但累计失败 5 次命中总量阈值
    let last = await guard.recordFailure('alice', '1.1.1.1', ALERT_POLICY);
    for (let i = 0; i < 3; i += 1) last = await guard.recordFailure('alice', '1.1.1.1', ALERT_POLICY);
    expect(last.bursts).toEqual([]);

    last = await guard.recordFailure('alice', '2.2.2.2', ALERT_POLICY);
    expect(last.bursts).toEqual(['high-volume']);
    expect(last.failureCount).toBe(5);
  });

  it('两种原因可以同时触发', async () => {
    const policy: LoginChallengePolicy = { ...ALERT_POLICY, alert: { enabled: true, sourceThreshold: 2, failureThreshold: 2 } };
    await guard.recordFailure('alice', '1.1.1.1', policy);
    const hit = await guard.recordFailure('alice', '2.2.2.2', policy);

    expect(hit.bursts.sort()).toEqual(['high-volume', 'multi-source']);
  });

  it('关闭告警后只计数不告警', async () => {
    const hits: string[][] = [];
    for (let i = 0; i < 6; i += 1) {
      hits.push((await guard.recordFailure('alice', `10.0.0.${i}`, POLICY)).bursts);
    }
    expect(hits.flat()).toEqual([]);
  });

  it('账号间互不干扰：一个账号的告警不影响另一个账号', async () => {
    await failTimes('alice', '1.1.1.1', 1, ALERT_POLICY);
    await failTimes('alice', '2.2.2.2', 1, ALERT_POLICY);
    await guard.recordFailure('alice', '3.3.3.3', ALERT_POLICY);

    const bob = await guard.recordFailure('bob', '4.4.4.4', ALERT_POLICY);
    expect(bob.bursts).toEqual([]);
  });

  it('管理员清除后同一窗口内再次触发仍会告警', async () => {
    await failTimes('alice', '1.1.1.1', 1, ALERT_POLICY);
    await failTimes('alice', '2.2.2.2', 1, ALERT_POLICY);
    await guard.recordFailure('alice', '3.3.3.3', ALERT_POLICY);

    await guard.clearAll('alice');

    await failTimes('alice', '1.1.1.1', 1, ALERT_POLICY);
    await failTimes('alice', '2.2.2.2', 1, ALERT_POLICY);
    const hit = await guard.recordFailure('alice', '5.5.5.5', ALERT_POLICY);
    expect(hit.bursts).toEqual(['multi-source']);
  });
});
