import type { TimelineEvent } from '@zenith/shared/core';

export const mockIotBusinessEvents: TimelineEvent[] = [];
let observer: ((event: TimelineEvent) => void) | undefined;
export function registerMockWatchObserver(callback: (event: TimelineEvent) => void) { observer = callback; }
export function publishMockWatchEvent(event: TimelineEvent) { observer?.(event); }
export function recordMockIotEvent(event: TimelineEvent) {
  if (mockIotBusinessEvents.some((item) => item.id === event.id)) return;
  mockIotBusinessEvents.push(event);
  publishMockWatchEvent(event);
}
