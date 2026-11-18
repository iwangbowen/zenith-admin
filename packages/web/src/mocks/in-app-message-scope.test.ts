import { afterEach, describe, expect, it } from 'vitest';
import { inAppMessageContract } from '@zenith/shared/messaging';
import type { AnyOperation } from '@zenith/shared/core';
import { mockInAppMessages } from './data/in-app-messages';
import { inAppMessagesHandlers } from './handlers/in-app-messages';
import { mockAccessToken } from './utils/auth';

const original = structuredClone(mockInAppMessages);
afterEach(() => { mockInAppMessages.splice(0, mockInAppMessages.length, ...structuredClone(original)); });

async function call(operation: AnyOperation, query: string, body?: object) {
  const request = new Request(new URL(operation.fullPath + query, window.location.origin), { method: operation.method.toUpperCase(), headers: { authorization: `Bearer ${mockAccessToken('admin')}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  for (const handler of inAppMessagesHandlers) {
    const result = await (handler as unknown as { run(input: object): Promise<{ response?: Response }> }).run({ request, requestId: crypto.randomUUID() });
    if (result?.response) return result.response.json();
  }
  throw new Error('No matching notification handler');
}

describe('Demo notification event scope', () => {
  it('filters before pagination and leaves non-workflow and foreign recipients unread', async () => {
    const base = original[0];
    mockInAppMessages.splice(0, mockInAppMessages.length,
      ...Array.from({ length: 23 }, (_, index) => ({ ...base, id: index + 1, userId: 1, eventKey: 'workflow.task.created', isRead: false })),
      { ...base, id: 100, eventKey: 'ops.monitor.alert', title: '审批通知', link: '/workflow/pending', isRead: false },
      { ...base, id: 101, userId: 999, eventKey: 'workflow.task.created', isRead: false });
    const first = await call(inAppMessageContract.list, '?eventGroup=workflow&page=1&pageSize=20');
    const second = await call(inAppMessageContract.list, '?eventGroup=workflow&page=2&pageSize=20');
    expect(first.data.total).toBe(23); expect(first.data.list).toHaveLength(20); expect(second.data.list).toHaveLength(3);
    expect((await call(inAppMessageContract.unreadCount, '?eventGroup=workflow')).data.count).toBe(23);
    expect((await call(inAppMessageContract.markAllRead, '', { eventGroup: 'workflow' })).data.count).toBe(23);
    expect((await call(inAppMessageContract.unreadCount, '?eventGroup=workflow')).data.count).toBe(0);
    expect(mockInAppMessages.slice(-2).every(message => !message.isRead)).toBe(true);
  });
});
