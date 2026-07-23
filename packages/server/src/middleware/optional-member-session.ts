import { createMiddleware } from 'hono/factory';
import { jwt } from 'hono/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db';
import { members } from '../db/schema';
import {
  getMemberSession,
  isMemberTokenBlacklisted,
  touchMemberSession,
} from '../lib/member-session-manager';
import type { MemberJwtPayload } from './member-auth';
import type { AuthEnv } from './auth';

const jwtMiddleware = jwt({
  secret: config.jwtSecret,
  alg: 'HS256',
});

/**
 * CMS 公开页面的可选会员会话认证。
 * 任一 JWT、黑名单、Redis 会话或会员状态校验失败都降级为游客，不授予会员受众能力。
 */
export const optionalMemberSessionMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    await next();
    return;
  }
  try {
    await jwtMiddleware(c, async () => {});
    const payload = c.get('jwtPayload') as unknown as MemberJwtPayload | undefined;
    if (payload?.type !== 'member' || !payload.memberId || !payload.jti) {
      await next();
      return;
    }
    const [blacklisted, session] = await Promise.all([
      isMemberTokenBlacklisted(payload.jti),
      getMemberSession(payload.jti),
    ]);
    if (blacklisted || !session || session.memberId !== payload.memberId) {
      await next();
      return;
    }
    const [member] = await db.select({ id: members.id }).from(members).where(and(
      eq(members.id, payload.memberId),
      eq(members.status, 'active'),
      isNull(members.deletedAt),
    )).limit(1);
    if (!member || !(await touchMemberSession(payload.jti))) {
      await next();
      return;
    }
    c.set('member', payload);
  } catch {
    // Optional auth intentionally treats all verification and dependency failures as guest.
  }
  await next();
});
