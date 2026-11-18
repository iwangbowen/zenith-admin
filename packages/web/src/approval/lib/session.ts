import { ACCOUNT_SWITCH_BROADCAST_KEY, REFRESH_TOKEN_KEY, TOKEN_KEY } from '@zenith/shared/core';
import type { AuthTokens } from '@zenith/shared/identity';
import { scopedStorageKey } from '@/utils/storage';
import { approvalQueryClient } from './query-client';

const listeners = new Set<() => void>();
let generation = 0;

/** JWT claims only partition local state; /me remains the authenticated identity authority. */
export function approvalSessionIdentity(token = localStorage.getItem(TOKEN_KEY)): string {
  if (!token) return 'anonymous';
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(encoded)) as Record<string, unknown>;
    return JSON.stringify([p.userId, p.tenantId, p.viewingTenantId, p.impersonation]);
  } catch { return token; }
}

export function approvalSessionScope(): string {
  return `${generation}:${approvalSessionIdentity()}`;
}

function reset() {
  generation++;
  void approvalQueryClient.cancelQueries();
  approvalQueryClient.clear();
  for (const listener of listeners) listener();
}

export function activateApprovalSession(token: AuthTokens): void {
  localStorage.setItem(TOKEN_KEY, token.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, token.refreshToken);
  reset();
}

export function clearApprovalSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  reset();
}

export function subscribeApprovalSession(listener: () => void) {
  listeners.add(listener);
  let identity = approvalSessionIdentity();
  const onStorage = (event: StorageEvent) => {
    if (event.key === scopedStorageKey(ACCOUNT_SWITCH_BROADCAST_KEY)
      || (event.key === scopedStorageKey(TOKEN_KEY) && approvalSessionIdentity() !== identity)) {
      identity = approvalSessionIdentity();
      reset();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

/** Only in-app hash routes may be restored after authentication. */
export function approvalReturnTo(value: unknown): string {
  return typeof value === 'string' && /^\/(?:$|(?:detail|draft|launch)(?:\/[1-9]\d*){0,2}(?:\?.*)?$)/.test(value) ? value : '/';
}
