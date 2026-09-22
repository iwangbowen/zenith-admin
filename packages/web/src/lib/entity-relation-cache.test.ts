import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryObserver } from '@tanstack/react-query';
import type { WsMessage } from '@zenith/shared/platform';
import { createTestQueryClient } from '@/test-utils/query-harness';
import { createEntityRelationEventHandler, ENTITY_RELATION_QUERY_META } from './entity-relation-cache';

afterEach(() => vi.useRealTimers());

describe('relation realtime refresh', () => {
  it('coalesces workflow and notification pushes, refreshing active data and marking reverse caches stale', async () => {
    const client = createTestQueryClient();
    let revision = 1;
    const options = { queryKey: ['relations', 'visible'], queryFn: async () => revision, meta: ENTITY_RELATION_QUERY_META };
    await client.fetchQuery(options);
    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => undefined);
    client.setQueryDefaults(['relations', 'reverse'], { meta: ENTITY_RELATION_QUERY_META });
    client.setQueryData(['relations', 'reverse'], 1);
    client.setQueryData(['unrelated'], 1);
    const events = createEntityRelationEventHandler(client);
    vi.useFakeTimers();
    revision = 2;
    events.onMessage({ type: 'workflow:taskFinished', payload: { instanceId: 7, taskId: 3, decision: 'approved' } });
    events.onMessage({ type: 'workflow:instanceFinished', payload: { instanceId: 7, status: 'approved', title: '审批' } });
    events.onMessage({ type: 'in-app-message:new', payload: { id: 4, title: '审批结束通知' } } as Extract<WsMessage, { type: 'in-app-message:new' }>);
    expect(client.getQueryData(options.queryKey)).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(client.getQueryData(options.queryKey)).toBe(2);
    expect(client.getQueryState(['relations', 'reverse'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['unrelated'])?.isInvalidated).toBe(false);
    unsubscribe(); events.dispose(); client.clear();
  });

  it('ignores repeated task progress but reacts to state transitions and reconnects', async () => {
    const client = createTestQueryClient();
    const key = ['relations'];
    client.setQueryDefaults(key, { meta: ENTITY_RELATION_QUERY_META });
    const events = createEntityRelationEventHandler(client);
    const progress = (status: 'running' | 'completed', processedCount: number) => ({
      type: 'task:progress', payload: { id: 9, title: '同步', status, processedCount },
    }) as Extract<WsMessage, { type: 'task:progress' }>;
    vi.useFakeTimers();
    client.setQueryData(key, 1);
    events.onMessage(progress('running', 1));
    await vi.advanceTimersByTimeAsync(200);
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.setQueryData(key, 2);
    events.onMessage(progress('running', 2));
    await vi.advanceTimersByTimeAsync(200);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    events.onMessage(progress('completed', 3));
    await vi.advanceTimersByTimeAsync(200);
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.setQueryData(key, 3);
    events.reconnect();
    await vi.advanceTimersByTimeAsync(200);
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    events.dispose(); client.clear();
  });

  it('does not schedule relation reads for telemetry and cancels queued work on disposal', async () => {
    const client = createTestQueryClient();
    client.setQueryDefaults(['relations'], { meta: ENTITY_RELATION_QUERY_META });
    client.setQueryData(['relations'], 1);
    const events = createEntityRelationEventHandler(client);
    vi.useFakeTimers();
    events.onMessage({ type: 'iot:telemetry', payload: { deviceId: 1, metrics: { temperature: 30 }, reportedAt: '' } });
    await vi.advanceTimersByTimeAsync(200);
    expect(client.getQueryState(['relations'])?.isInvalidated).toBe(false);
    events.reconnect(); events.dispose();
    await vi.advanceTimersByTimeAsync(200);
    expect(client.getQueryState(['relations'])?.isInvalidated).toBe(false);
    client.clear();
  });
});
