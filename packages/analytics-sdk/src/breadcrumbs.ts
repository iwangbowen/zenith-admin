/**
 * 行为面包屑环形缓冲：记录用户报错前的最近若干操作（导航/点击/网络/控制台），
 * 供错误上报时还原现场。
 */
import type { ErrorBreadcrumb } from '@zenith/shared';

const MAX_BREADCRUMBS = 30;
const buffer: ErrorBreadcrumb[] = [];

export function addBreadcrumb(b: Omit<ErrorBreadcrumb, 'timestamp'> & { timestamp?: string }): void {
  buffer.push({ ...b, timestamp: b.timestamp ?? new Date().toISOString() });
  if (buffer.length > MAX_BREADCRUMBS) buffer.shift();
}

export function getBreadcrumbs(): ErrorBreadcrumb[] {
  return [...buffer];
}

export function clearBreadcrumbs(): void {
  buffer.length = 0;
}
