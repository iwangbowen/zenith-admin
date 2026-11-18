import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WsMessage } from '@zenith/shared/platform';
import { createTestQueryClient, createWrapper } from '@/test-utils/query-harness';

const state = vi.hoisted(() => ({ handler: null as null | ((message: WsMessage) => void) }));
vi.mock('@/hooks/useWebSocket', () => ({ subscribeWsStatus: () => () => {}, useWebSocket: (handler: (message: WsMessage) => void) => { state.handler = handler; return { disconnect: vi.fn() }; } }));
vi.mock('@/hooks/usePreferences', () => ({ useOptionalPreferences: () => null }));
vi.mock('@/lib/entity-relation-cache', () => ({ createEntityRelationEventHandler: () => ({ onMessage: vi.fn(), reconnect: vi.fn(), dispose: vi.fn() }) }));
import { useLayoutWs } from './useLayoutWs';

describe('notification read-all websocket scope', () => {
  it('reloads the global inbox after workflow-only read-all instead of clearing unrelated unread notifications', () => {
    const reload = vi.fn(); const setMessages = vi.fn(); const setCount = vi.fn(); const refreshLists = vi.fn();
    const client = createTestQueryClient();
    const hook = renderHook(() => useLayoutWs({ onLogout: vi.fn(), clearLockPassword: vi.fn(), fetchInAppMessages: reload, prependInAppMessage: vi.fn(), refreshInboxLists: refreshLists, applyAnnouncementEvent: vi.fn(), refetchAfterReconnect: vi.fn(), setInAppMessages: setMessages, setUnreadCount: setCount, setChatUnreadCount: vi.fn(), recentInAppMessageRef: { current: new Map() }, userTenantId: null, viewingTenantId: null, navigate: vi.fn() }), { wrapper: createWrapper(client) });
    act(() => state.handler?.({ type: 'in-app-message:read-all', payload: { eventGroup: 'workflow' } }));
    expect(reload).toHaveBeenCalledTimes(1); expect(refreshLists).toHaveBeenCalledTimes(1);
    expect(setMessages).not.toHaveBeenCalled(); expect(setCount).not.toHaveBeenCalled();
    act(() => state.handler?.({ type: 'in-app-message:read-all', payload: {} }));
    expect(setMessages).toHaveBeenCalledTimes(1); expect(setCount).toHaveBeenCalledWith(0);
    hook.unmount(); client.clear();
  });
});
