import type { SettingsOf } from '@zenith/shared/settings';
import redis from './redis';

/**
 * 登录失败防护守卫（管理员与会员共用同一套算法，键前缀隔离）。
 *
 * 目标：既挡住密码猜解，又不给攻击者「用别人的用户名锁死别人」的能力。
 *
 * - 失败计数按「账号 × 来源 IP」拆分：达阈值只让失败的那个来源过验证码，
 *   真正的用户从自己的出口登录不受影响（旧实现把计数挂在账号上，任意 IP 刷失败即可锁死账号）；
 * - 窗口内失败来源 IP 数达到 sourceLimit（疑似分布式猜解）才要求整个账号过验证码；
 * - 任何情况下都不锁定账号，凭正确密码 + 验证码始终可以登录；
 * - 全部状态带窗口 TTL，窗口内不再失败即自动恢复。
 */

export type LoginChallengePolicy = SettingsOf<'identitySecurity'>['loginChallenge'];

export interface LoginChallengeGuard {
  /** 当前登录是否需要先通过验证码 */
  check(username: string, ip: string): Promise<boolean>;
  /**
   * 只判断「这个来源」是否已进入防护（忽略账号级标记）。
   * 供没有验证码环节的登录路径（企业 LDAP）做来源级节流：只挡失败的那个来源，不影响真正的用户。
   */
  isSourceChallenged(username: string, ip: string): Promise<boolean>;
  /** 记录一次失败，返回剩余可用次数（<= 0 表示已进入验证码防护） */
  recordFailure(username: string, ip: string, policy: LoginChallengePolicy): Promise<number>;
  /** 登录成功：清除该来源的计数与来源级验证码要求 */
  clear(username: string, ip: string): Promise<void>;
  /** 批量检查多个账号当前是否要求验证码（用户列表用） */
  batchRequired(usernames: string[]): Promise<Set<string>>;
  /** 管理员清除账号的全部失败防护状态 */
  clearAll(username: string): Promise<void>;
}

/** 账号级挑战标记：集合里出现该成员表示「所有来源都需验证码」 */
const ALL_SOURCES_MARK = '*';

export function createLoginChallengeGuard(prefix: string): LoginChallengeGuard {
  /** {username}|{ip} → 失败计数 */
  const attemptKey = `${prefix}attempt:`;
  /** {username} → ZSET<ip, 最后失败时间> */
  const sourcesKey = `${prefix}sources:`;
  /** {username} → SET<ip | '*'>，需要验证码的来源 */
  const challengeKey = `${prefix}challenge:`;

  function check(username: string, ip: string): Promise<boolean> {
    return redis.smembers(`${challengeKey}${username}`).then(
      (challenged) => challenged.includes(ALL_SOURCES_MARK) || challenged.includes(ip),
    );
  }

  function isSourceChallenged(username: string, ip: string): Promise<boolean> {
    return redis.sismember(`${challengeKey}${username}`, ip).then((hit) => hit === 1);
  }

  async function recordFailure(username: string, ip: string, policy: LoginChallengePolicy): Promise<number> {
    const { maxAttemptsPerSource, sourceLimit, windowMinutes } = policy;
    const windowSeconds = windowMinutes * 60;
    const key = `${attemptKey}${username}|${ip}`;
    const count = await redis.incr(key);
    // 首次失败时设置窗口 TTL，避免计数永久累积
    if (count === 1) await redis.expire(key, windowSeconds);

    const sources = `${sourcesKey}${username}`;
    const now = Date.now();
    await redis.zadd(sources, String(now), ip);
    await redis.zremrangebyscore(sources, '-inf', String(now - windowSeconds * 1000));
    await redis.expire(sources, windowSeconds);

    const marks: string[] = [];
    if (count >= maxAttemptsPerSource) marks.push(ip);
    if (await redis.zcard(sources) >= sourceLimit) marks.push(ALL_SOURCES_MARK);
    if (marks.length > 0) {
      await redis.sadd(`${challengeKey}${username}`, ...marks);
      await redis.expire(`${challengeKey}${username}`, windowSeconds);
    }
    return Math.max(maxAttemptsPerSource - count, 0);
  }

  async function clear(username: string, ip: string): Promise<void> {
    await Promise.all([
      redis.del(`${attemptKey}${username}|${ip}`),
      redis.srem(`${challengeKey}${username}`, ip),
      redis.zrem(`${sourcesKey}${username}`, ip),
    ]);
  }

  async function batchRequired(usernames: string[]): Promise<Set<string>> {
    if (usernames.length === 0) return new Set();
    const pipeline = redis.pipeline();
    for (const username of usernames) {
      pipeline.exists(`${challengeKey}${username}`);
    }
    const results = await pipeline.exec();
    const required = new Set<string>();
    usernames.forEach((username, i) => {
      const [err, hit] = results?.[i] ?? [null, 0];
      if (!err && Number(hit) > 0) required.add(username);
    });
    return required;
  }

  async function clearAll(username: string): Promise<void> {
    const sources = await redis.zrange(`${sourcesKey}${username}`, '0', '-1');
    await Promise.all([
      ...sources.map((ip) => redis.del(`${attemptKey}${username}|${ip}`)),
      redis.del(`${sourcesKey}${username}`),
      redis.del(`${challengeKey}${username}`),
    ]);
  }

  return { check, isSourceChallenged, recordFailure, clear, batchRequired, clearAll };
}
