/**
 * 接口限流中间件单测。
 *
 * 覆盖要点：
 *  1. 固定窗口：到限额放行、超限 429，标准 RateLimit-* 头与 Retry-After
 *  2. monitor 观察模式：超限只记拦截统计，请求放行
 *  3. 同请求规则去重：named + pathBound 命中同一规则只计一次
 *  4. 路径绑定：exact 与 /* 通配匹配、多规则命中按 priority 取大者
 *  5. 禁用规则直接放行（不触 Redis）
 *  6. Redis 故障放行（可用性优先于限流精确性）
 *  7. 解封：删除计数键 + 按裸身份清理 recent 记录（JSON member）
 *  8. 目录一致性：内置规则全部登记在 PREDEFINED_NAMES 且无死规则
 *
 * Mock 策略：redis 用带状态的内存假实现（eval 模拟固定窗口 Lua 语义），
 * config / db / logger / context 全部 mock。Lua 脚本本身的正确性由真实 Redis 冒烟验证。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../config', () => ({
  config: { redis: { keyPrefix: 'test:' }, trustedProxyCidrs: [] },
}));

vi.mock('../lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../lib/context', () => ({
  currentUser: vi.fn(() => undefined),
}));

// refreshRateLimitRules 经 db.select().from() 读规则表；测试通过它注入自定义规则
const dbRows: unknown[] = [];
vi.mock('../db', () => ({
  db: { select: () => ({ from: () => Promise.resolve(dbRows) }) },
}));

// 突增告警 service（中间件动态 import，vi.mock 同样拦截动态导入）
vi.mock('../services/platform/rate-limit-alert.service', () => ({
  maybeSendRateLimitSpikeAlert: vi.fn(() => Promise.resolve()),
}));

import { currentUser } from '../lib/context';
import { maybeSendRateLimitSpikeAlert } from '../services/platform/rate-limit-alert.service';

// ─── 带状态的 Redis 假实现 ─────────────────────────────────────────────────────
interface CounterState { count: number; expiresAt: number }
const counters = new Map<string, CounterState>();
const zsets = new Map<string, string[]>();
const bans = new Map<string, number>(); // key → expiresAt
const kvNums = new Map<string, number>(); // 统计计数器（incr）
const hashes = new Map<string, Map<string, number>>(); // 小时/日序列（hincrby）
const zscores = new Map<string, Map<string, number>>(); // Top 来源（zincrby）
let evalFails = false;

function banTtl(key: string): number {
  const expiresAt = bans.get(key);
  if (expiresAt === undefined) return -2;
  const ttl = expiresAt - Date.now();
  if (ttl <= 0) {
    bans.delete(key);
    return -2;
  }
  return ttl;
}

function incrCounter(key: string, windowMs: number): number {
  const now = Date.now();
  let state = counters.get(key);
  if (!state || state.expiresAt <= now) {
    state = { count: 0, expiresAt: now + windowMs };
    counters.set(key, state);
  }
  state.count += 1;
  return state.count;
}

const redisMock = {
  eval: vi.fn((_script: string, numKeys: number, ...args: string[]) => {
    if (evalFails) return Promise.reject(new Error('redis down'));
    const keys = args.slice(0, numKeys);
    const windowMs = Number(args[numKeys]);
    if (numKeys === 3) {
      // 滑动窗口脚本：[currBucket, prevBucket, banKey]
      const ttl = banTtl(keys[2]);
      if (ttl > 0) return Promise.resolve([-1, ttl]);
      const curr = incrCounter(keys[0], windowMs * 2);
      const prevState = counters.get(keys[1]);
      const prev = prevState && prevState.expiresAt > Date.now() ? prevState.count : 0;
      return Promise.resolve([curr, prev]);
    }
    // 固定窗口脚本：[counterKey, banKey]
    const ttl = banTtl(keys[1]);
    if (ttl > 0) return Promise.resolve([-1, ttl]);
    const count = incrCounter(keys[0], windowMs);
    const state = counters.get(keys[0]);
    return Promise.resolve([count, state ? state.expiresAt - Date.now() : windowMs]);
  }),
  multi: vi.fn(() => {
    // 有状态的 pipeline 模拟：exec 按链式顺序返回 [err, result]，
    // 突增告警依赖 hincrby 的返回值（当前小时拦截数）
    const ops: Array<() => unknown> = [];
    const chain = {
      incr: (key: string) => {
        ops.push(() => {
          const next = (kvNums.get(key) ?? 0) + 1;
          kvNums.set(key, next);
          return next;
        });
        return chain;
      },
      expire: () => {
        ops.push(() => 1);
        return chain;
      },
      hincrby: (key: string, field: string, delta: number) => {
        ops.push(() => {
          const hash = hashes.get(key) ?? new Map<string, number>();
          const next = (hash.get(field) ?? 0) + delta;
          hash.set(field, next);
          hashes.set(key, hash);
          return next;
        });
        return chain;
      },
      zincrby: (key: string, delta: number, member: string) => {
        ops.push(() => {
          const scores = zscores.get(key) ?? new Map<string, number>();
          const next = (scores.get(member) ?? 0) + delta;
          scores.set(member, next);
          zscores.set(key, scores);
          return String(next);
        });
        return chain;
      },
      zremrangebyrank: () => {
        ops.push(() => 0);
        return chain;
      },
      zadd: (key: string, _score: number, member: string) => {
        ops.push(() => {
          const list = zsets.get(key) ?? [];
          list.push(member);
          zsets.set(key, list);
          return 1;
        });
        return chain;
      },
      exec: () => Promise.resolve(ops.map((op) => [null, op()] as [null, unknown])),
    };
    return chain;
  }),
  set: vi.fn((key: string, _value: string, _px: string, ms: number) => {
    bans.set(key, Date.now() + ms);
    return Promise.resolve('OK');
  }),
  pttl: vi.fn((key: string) => Promise.resolve(banTtl(key))),
  scan: vi.fn((_cursor: string, _match: string, pattern: string) => {
    const prefix = pattern.replace(/\*$/, '');
    const keys = [...bans.keys()].filter((k) => k.startsWith(prefix) && banTtl(k) > 0);
    return Promise.resolve(['0', keys]);
  }),
  del: vi.fn((...keys: string[]) => {
    let n = 0;
    for (const key of keys) {
      if (counters.delete(key)) n += 1;
      if (bans.delete(key)) n += 1;
    }
    return Promise.resolve(n);
  }),
  zrange: vi.fn((key: string) => Promise.resolve(zsets.get(key) ?? [])),
  zrem: vi.fn((key: string, ...members: string[]) => {
    const list = zsets.get(key) ?? [];
    zsets.set(key, list.filter((m) => !members.includes(m)));
    return Promise.resolve(members.length);
  }),
};

vi.mock('../lib/redis', () => ({ default: redisMock }));

const {
  namedRateLimit,
  pathBoundRateLimit,
  refreshRateLimitRules,
  unblockRateLimitKey,
  banRateLimitKey,
  unbanRateLimitKey,
  listRateLimitBans,
  listRuleConfigs,
  getMountSource,
  PREDEFINED_NAMES,
  CODE_MOUNTED_NAMES,
} = await import('./rate-limit');

/** 构造完整的规则行（DB 行形状），仅覆盖关心的字段 */
function ruleRow(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    description: null,
    windowMs: 60_000,
    limit: 2,
    keyType: 'ip',
    enabled: true,
    mode: 'enforce',
    algorithm: 'fixed_window',
    allowlist: [],
    priority: 0,
    alertThreshold: null,
    blockedMessage: null,
    pathPatterns: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

async function loadRules(...rows: Record<string, unknown>[]): Promise<void> {
  dbRows.length = 0;
  dbRows.push(...rows);
  await refreshRateLimitRules();
}

/** 等待 fire-and-forget 的统计写入落地 */
const flushAsync = () => new Promise((r) => setImmediate(r));

beforeEach(async () => {
  counters.clear();
  zsets.clear();
  bans.clear();
  kvNums.clear();
  hashes.clear();
  zscores.clear();
  evalFails = false;
  vi.clearAllMocks();
  await loadRules();
});

describe('固定窗口限流', () => {
  it('到限额放行、超限 429，带标准 RateLimit-* 头与 Retry-After', async () => {
    await loadRules(ruleRow({ name: 't_fixed', limit: 2, blockedMessage: '慢一点' }));
    const app = new Hono();
    app.get('/api/t', namedRateLimit('t_fixed'), (c) => c.json({ ok: true }));

    const r1 = await app.request('/api/t');
    expect(r1.status).toBe(200);
    expect(r1.headers.get('RateLimit-Limit')).toBe('2');
    expect(r1.headers.get('RateLimit-Remaining')).toBe('1');

    const r2 = await app.request('/api/t');
    expect(r2.status).toBe(200);
    expect(r2.headers.get('RateLimit-Remaining')).toBe('0');

    const r3 = await app.request('/api/t');
    expect(r3.status).toBe(429);
    expect(r3.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(Number(r3.headers.get('RateLimit-Reset'))).toBeGreaterThan(0);
    const body = await r3.json() as { message: string };
    expect(body.message).toBe('慢一点');
  });

  it('Redis 故障时放行（fail-open）', async () => {
    await loadRules(ruleRow({ name: 't_down', limit: 1 }));
    evalFails = true;
    const app = new Hono();
    app.get('/api/t', namedRateLimit('t_down'), (c) => c.json({ ok: true }));
    for (let i = 0; i < 3; i++) {
      expect((await app.request('/api/t')).status).toBe(200);
    }
  });

  it('禁用规则直接放行，不触 Redis', async () => {
    await loadRules(ruleRow({ name: 't_off', limit: 1, enabled: false }));
    const app = new Hono();
    app.get('/api/t', namedRateLimit('t_off'), (c) => c.json({ ok: true }));
    expect((await app.request('/api/t')).status).toBe(200);
    expect(redisMock.eval).not.toHaveBeenCalled();
  });
});

describe('monitor 观察模式', () => {
  it('超限只记拦截统计（monitored 标记），请求仍放行', async () => {
    await loadRules(ruleRow({ name: 't_mon', limit: 1, mode: 'monitor' }));
    const app = new Hono();
    app.get('/api/t', namedRateLimit('t_mon'), (c) => c.json({ ok: true }));

    expect((await app.request('/api/t')).status).toBe(200);
    expect((await app.request('/api/t')).status).toBe(200);
    expect((await app.request('/api/t')).status).toBe(200);
    await flushAsync();

    const recent = zsets.get('test:rlstats:t_mon:recent') ?? [];
    expect(recent.length).toBe(2);
    const record = JSON.parse(recent[0]) as { key: string; monitored?: boolean };
    expect(record.monitored).toBe(true);
    expect(record.key).toBe('127.0.0.1');
  });
});

describe('同请求规则去重', () => {
  it('named 中间件挂两次只计一次', async () => {
    await loadRules(ruleRow({ name: 't_dup', limit: 10 }));
    const app = new Hono();
    app.use('/api/t', namedRateLimit('t_dup'));
    app.get('/api/t', namedRateLimit('t_dup'), (c) => c.json({ ok: true }));
    await app.request('/api/t');
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
  });

  it('pathBound 与 named 命中同一规则只计一次', async () => {
    await loadRules(ruleRow({ name: 't_both', limit: 10, pathPatterns: ['/api/t'] }));
    const app = new Hono();
    app.use('*', pathBoundRateLimit);
    app.get('/api/t', namedRateLimit('t_both'), (c) => c.json({ ok: true }));
    await app.request('/api/t');
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
  });
});

describe('路径绑定', () => {
  it('exact 精确匹配、/* 前缀匹配、不匹配放行', async () => {
    await loadRules(ruleRow({ name: 't_path', limit: 1, pathPatterns: ['/api/exact', '/api/tree/*'] }));
    const app = new Hono();
    app.use('*', pathBoundRateLimit);
    app.get('*', (c) => c.json({ ok: true }));

    await app.request('/api/exact');
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    await app.request('/api/exact-suffix'); // exact 不做前缀匹配
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    await app.request('/api/tree/deep/child');
    expect(redisMock.eval).toHaveBeenCalledTimes(2);
    await app.request('/api/other');
    expect(redisMock.eval).toHaveBeenCalledTimes(2);
  });

  it('路径中间的 * 只匹配一个路径段', async () => {
    await loadRules(ruleRow({ name: 't_seg', limit: 1, pathPatterns: ['/api/releases/*/artifacts/upload/chunk'] }));
    const app = new Hono();
    app.use('*', pathBoundRateLimit);
    app.all('*', (c) => c.json({ ok: true }));

    await app.request('/api/releases/42/artifacts/upload/chunk', { method: 'POST' });
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    await app.request('/api/releases/42/extra/artifacts/upload/chunk', { method: 'POST' }); // * 不跨段
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    await app.request('/api/releases/42/artifacts/upload/init', { method: 'POST' }); // 尾段不同
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
  });

  it('多规则命中同一路径时取 priority 大者', async () => {
    await loadRules(
      ruleRow({ id: 1, name: 't_low', limit: 5, priority: 0, pathPatterns: ['/api/p/*'] }),
      ruleRow({ id: 2, name: 't_high', limit: 5, priority: 10, pathPatterns: ['/api/p/*'] }),
    );
    const app = new Hono();
    app.use('*', pathBoundRateLimit);
    app.get('*', (c) => c.json({ ok: true }));
    await app.request('/api/p/x');
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    const counterKey = redisMock.eval.mock.calls[0][2] as string;
    expect(counterKey).toContain('t_high|');
  });
});

describe('解封', () => {
  it('删除计数键并按裸身份清理 recent 记录', async () => {
    await loadRules(ruleRow({ name: 't_unblock', limit: 1 }));
    const app = new Hono();
    app.get('/api/t', namedRateLimit('t_unblock'), (c) => c.json({ ok: true }));
    await app.request('/api/t');
    expect((await app.request('/api/t')).status).toBe(429);
    await flushAsync();

    expect(counters.has('test:rl:t_unblock|127.0.0.1')).toBe(true);
    expect((zsets.get('test:rlstats:t_unblock:recent') ?? []).length).toBe(1);

    const ok = await unblockRateLimitKey('t_unblock', '127.0.0.1');
    expect(ok).toBe(true);
    expect(counters.has('test:rl:t_unblock|127.0.0.1')).toBe(false);
    expect((zsets.get('test:rlstats:t_unblock:recent') ?? []).length).toBe(0);

    // 解封后立即恢复访问
    expect((await app.request('/api/t')).status).toBe(200);
  });

  it('无活跃计数时返回 false', async () => {
    expect(await unblockRateLimitKey('t_unblock', '10.0.0.1')).toBe(false);
  });
});

describe('滑动窗口', () => {
  it('上一窗口计数按剩余占比加权，消除边界突刺', async () => {
    vi.useFakeTimers();
    try {
      const windowMs = 1000;
      // 固定到窗口正中：elapsed=500ms → 上一桶权重 0.5
      vi.setSystemTime(1_000_000_000_500);
      const bucket = Math.floor(Date.now() / windowMs);
      await loadRules(ruleRow({ name: 't_slide', limit: 2, windowMs, algorithm: 'sliding_window' }));
      // 预置上一桶计数 2（等效于上一窗口末尾的突发）
      counters.set(`test:rl:t_slide|127.0.0.1:${bucket - 1}`, { count: 2, expiresAt: Date.now() + windowMs });

      const app = new Hono();
      app.get('/api/t', namedRateLimit('t_slide'), (c) => c.json({ ok: true }));

      // 加权计数 = 1 + 2×0.5 = 2 ≤ 2 → 放行
      expect((await app.request('/api/t')).status).toBe(200);
      // 加权计数 = 2 + 2×0.5 = 3 > 2 → 拦截（固定窗口此时会放行，形成 2× 突刺）
      expect((await app.request('/api/t')).status).toBe(429);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('白名单豁免', () => {
  it('IP 命中白名单：放行且不计数', async () => {
    await loadRules(ruleRow({ name: 't_allow', limit: 1, allowlist: ['127.0.0.1'] }));
    const app = new Hono();
    app.get('/api/t', namedRateLimit('t_allow'), (c) => c.json({ ok: true }));
    for (let i = 0; i < 5; i++) {
      expect((await app.request('/api/t')).status).toBe(200);
    }
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it('CIDR 网段命中白名单', async () => {
    await loadRules(ruleRow({ name: 't_cidr', limit: 1, allowlist: ['127.0.0.0/8'] }));
    const app = new Hono();
    app.get('/api/t', namedRateLimit('t_cidr'), (c) => c.json({ ok: true }));
    expect((await app.request('/api/t')).status).toBe(200);
    expect((await app.request('/api/t')).status).toBe(200);
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it('u:{userId} 命中白名单（登录用户豁免）', async () => {
    vi.mocked(currentUser).mockReturnValue({ userId: 7 } as ReturnType<typeof currentUser>);
    try {
      await loadRules(ruleRow({ name: 't_user_allow', limit: 1, keyType: 'user', allowlist: ['u:7'] }));
      const app = new Hono();
      app.get('/api/t', namedRateLimit('t_user_allow'), (c) => c.json({ ok: true }));
      expect((await app.request('/api/t')).status).toBe(200);
      expect((await app.request('/api/t')).status).toBe(200);
      expect(redisMock.eval).not.toHaveBeenCalled();
    } finally {
      vi.mocked(currentUser).mockReturnValue(undefined);
    }
  });

  it('非法白名单条目被忽略，不影响其余条目', async () => {
    await loadRules(ruleRow({ name: 't_bad_allow', limit: 1, allowlist: ['not-an-ip!!', '127.0.0.1'] }));
    const app = new Hono();
    app.get('/api/t', namedRateLimit('t_bad_allow'), (c) => c.json({ ok: true }));
    expect((await app.request('/api/t')).status).toBe(200);
    expect(redisMock.eval).not.toHaveBeenCalled();
  });
});

describe('手动封禁', () => {
  it('封禁期内一律 429（含未超限流量与观察模式），解除后恢复', async () => {
    await loadRules(ruleRow({ name: 't_ban', limit: 100, mode: 'monitor' }));
    const app = new Hono();
    app.get('/api/t', namedRateLimit('t_ban'), (c) => c.json({ ok: true }));

    expect((await app.request('/api/t')).status).toBe(200);

    await banRateLimitKey('t_ban', '127.0.0.1', 600);
    const banned = await app.request('/api/t');
    expect(banned.status).toBe(429);
    expect(Number(banned.headers.get('Retry-After'))).toBeGreaterThan(0);
    await flushAsync();
    const recent = zsets.get('test:rlstats:t_ban:recent') ?? [];
    const record = JSON.parse(recent[recent.length - 1]) as { banned?: boolean };
    expect(record.banned).toBe(true);

    expect(await unbanRateLimitKey('t_ban', '127.0.0.1')).toBe(true);
    expect((await app.request('/api/t')).status).toBe(200);
  });

  it('活跃封禁列表返回剩余 TTL', async () => {
    await banRateLimitKey('t_ban', '10.0.0.9', 600);
    await banRateLimitKey('auth', 'u:3', 60);
    const list = await listRateLimitBans();
    expect(list.length).toBe(2);
    expect(list[0].name).toBe('auth'); // TTL 升序
    expect(list[0].key).toBe('u:3');
    expect(list[0].ttlMs).toBeGreaterThan(0);
    expect(list[1].key).toBe('10.0.0.9');
  });
});

describe('Top 来源与突增告警', () => {
  it('拦截时累积当日 Top 来源计数', async () => {
    await loadRules(ruleRow({ name: 't_top', limit: 1 }));
    const app = new Hono();
    app.get('/api/t', namedRateLimit('t_top'), (c) => c.json({ ok: true }));
    for (let i = 0; i < 4; i++) await app.request('/api/t');
    await flushAsync();

    const topKey = [...zscores.keys()].find((k) => k.includes('t_top:top:'));
    expect(topKey).toBeDefined();
    expect(zscores.get(topKey as string)?.get('127.0.0.1')).toBe(3); // 4 发中 3 发被拦截
  });

  it('小时拦截数达到 alertThreshold 时触发告警派发', async () => {
    await loadRules(ruleRow({ name: 't_alert', limit: 1, alertThreshold: 2 }));
    const app = new Hono();
    app.get('/api/t', namedRateLimit('t_alert'), (c) => c.json({ ok: true }));
    for (let i = 0; i < 4; i++) await app.request('/api/t'); // 拦截 3 次 → 第 2 次起达阈值
    await flushAsync();
    await flushAsync(); // 动态 import 多一跳微任务

    expect(maybeSendRateLimitSpikeAlert).toHaveBeenCalled();
    const call = vi.mocked(maybeSendRateLimitSpikeAlert).mock.calls[0][0];
    expect(call.ruleName).toBe('t_alert');
    expect(call.threshold).toBe(2);
    expect(call.blockedCount).toBeGreaterThanOrEqual(2);
  });

  it('未配置 alertThreshold 时不触发告警', async () => {
    await loadRules(ruleRow({ name: 't_no_alert', limit: 1 }));
    const app = new Hono();
    app.get('/api/t', namedRateLimit('t_no_alert'), (c) => c.json({ ok: true }));
    for (let i = 0; i < 4; i++) await app.request('/api/t');
    await flushAsync();
    await flushAsync();
    expect(maybeSendRateLimitSpikeAlert).not.toHaveBeenCalled();
  });
});

describe('规则目录一致性', () => {
  it('全部内置规则登记在 PREDEFINED_NAMES 且无死规则', async () => {
    await loadRules(); // 仅代码默认规则
    for (const cfg of listRuleConfigs()) {
      expect(PREDEFINED_NAMES.has(cfg.name), `${cfg.name} 应在 PREDEFINED_NAMES`).toBe(true);
      expect(Array.isArray(cfg.pathPatterns), `${cfg.name} 缺 pathPatterns`).toBe(true);
      const source = getMountSource(cfg.name, cfg.pathPatterns);
      expect(source, `${cfg.name} 是死规则（无代码挂载且无路径绑定）`).not.toBe('none');
    }
  });

  it('CODE_MOUNTED_NAMES 是 PREDEFINED_NAMES 的子集', () => {
    for (const name of CODE_MOUNTED_NAMES) {
      expect(PREDEFINED_NAMES.has(name)).toBe(true);
    }
  });
});
