/**
 * 会员认证服务单测（前台用户体系，认证安全关键）。
 *
 * 覆盖要点：
 *  1. loginMember 密码模式：账号不存在/无密码/密码错误 → 400（统一模糊报错防枚举），
 *     封禁 403、未激活 403、成功签发双 token + 注册会话 + 更新最后登录
 *  2. loginMember 短信模式：参数缺失/验证码错误/手机号未注册 → 400，成功登录
 *  3. refreshMemberToken：非法/类型不符（access 当 refresh 用）401、会员不存在 401、
 *     非 active 403、成功签发新 access token（type='member'）
 *  4. registerMember：无密码且无验证码 400、验证码错误 400、标识占用 400、
 *     成功注册（密码 bcrypt 落库 + 事务内初始化积分/钱包账户）、唯一约束冲突映射 400、
 *     服务端权威事件 member.registered（仅成功后触发，属性脱敏）
 *  5. changeMyMemberPassword / resetMemberPassword / logoutMember 关键分支
 *  6. updateMyMemberProfile：服务端权威事件 member.profile.updated（仅传变更字段名，
 *     无变更/失败时不触发）
 *
 * Mock 策略：db / config / member-session-manager / member-sms / ip-location /
 * member-context / analytics-server-events.service mock；bcrypt 与 lib/jwt 用真实实现（验证密码哈希与 token payload）。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';

vi.mock('../../config', () => ({
  config: {
    jwtSecret: 'unit-test-only-fake-secret-do-not-use-in-production',
    jwtRefreshSecret: 'unit-test-only-fake-refresh-secret',
  },
}));

vi.mock('../../db', () => {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    $count: vi.fn(),
    transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
    query: {
      members: { findFirst: vi.fn(), findMany: vi.fn() },
    },
  };
  return { db };
});

vi.mock('../../lib/member-session-manager', () => ({
  generateMemberTokenId: vi.fn().mockReturnValue('mock-member-token-id'),
  registerMemberSession: vi.fn().mockResolvedValue(undefined),
  removeMemberSession: vi.fn().mockResolvedValue(undefined),
  forceLogoutAllByMember: vi.fn().mockResolvedValue(undefined),
  checkMemberLoginLock: vi.fn().mockResolvedValue(0),
  recordMemberLoginFailure: vi.fn().mockResolvedValue(0),
  clearMemberLoginAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./member-sms.service', () => ({
  verifyMemberSmsCode: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../lib/ip-location', () => ({
  lookupIpLocation: vi.fn().mockReturnValue('内网地址'),
}));

vi.mock('../../lib/member-context', () => ({
  currentMember: vi.fn(),
  currentMemberId: vi.fn().mockReturnValue(1),
}));

// 服务端权威事件为 best-effort 异步旁路，unit test 中整体 mock 掉，
// 避免真实 logger/db 依赖被间接加载，同时便于断言触发时机与字段脱敏。
vi.mock('../analytics/analytics-server-events.service', () => ({
  trackServerEvent: vi.fn(),
}));

import { db } from '../../db';
import {
  generateMemberTokenId,
  registerMemberSession,
  removeMemberSession,
  forceLogoutAllByMember,
  checkMemberLoginLock,
  recordMemberLoginFailure,
} from '../../lib/member-session-manager';
import { verifyMemberSmsCode } from './member-sms.service';
import { currentMember } from '../../lib/member-context';
import { verifyToken } from '../../lib/jwt';
import { trackServerEvent } from '../analytics/analytics-server-events.service';
import {
  loginMember,
  registerMember,
  refreshMemberToken,
  issueMemberTokens,
  changeMyMemberPassword,
  resetMemberPassword,
  logoutMember,
  updateMyMemberProfile,
} from './member-auth.service';
import type { MemberRow } from '../../db/schema';

const dbMock = vi.mocked(db);
const smsMock = vi.mocked(verifyMemberSmsCode);
const currentMemberMock = vi.mocked(currentMember);
const trackServerEventMock = vi.mocked(trackServerEvent);

// ─── 工具：可 await 的链式 query builder mock ─────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[] | (() => Promise<unknown[]>)): any {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'limit', 'offset', 'orderBy', 'set', 'values', 'returning'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  // 惰性求值：await 时才产生 Promise，避免急切创建的 rejected promise 触发 unhandled rejection
  const resolveResult = () => (typeof result === 'function' ? result() : Promise.resolve(result));
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    resolveResult().then(resolve, reject);
  chain.catch = (fn: (e: unknown) => unknown) => resolveResult().catch(fn);
  return chain;
}

const PASSWORD = 'P@ssw0rd123';
let HASHED: string;

beforeAll(async () => {
  HASHED = await bcrypt.hash(PASSWORD, 4); // 低轮数加速测试，compare 兼容
});

function makeMember(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    id: 1,
    username: 'alice',
    phone: '13800138000',
    email: 'alice@example.com',
    password: HASHED,
    nickname: '爱丽丝',
    avatar: null,
    gender: null,
    birthday: null,
    status: 'active',
    levelId: 1,
    growthValue: 0,
    experience: 0,
    registerSource: 'web',
    registerIp: null,
    lastLoginAt: null,
    lastLoginIp: null,
    remark: null,
    tenantId: null,
    createdAt: new Date('2026-07-01T00:00:00'),
    updatedAt: new Date('2026-07-01T00:00:00'),
    ...overrides,
  } as MemberRow;
}

const REQ = { ip: '203.0.113.9', ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0' };

beforeEach(() => {
  vi.resetAllMocks();
  smsMock.mockResolvedValue(true);
  vi.mocked(generateMemberTokenId).mockReturnValue('mock-member-token-id');
  vi.mocked(registerMemberSession).mockResolvedValue(undefined);
  dbMock.transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));
  // 默认：任意 insert/update 返回空结果链（登录日志等 fire-and-forget 写入）
  dbMock.insert.mockImplementation(() => createChain([]));
  dbMock.update.mockImplementation(() => createChain([]));
});

// ─── issueMemberTokens ────────────────────────────────────────────────────────
describe('issueMemberTokens', () => {
  it('access token 带 type=member + jti；refresh token 带 type=member-refresh', async () => {
    const { accessToken, refreshToken, tokenId } = await issueMemberTokens({ id: 8, identifier: '13800138000' });

    expect(tokenId).toBe('mock-member-token-id');
    const access = await verifyToken<{ memberId: number; type: string; jti: string }>(accessToken);
    expect(access).toMatchObject({ memberId: 8, type: 'member', jti: 'mock-member-token-id' });
    const refresh = await verifyToken<{ type: string }>(refreshToken);
    expect(refresh.type).toBe('member-refresh');
  });
});

// ─── loginMember - 密码模式 ───────────────────────────────────────────────────
describe('loginMember - 账号密码', () => {
  const input = { loginType: 'password' as const, account: 'alice', password: PASSWORD, ...REQ };

  it('缺少账号或密码 → 400', async () => {
    await expect(loginMember({ ...input, account: '' })).rejects.toMatchObject({ status: 400 });
    await expect(loginMember({ ...input, password: '' })).rejects.toMatchObject({ status: 400 });
  });

  it('账号不存在 → 400 模糊报错（防账号枚举）并记失败日志', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));
    await expect(loginMember(input)).rejects.toMatchObject({ status: 400, message: '账号或密码错误' });
    expect(dbMock.insert).toHaveBeenCalled(); // 失败登录日志
  });

  it('短信注册用户（无密码）用密码登录 → 400 同样模糊报错', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMember({ password: null })]));
    await expect(loginMember(input)).rejects.toMatchObject({ status: 400, message: '账号或密码错误' });
  });

  it('密码错误 → 400', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMember()]));
    await expect(loginMember({ ...input, password: 'wrong-password' })).rejects.toMatchObject({
      status: 400,
      message: '账号或密码错误',
    });
  });

  it('密码错误时累计账号失败次数（防爆破）', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMember()]));
    await expect(loginMember({ ...input, password: 'wrong-password' })).rejects.toMatchObject({ status: 400 });
    expect(recordMemberLoginFailure).toHaveBeenCalledWith('alice');
  });

  it('账号已被锁定 → 423，短路不再查询会员', async () => {
    vi.mocked(checkMemberLoginLock).mockResolvedValueOnce(120);
    await expect(loginMember(input)).rejects.toMatchObject({ status: 423 });
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('封禁账号 → 403 账号已被封禁', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMember({ status: 'banned' })]));
    await expect(loginMember(input)).rejects.toMatchObject({ status: 403, message: '账号已被封禁' });
  });

  it('未激活账号 → 403', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMember({ status: 'inactive' })]));
    await expect(loginMember(input)).rejects.toMatchObject({ status: 403 });
  });

  it('登录成功：返回会员信息 + 双 token，注册会话并更新最后登录', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMember()]));
    const updateChain = createChain([]);
    dbMock.update.mockReturnValueOnce(updateChain);

    const result = await loginMember(input);

    expect(result.member.id).toBe(1);
    expect(result.member).not.toHaveProperty('password'); // 密码不外泄
    const payload = await verifyToken<{ memberId: number; type: string }>(result.token.accessToken);
    expect(payload).toMatchObject({ memberId: 1, type: 'member' });
    expect(registerMemberSession).toHaveBeenCalledWith(
      expect.objectContaining({ tokenId: 'mock-member-token-id', memberId: 1, ip: REQ.ip }),
    );
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastLoginIp: REQ.ip, lastLoginAt: expect.any(Date) }),
    );
  });
});

// ─── loginMember - 短信模式 ───────────────────────────────────────────────────
describe('loginMember - 短信验证码', () => {
  const input = { loginType: 'sms' as const, phone: '13800138000', smsCode: '123456', ...REQ };

  it('缺少手机号或验证码 → 400', async () => {
    await expect(loginMember({ ...input, smsCode: '' })).rejects.toMatchObject({ status: 400 });
  });

  it('验证码错误 → 400 并记失败日志', async () => {
    smsMock.mockResolvedValueOnce(false);
    await expect(loginMember(input)).rejects.toMatchObject({ status: 400, message: '验证码错误或已过期' });
    expect(smsMock).toHaveBeenCalledWith('13800138000', 'login', '123456');
  });

  it('手机号未注册 → 400', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));
    await expect(loginMember(input)).rejects.toMatchObject({ status: 400, message: '该手机号未注册' });
  });

  it('验证码正确 → 登录成功（无需密码）', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMember({ password: null })]));
    const result = await loginMember(input);
    expect(result.member.id).toBe(1);
    expect(result.token.accessToken).toBeTruthy();
  });
});

// ─── refreshMemberToken ───────────────────────────────────────────────────────
describe('refreshMemberToken', () => {
  it('非法 token 字符串 → 401', async () => {
    await expect(refreshMemberToken('garbage')).rejects.toMatchObject({ status: 401, message: '无效的刷新令牌' });
  });

  it('access token 冒充 refresh token（type=member）→ 401', async () => {
    const { accessToken } = await issueMemberTokens({ id: 1, identifier: 'alice' });
    await expect(refreshMemberToken(accessToken)).rejects.toMatchObject({ status: 401 });
  });

  it('会员已被删除 → 401', async () => {
    const { refreshToken } = await issueMemberTokens({ id: 1, identifier: 'alice' });
    dbMock.select.mockReturnValueOnce(createChain([]));
    await expect(refreshMemberToken(refreshToken)).rejects.toMatchObject({ status: 401, message: '会员不存在' });
  });

  it('会员被封禁 → 403 拒绝续签', async () => {
    const { refreshToken } = await issueMemberTokens({ id: 1, identifier: 'alice' });
    dbMock.select.mockReturnValueOnce(createChain([makeMember({ status: 'banned' })]));
    await expect(refreshMemberToken(refreshToken)).rejects.toMatchObject({ status: 403 });
  });

  it('合法 refresh → 签发新 access token（type=member，继承 jti）', async () => {
    const { refreshToken } = await issueMemberTokens({ id: 1, identifier: 'alice' });
    dbMock.select.mockReturnValueOnce(createChain([makeMember()]));

    const { accessToken } = await refreshMemberToken(refreshToken);

    const payload = await verifyToken<{ memberId: number; type: string; jti: string }>(accessToken);
    expect(payload).toMatchObject({ memberId: 1, type: 'member', jti: 'mock-member-token-id' });
  });
});

// ─── registerMember ───────────────────────────────────────────────────────────
describe('registerMember', () => {
  const base = { ...REQ, source: 'web' };

  it('无密码且无（手机号+验证码）→ 400', async () => {
    await expect(registerMember({ ...base, username: 'bob' })).rejects.toMatchObject({
      status: 400,
      message: '请设置密码，或使用手机验证码注册',
    });
  });

  it('手机号注册验证码错误 → 400', async () => {
    smsMock.mockResolvedValueOnce(false);
    await expect(registerMember({ ...base, phone: '13900139000', smsCode: '000000' })).rejects.toMatchObject({
      status: 400,
      message: '验证码错误或已过期',
    });
    expect(smsMock).toHaveBeenCalledWith('13900139000', 'register', '000000');
  });

  it('用户名已被注册 → 400', async () => {
    dbMock.select.mockReturnValueOnce(createChain([{ id: 99 }]));
    await expect(registerMember({ ...base, username: 'alice', password: PASSWORD })).rejects.toMatchObject({
      status: 400,
      message: '用户名已被注册',
    });
  });

  it('成功注册：密码 bcrypt 落库，事务内初始化积分 + 钱包账户', async () => {
    const created = makeMember({ id: 20, username: 'bob', phone: null, email: null });
    dbMock.select
      .mockReturnValueOnce(createChain([]))          // username 可用
      .mockReturnValueOnce(createChain([{ id: 3 }])); // 默认等级
    const memberInsert = createChain([created]);
    const pointsInsert = createChain([]);
    const walletInsert = createChain([]);
    dbMock.insert
      .mockReturnValueOnce(memberInsert)
      .mockReturnValueOnce(pointsInsert)
      .mockReturnValueOnce(walletInsert);

    const result = await registerMember({ ...base, username: 'bob', password: PASSWORD });

    const inserted = memberInsert.values.mock.calls[0][0];
    expect(inserted.username).toBe('bob');
    expect(inserted.levelId).toBe(3);
    expect(inserted.registerIp).toBe(REQ.ip);
    expect(inserted.password).not.toBe(PASSWORD); // 绝不明文落库
    expect(await bcrypt.compare(PASSWORD, inserted.password)).toBe(true);
    expect(pointsInsert.values).toHaveBeenCalledWith({ memberId: 20 });
    expect(walletInsert.values).toHaveBeenCalledWith({ memberId: 20 });
    expect(result.token.accessToken).toBeTruthy();
    // 服务端权威事件：仅在事务成功后触发，且不落 phone/email 原值
    expect(trackServerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'member.registered',
        memberId: 20,
        properties: expect.objectContaining({ memberId: 20, hasPhone: false, hasEmail: false }),
      }),
    );
    const props = trackServerEventMock.mock.calls[0][0].properties as Record<string, unknown>;
    expect(JSON.stringify(props)).not.toMatch(/13900139000|@example\.com/);
  });

  it('并发注册撞唯一约束 → 400 统一提示', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([]))
      .mockReturnValueOnce(createChain([{ id: 3 }]));
    dbMock.insert.mockReturnValueOnce(createChain(() => Promise.reject({ cause: { code: '23505' } })));

    await expect(registerMember({ ...base, username: 'bob', password: PASSWORD })).rejects.toMatchObject({
      status: 400,
      message: '用户名、手机号或邮箱已被注册',
    });
    expect(trackServerEventMock).not.toHaveBeenCalled();
  });

  it('昵称缺省时按 手机号 > 用户名 > 邮箱前缀 兜底', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([]))
      .mockReturnValueOnce(createChain([{ id: 3 }]));
    const memberInsert = createChain([makeMember({ id: 21 })]);
    dbMock.insert.mockReturnValueOnce(memberInsert);

    await registerMember({ ...base, email: 'carol@example.com', password: PASSWORD });

    expect(memberInsert.values.mock.calls[0][0].nickname).toBe('carol');
  });
});

// ─── 密码管理 ─────────────────────────────────────────────────────────────────
describe('changeMyMemberPassword', () => {
  beforeEach(() => {
    currentMemberMock.mockReturnValue({ memberId: 1, identifier: 'alice', type: 'member', tenantId: null, jti: 'j1' });
  });

  it('已设密码时未提供原密码 → 400', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMember()]));
    await expect(changeMyMemberPassword({ newPassword: 'NewP@ss123' })).rejects.toMatchObject({
      status: 400,
      message: '请输入原密码',
    });
  });

  it('原密码错误 → 400', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMember()]));
    await expect(
      changeMyMemberPassword({ oldPassword: 'wrong', newPassword: 'NewP@ss123' }),
    ).rejects.toMatchObject({ status: 400, message: '原密码错误' });
  });

  it('原密码正确 → 更新为新密码 bcrypt 哈希', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMember()]));
    const updateChain = createChain([]);
    dbMock.update.mockReturnValueOnce(updateChain);

    await changeMyMemberPassword({ oldPassword: PASSWORD, newPassword: 'NewP@ss123' });

    const patch = updateChain.set.mock.calls[0][0];
    expect(await bcrypt.compare('NewP@ss123', patch.password)).toBe(true);
  });

  it('短信注册用户首次设密码无需原密码', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMember({ password: null })]));
    const updateChain = createChain([]);
    dbMock.update.mockReturnValueOnce(updateChain);

    await changeMyMemberPassword({ newPassword: 'FirstP@ss1' });

    expect(updateChain.set).toHaveBeenCalled();
  });
});

describe('resetMemberPassword', () => {
  const input = { phone: '13800138000', smsCode: '123456', newPassword: 'ResetP@ss1' };

  it('验证码错误 → 400', async () => {
    smsMock.mockResolvedValueOnce(false);
    await expect(resetMemberPassword(input)).rejects.toMatchObject({ status: 400 });
  });

  it('手机号未注册 → 400', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));
    await expect(resetMemberPassword(input)).rejects.toMatchObject({ status: 400, message: '该手机号未注册' });
  });

  it('重置成功 → 更新密码并强制下线该会员所有会话', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMember()]));
    const updateChain = createChain([]);
    dbMock.update.mockReturnValueOnce(updateChain);

    await resetMemberPassword(input);

    expect(smsMock).toHaveBeenCalledWith('13800138000', 'reset', '123456');
    expect(await bcrypt.compare('ResetP@ss1', updateChain.set.mock.calls[0][0].password)).toBe(true);
    expect(forceLogoutAllByMember).toHaveBeenCalledWith(1); // 防旧会话继续有效
  });
});

describe('logoutMember', () => {
  it('携带 jti → 移除对应会话', async () => {
    currentMemberMock.mockReturnValue({ memberId: 1, identifier: 'alice', type: 'member', tenantId: null, jti: 'jti-9' });
    await logoutMember();
    expect(removeMemberSession).toHaveBeenCalledWith('jti-9');
  });

  it('无 jti（历史 token）→ 静默成功', async () => {
    currentMemberMock.mockReturnValue({ memberId: 1, identifier: 'alice', type: 'member', tenantId: null });
    await logoutMember();
    expect(removeMemberSession).not.toHaveBeenCalled();
  });
});

// ─── updateMyMemberProfile：服务端权威事件（仅传变更字段名，不落 PII）──────────
describe('updateMyMemberProfile', () => {
  beforeEach(() => {
    currentMemberMock.mockReturnValue({ memberId: 1, identifier: 'alice', type: 'member', tenantId: 2, jti: 'j1' });
    dbMock.query.members.findFirst.mockResolvedValue({
      ...makeMember(),
      level: { name: '普通会员' },
      pointAccount: { balance: 10 },
      wallet: { balance: 0 },
    });
  });

  it('有变更字段 → 更新成功后触发 member.profile.updated，仅含字段名不含值', async () => {
    const updateChain = createChain([]);
    dbMock.update.mockReturnValueOnce(updateChain);

    await updateMyMemberProfile({ nickname: '新昵称', email: 'new@example.com' });

    expect(trackServerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'member.profile.updated',
        memberId: 1,
        tenantId: 2,
        properties: { memberId: 1, changedFields: ['nickname', 'email'] },
      }),
    );
    const props = trackServerEventMock.mock.calls[0][0].properties as Record<string, unknown>;
    expect(JSON.stringify(props)).not.toMatch(/新昵称|new@example\.com/);
  });

  it('无任何变更字段 → 不触发事件（无实际更新）', async () => {
    await updateMyMemberProfile({});
    expect(dbMock.update).not.toHaveBeenCalled();
    expect(trackServerEventMock).not.toHaveBeenCalled();
  });

  it('更新失败（唯一约束冲突）→ 不触发事件', async () => {
    dbMock.update.mockReturnValueOnce(createChain(() => Promise.reject({ cause: { code: '23505' } })));
    await expect(updateMyMemberProfile({ email: 'dup@example.com' })).rejects.toMatchObject({ status: 400 });
    expect(trackServerEventMock).not.toHaveBeenCalled();
  });
});
