import { ACCOUNT_SWITCH_BROADCAST_KEY, ACCOUNTS_STORE_KEY, MAX_STORED_ACCOUNTS } from '@zenith/shared/core';

/**
 * 账号切换器的停靠账号仓库（localStorage，本模块是唯一读写方）。
 *
 * 设计约定：
 * - 活跃账号的凭证始终只存在 TOKEN_KEY / REFRESH_TOKEN_KEY 槽位（全站直接读取处零改动）；
 * - 本仓库只保存「非活跃」账号：资料快照 + refreshToken（不落盘 accessToken，
 *   切回时经令牌刷新接口换发，天然校验会话有效性并缩小 XSS 暴露面）；
 * - refresh token 服务端不轮换，停靠期间保持有效，过期则引导重新登录。
 */
export interface StoredAccount {
  userId: number;
  username: string;
  nickname: string;
  avatar?: string;
  tenantName?: string | null;
  refreshToken: string;
  /** 最近一次作为活跃账号的时间（epoch ms），用于排序与容量淘汰 */
  lastUsedAt: number;
}

function isStoredAccount(value: unknown): value is StoredAccount {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.userId === 'number'
    && typeof v.username === 'string'
    && typeof v.nickname === 'string'
    && typeof v.refreshToken === 'string' && v.refreshToken.length > 0
    && typeof v.lastUsedAt === 'number';
}

function readAll(): StoredAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredAccount);
  } catch {
    return [];
  }
}

function writeAll(accounts: StoredAccount[]): void {
  if (accounts.length === 0) {
    localStorage.removeItem(ACCOUNTS_STORE_KEY);
    return;
  }
  localStorage.setItem(ACCOUNTS_STORE_KEY, JSON.stringify(accounts));
}

/** 列出全部停靠账号（按最近使用倒序） */
export function listParkedAccounts(): StoredAccount[] {
  return readAll().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/** 查看指定停靠账号（不移除） */
export function getParkedAccount(userId: number): StoredAccount | null {
  return readAll().find((a) => a.userId === userId) ?? null;
}

/** 停靠一个账号：按 userId 去重，超出容量时淘汰最久未用的（活跃账号占 1 席） */
export function parkAccount(account: StoredAccount): void {
  const rest = readAll().filter((a) => a.userId !== account.userId);
  const next = [account, ...rest].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  writeAll(next.slice(0, MAX_STORED_ACCOUNTS - 1));
}

/** 取出并移除指定停靠账号 */
export function takeParkedAccount(userId: number): StoredAccount | null {
  const all = readAll();
  const found = all.find((a) => a.userId === userId) ?? null;
  if (found) writeAll(all.filter((a) => a.userId !== userId));
  return found;
}

/** 移除指定停靠账号 */
export function removeParkedAccount(userId: number): void {
  const all = readAll();
  const next = all.filter((a) => a.userId !== userId);
  if (next.length !== all.length) writeAll(next);
}

/** 清空停靠区（退出全部账号） */
export function clearParkedAccounts(): void {
  localStorage.removeItem(ACCOUNTS_STORE_KEY);
}

/**
 * 账号切换成功后：广播其他标签页 → 本页整页重载为新账号。
 * 整页重载一次性重置查询缓存、WebSocket、SSE、埋点身份、终端会话等全部内存态，
 * 避免「旧账号界面发新账号请求」的数据串号。
 */
export function broadcastSwitchAndReload(): void {
  try {
    localStorage.setItem(ACCOUNT_SWITCH_BROADCAST_KEY, String(Date.now()));
  } catch { /* 广播失败不阻塞本页重载 */ }
  if (import.meta.env.VITE_ELECTRON === 'true') {
    // Electron 走 HashRouter（file:// 协议），assign('/') 会脱离应用
    globalThis.location.hash = '#/';
    globalThis.location.reload();
  } else {
    globalThis.location.assign(import.meta.env.BASE_URL || '/');
  }
}

/** 其他标签页切换了账号：本页整页重载为新账号，避免旧界面发新账号请求 */
export function reloadForExternalAccountSwitch(): void {
  globalThis.location.reload();
}
