/**
 * session-manager 单元测试
 *
 * 覆盖要点：
 *  1. generateTokenId — 格式是 UUID v4
 *  2. registerSession — 正确写入 Redis 并设置 TTL
 *  3. touchSession    — 更新 lastActiveAt；key 不存在时为 no-op
 *  4. isTokenBlacklisted — 命中 / 未命中黑名单
 *  5. forceLogout     — 写黑名单 + 删 session；key 不存在时返回 false
 *  6. removeSession   — 删 session key
 *
 * 之所以 mock redis 而非真实连接：session-manager 是纯业务逻辑，
 * 其正确性不依赖 Redis 存储细节，只需验证它发送了正确的命令、
 * 使用了正确的 key 前缀和 TTL。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import redis from './redis';
import {
  generateTokenId,
  registerSession,
  touchSession,
  isTokenBlacklisted,
  forceLogout,
  removeSession,
} from './session-manager';

// ─── Mock Redis ──────────────────────────────────────────────────────────────
// vi.mock is hoisted by vitest transform, so these mocks are applied before the
// module under test is evaluated, regardless of the textual order here.
vi.mock('./redis', () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    ttl: vi.fn(),
    scan: vi.fn(),
    mget: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
  },
}));

// ─── Mock config ─────────────────────────────────────────────────────────────
vi.mock('../config', () => ({
  config: {
    redis: { keyPrefix: 'zenith:' },
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

// vi.mocked 返回带正确 mock 类型的封装，运行时和直接使用 redis 完全一致
const redisMock = vi.mocked(redis);

function makeSessionInfo(overrides: Partial<Parameters<typeof registerSession>[0]> = {}) {
  return {
    tokenId: 'test-token-id',
    userId: 1,
    username: 'alice',
    nickname: 'Alice',
    ip: '127.0.0.1',
    browser: 'Chrome 120',
    os: 'Windows 10',
    loginAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateTokenId', () => {
  it('生成符合 UUID v4 格式的字符串', () => {
    const id = generateTokenId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('每次调用生成不同的值', () => {
    expect(generateTokenId()).not.toBe(generateTokenId());
  });
});

describe('registerSession', () => {
  it('以正确的 key 前缀和 TTL 写入 Redis', async () => {
    await registerSession(makeSessionInfo());

    expect(redisMock.set).toHaveBeenCalledWith(
      'zenith:session:test-token-id',
      expect.any(String),
      'EX',
      8 * 60 * 60, // SESSION_TTL = 8h
    );
  });

  it('写入的 JSON 包含 lastActiveAt 字段', async () => {
    await registerSession(makeSessionInfo({ tokenId: 'abc' }));
    const written = JSON.parse(redisMock.set.mock.calls[0][1] as string);
    expect(written).toHaveProperty('lastActiveAt');
    expect(written.tokenId).toBe('abc');
  });
});

describe('touchSession', () => {
  it('session 存在时更新 lastActiveAt 并续期 TTL', async () => {
    const session = makeSessionInfo({ tokenId: 'xyz' });
    redisMock.get.mockResolvedValueOnce(JSON.stringify({ ...session, lastActiveAt: new Date() }));

    await touchSession('xyz');

    expect(redisMock.set).toHaveBeenCalledWith(
      'zenith:session:xyz',
      expect.any(String),
      'EX',
      8 * 60 * 60,
    );
    const updated = JSON.parse(redisMock.set.mock.calls[0][1] as string);
    expect(updated).toHaveProperty('lastActiveAt');
  });

  it('session 不存在时为 no-op（不写 Redis）', async () => {
    redisMock.get.mockResolvedValueOnce(null);

    await touchSession('nonexistent');

    expect(redisMock.set).not.toHaveBeenCalled();
  });
});

describe('isTokenBlacklisted', () => {
  it('Redis 返回 1 时认为已拉黑', async () => {
    redisMock.exists.mockResolvedValueOnce(1);
    expect(await isTokenBlacklisted('bad-token')).toBe(true);
    expect(redisMock.exists).toHaveBeenCalledWith('zenith:blacklist:bad-token');
  });

  it('Redis 返回 0 时认为未拉黑', async () => {
    redisMock.exists.mockResolvedValueOnce(0);
    expect(await isTokenBlacklisted('good-token')).toBe(false);
  });
});

describe('forceLogout', () => {
  it('session 存在时写黑名单、删 session，并返回 true', async () => {
    const session = makeSessionInfo({ tokenId: 'force-id' });
    redisMock.get.mockResolvedValueOnce(JSON.stringify(session));

    const result = await forceLogout('force-id');

    expect(result).toBe(true);
    // 黑名单 key 正确，TTL = 2h
    const setCalls = redisMock.set.mock.calls as unknown[][];
    const hasBlacklist = setCalls.some(
      (args) => args[0] === 'zenith:blacklist:force-id' && args[2] === 'EX' && args[3] === 2 * 60 * 60,
    );
    expect(hasBlacklist).toBe(true);
    // session key 已删除
    expect(redisMock.del).toHaveBeenCalledWith('zenith:session:force-id');
  });

  it('session 不存在时返回 false，不写黑名单', async () => {
    redisMock.get.mockResolvedValueOnce(null);

    const result = await forceLogout('phantom-id');

    expect(result).toBe(false);
    expect(redisMock.set).not.toHaveBeenCalled();
    expect(redisMock.del).not.toHaveBeenCalled();
  });
});

describe('removeSession', () => {
  it('以正确的 key 调 redis.del', async () => {
    await removeSession('logout-token');
    expect(redisMock.del).toHaveBeenCalledWith('zenith:session:logout-token');
  });
});
