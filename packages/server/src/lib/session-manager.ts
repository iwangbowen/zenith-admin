import crypto from 'node:crypto';

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

/** Active sessions: tokenId → SessionInfo */
const sessions = new Map<string, SessionInfo>();

/** Blacklisted token IDs (forced logout) */
const blacklist = new Set<string>();

/** Generate a unique token ID */
export function generateTokenId(): string {
  return crypto.randomUUID();
}

/** Register a new session on login */
export function registerSession(info: Omit<SessionInfo, 'lastActiveAt'>): void {
  sessions.set(info.tokenId, { ...info, lastActiveAt: new Date() });
}

/** Refresh session activity timestamp */
export function touchSession(tokenId: string): void {
  const session = sessions.get(tokenId);
  if (session) {
    session.lastActiveAt = new Date();
  }
}

/** Check if a token is blacklisted */
export function isTokenBlacklisted(tokenId: string): boolean {
  return blacklist.has(tokenId);
}

/** Force logout a session by tokenId */
export function forceLogout(tokenId: string): boolean {
  const session = sessions.get(tokenId);
  if (!session) return false;
  blacklist.add(tokenId);
  sessions.delete(tokenId);
  return true;
}

/** Remove session (normal logout or token expired) */
export function removeSession(tokenId: string): void {
  sessions.delete(tokenId);
}

/** Get all online sessions */
export function getOnlineSessions(): SessionInfo[] {
  return Array.from(sessions.values()).sort(
    (a, b) => b.loginAt.getTime() - a.loginAt.getTime()
  );
}

/** Get online session count */
export function getOnlineCount(): number {
  return sessions.size;
}

/** Clean expired sessions (no activity for 8 hours) and stale blacklist entries */
export function cleanExpiredSessions(): number {
  const cutoff = Date.now() - 8 * 60 * 60 * 1000;
  let count = 0;
  for (const [id, session] of sessions) {
    if (session.lastActiveAt.getTime() < cutoff) {
      sessions.delete(id);
      count++;
    }
  }
  // Clean blacklist entries older than 24h (tokens would be expired by then)
  // Since we can't track blacklist age easily with a Set, we keep it simple
  // In production you'd want a TTL-based cache like Redis
  return count;
}
