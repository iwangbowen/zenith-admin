/**
 * 会员前台（C 端）体验分析（埋点）同意状态管理。
 *
 * - 状态持久化在 localStorage（key: MEMBER_ANALYTICS_CONSENT_KEY），带版本号；
 *   版本号变化（如隐私政策调整）会使历史同意状态失效，重新回到 unknown。
 * - 保存时间统一使用项目 dayjs 工具 formatDateTimeForApi，禁止 toISOString。
 * - 提供同步读取函数 hasMemberAnalyticsConsent() 给 tracker/error-reporter 等非 React 代码使用，
 *   以及 useAnalyticsConsent() React hook 给 UI（基于 useSyncExternalStore，跨标签页/组件保持同步）。
 */
import { useCallback, useSyncExternalStore } from 'react';
import { MEMBER_ANALYTICS_CONSENT_KEY, MEMBER_ANALYTICS_CONSENT_VERSION } from '@zenith/shared/member';
import { reloadTrackerConfig } from '@/utils/tracker';
import { formatDateTimeForApi } from '@/utils/date';
import { scopedStorageKey } from '@/utils/storage';

export type MemberAnalyticsConsentStatus = 'unknown' | 'accepted' | 'rejected';

interface ConsentRecord {
  status: 'accepted' | 'rejected';
  version: number;
  updatedAt: string;
}

const listeners = new Set<() => void>();

function readRecord(): ConsentRecord | null {
  try {
    const raw = localStorage.getItem(MEMBER_ANALYTICS_CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentRecord>;
    if (parsed.version !== MEMBER_ANALYTICS_CONSENT_VERSION) return null;
    if (parsed.status !== 'accepted' && parsed.status !== 'rejected') return null;
    return { status: parsed.status, version: parsed.version, updatedAt: parsed.updatedAt ?? '' };
  } catch {
    return null;
  }
}

function getSnapshot(): MemberAnalyticsConsentStatus {
  return readRecord()?.status ?? 'unknown';
}

function getServerSnapshot(): MemberAnalyticsConsentStatus {
  return 'unknown';
}

function emitChange(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === scopedStorageKey(MEMBER_ANALYTICS_CONSENT_KEY)) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function persist(status: 'accepted' | 'rejected'): void {
  try {
    const record: ConsentRecord = {
      status,
      version: MEMBER_ANALYTICS_CONSENT_VERSION,
      updatedAt: formatDateTimeForApi(new Date()),
    };
    localStorage.setItem(MEMBER_ANALYTICS_CONSENT_KEY, JSON.stringify(record));
  } catch { /* storage 不可用（隐私模式等），静默忽略 */ }
  emitChange();
  // 同意状态变化立即重放采集配置（含会话回放启停），不等 60s 兜底轮询
  try { reloadTrackerConfig(); } catch { /* SDK 未初始化时忽略 */ }
}

/** 同步读取当前是否已同意采集（供 tracker/error-reporter 的 consentProvider 使用）。 */
export function hasMemberAnalyticsConsent(): boolean {
  return getSnapshot() === 'accepted';
}

/** React hook：读取 + 修改会员体验分析同意状态，跨组件/标签页保持同步。 */
export function useAnalyticsConsent(): {
  status: MemberAnalyticsConsentStatus;
  accept: () => void;
  reject: () => void;
} {
  const status = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const accept = useCallback(() => persist('accepted'), []);
  const reject = useCallback(() => persist('rejected'), []);
  return { status, accept, reject };
}
