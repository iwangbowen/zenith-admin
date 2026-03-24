import crypto from 'node:crypto';
import redis from './redis';

export interface SessionInfo {
  tokenId: string;
  userId: number;
  username: string;
  nickname: string;
  ip: string;
  browser: string;
  os: string;
  loginAt: Date;
  lastActiveAt: Date;
}

/** Session TTL: 8 hours (seconds) */
const SESSION_TTL = 8 * 60 * 60;

/** Blacklist TTL: 2 hours (matches accessToken lifetime, seconds) */
const BLACKLIST_TTL = 2 * 60 * 60;

const SESSION_PREFIX = 'session:';
const BLACKLIST_PREFIX = 'blacklist:';

/** Generate a unique token ID */
export function generateTokenId(): string {
  return crypto.randomUUID();
}

/** Register a new session on login */
export async function registerSession(info: Omit<SessionInfo, 'lastActiveAt'>): Promise<void> {
  const session: SessionInfo = { ...info, lastActiveAt: new Date() };
  await redis.set(
    `${SESSION_PREFIX}${info.tokenId}`,
    JSON.stringify(session),
    'EX',
    SESSION_TTL,
  );
}

/** Refresh session activity timestamp and reset TTL */
export async function touchSession(tokenId: string): Promise<void> {
  const key = `${SESSION_PREFIX}${tokenId}`;
  const raw = await redis.get(key);
  if (!raw) return;
  const session: SessionInfo = JSON.parse(raw);
  session.lastActiveAt = new Date();
  await redis.set(key, JSON.stringify(session), 'EX', SESSION_TTL);
}

/** Check if a token is blacklisted */
export async function isTokenBlacklisted(tokenId: string): Promise<boolean> {
  const result = await redis.exists(`${BLACKLIST_PREFIX}${tokenId}`);
  return result === 1;
}

/** Force logout a session by tokenId */
export async function forceLogout(tokenId: string): Promise<boolean> {
  const key = `${SESSION_PREFIX}${tokenId}`;
  const raw = await redis.get(key);
  if (!raw) return false;
  await Promise.all([
    redis.set(`${BLACKLIST_PREFIX}${tokenId}`, '1', 'EX', BLACKLIST_TTL),
    redis.del(key),
  ]);
  return true;
}

/** Remove session (normal logout or token expired) */
export async function removeSession(tokenId: string): Promise<void> {
  await redis.del(`${SESSION_PREFIX}${tokenId}`);
}

/** Get all online sessions */
export async function getOnlineSessions(): Promise<SessionInfo[]> {
  const keys = await scanKeys(`${SESSION_PREFIX}*`);
  if (keys.length === 0) return [];
  const values = await redis.mget(...keys);
  return values
    .filter((v): v is string => v !== null)
    .map((v) => {
      const s = JSON.parse(v) as SessionInfo;
      // Parse date strings back to Date objects
      s.loginAt = new Date(s.loginAt);
      s.lastActiveAt = new Date(s.lastActiveAt);
      return s;
    })
    .sort((a, b) => b.loginAt.getTime() - a.loginAt.getTime());
}

/** Get online session count */
export async function getOnlineCount(): Promise<number> {
  const keys = await scanKeys(`${SESSION_PREFIX}*`);
  return keys.length;
}

/**
 * Clean expired sessions.
 * Redis TTL handles expiry automatically; this function is a no-op retained for interface compatibility.
 */
export async function cleanExpiredSessions(): Promise<number> {
  // Redis automatically removes keys past their TTL — nothing to do here
  return 0;
}

/** Scan all keys matching a pattern using SCAN (safe for production) */
async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}
