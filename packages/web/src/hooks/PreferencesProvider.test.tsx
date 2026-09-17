import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BaseDatePicker from '@douyinfe/semi-ui/lib/es/datePicker/datePicker';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper, type RecordedCall } from '@/test-utils/query-harness';
import { authContract } from '@zenith/shared/identity';
import { settingsContract } from '@zenith/shared/settings';
import { preferencePolicySchema, type UserPreferencesDocument } from '@zenith/shared/preferences';
import type { WsMessage } from '@zenith/shared/platform';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));
const websocket = vi.hoisted(() => ({
  message: undefined as ((message: WsMessage) => void) | undefined,
  status: undefined as ((connected: boolean) => void) | undefined,
}));
vi.mock('./useWebSocket', () => ({
  useWebSocket: (handler: (message: WsMessage) => void) => { websocket.message = handler; },
  subscribeWsStatus: (handler: (connected: boolean) => void) => {
    websocket.status = handler;
    return () => { websocket.status = undefined; };
  },
}));

import { PreferencesProvider } from './PreferencesProvider';
import { usePreferences } from './usePreferences';

const base = BaseDatePicker as unknown as { defaultProps: { weekStartsOn: number } };
let policy = preferencePolicySchema.parse({});
let document: UserPreferencesDocument = { overrides: {} };

async function setup() {
  const client = createTestQueryClient();
  const QueryWrapper = createWrapper(client);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryWrapper, null, createElement(PreferencesProvider, null, children));
  const hook = renderHook(() => usePreferences(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return { client, hook };
}

beforeEach(() => {
  api.reset();
  localStorage.clear();
  policy = preferencePolicySchema.parse({});
  document = { overrides: {} };
  api.on('GET', authContract.preferences.fullPath, () => structuredClone(document));
  api.on('GET', settingsContract.me.fullPath, () => ({ ui: { preferences: structuredClone(policy), quickChatEnabled: true } }));
  api.on('PUT', authContract.savePreferences.fullPath, (call: RecordedCall) => {
    document = structuredClone(call.body) as UserPreferencesDocument;
    return document;
  });
  base.defaultProps.weekStartsOn = 0;
});

afterEach(() => {
  cleanup();
  base.defaultProps.weekStartsOn = 0;
});

describe('PreferencesProvider', () => {
  it('applies the week start before the first render and on every change', async () => {
    const { hook } = await setup();
    // 默认周一：Provider 初始化时已同步写入，而不是等 effect
    expect(base.defaultProps.weekStartsOn).toBe(1);
    act(() => hook.result.current.setPreferences({ weekStart: 'sunday' }));
    expect(base.defaultProps.weekStartsOn).toBe(0);
  });

  it('mirrors refetchOnFocus into the QueryClient default options', async () => {
    const { client, hook } = await setup();
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
    act(() => hook.result.current.setPreferences({ refetchOnFocus: true }));
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
    // 其余默认项（staleTime / retry）保持不变
    expect(client.getDefaultOptions().queries?.staleTime).toBe(30_000);
    act(() => hook.result.current.setPreferences({ refetchOnFocus: false }));
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });

  it('persists explicit equal-to-default choices and merges terminal leaf changes', async () => {
    document = { overrides: { terminal: { cursorBlink: false } } };
    const { hook } = await setup();
    act(() => {
      hook.result.current.setPreferences({ colorMode: 'light' });
      hook.result.current.setPreferences({ terminal: { fontSize: 18 } });
    });
    await waitFor(() => expect(api.countOf('PUT', authContract.savePreferences.fullPath)).toBe(1));
    expect(document.overrides).toEqual({ colorMode: 'light', terminal: { fontSize: 18, cursorBlink: false } });
    expect(hook.result.current.isPreferenceOverridden('colorMode')).toBe(true);
    expect(hook.result.current.preferences.terminal.fontSize).toBe(18);
  });

  it('blocks locked values at every setter while preserving dormant personal choices', async () => {
    policy.allowUserOverride.colorMode = false;
    document = { overrides: { colorMode: 'dark' } };
    const { hook } = await setup();
    let change;
    act(() => { change = hook.result.current.setPreferences({ colorMode: 'system', tableStriped: true }); });
    expect(change).toEqual({ applied: 1, skipped: 1 });
    expect(hook.result.current.preferences.colorMode).toBe('light');
    await waitFor(() => expect(api.countOf('PUT', authContract.savePreferences.fullPath)).toBe(1));
    expect(document.overrides).toEqual({ colorMode: 'dark', tableStriped: true });
    policy.allowUserOverride.colorMode = true;
    act(() => websocket.message?.({ type: 'preferences:policy-updated', payload: { version: 2 } }));
    await waitFor(() => expect(hook.result.current.preferences.colorMode).toBe('dark'));
  });

  it('re-fetches policy on websocket updates and reconnect when business auto-refresh is off', async () => {
    const { hook } = await setup();
    expect(hook.result.current.preferences.refetchOnFocus).toBe(false);
    api.resetCalls();
    policy.defaults.tableBordered = false;
    act(() => websocket.message?.({ type: 'preferences:policy-updated', payload: { version: 2 } }));
    await waitFor(() => expect(hook.result.current.preferences.tableBordered).toBe(false));
    expect(api.countOf('GET', settingsContract.me.fullPath)).toBe(1);
    expect(api.countOf('GET', authContract.preferences.fullPath)).toBe(0);
    policy.defaults.tableStriped = true;
    act(() => websocket.status?.(true));
    await waitFor(() => expect(hook.result.current.preferences.tableStriped).toBe(true));
    expect(api.countOf('GET', settingsContract.me.fullPath)).toBe(2);
  });

  it('locks a parent without hiding applicable children until the parent is off', async () => {
    policy.allowUserOverride.enableTabs = false;
    const { hook } = await setup();
    expect(hook.result.current.canEditPreference('enableTabs')).toBe(false);
    expect(hook.result.current.canEditPreference('tabStyle')).toBe(true);
    policy.defaults.enableTabs = false;
    act(() => websocket.message?.({ type: 'preferences:policy-updated', payload: { version: 2 } }));
    await waitFor(() => expect(hook.result.current.canEditPreference('tabStyle')).toBe(false));
    expect(hook.result.current.canOverridePreference('tabStyle')).toBe(true);
  });

  it('hides a mutually exclusive switch when the other mode is forced on', async () => {
    policy.defaults.grayscale = true;
    policy.allowUserOverride.grayscale = false;
    const { hook } = await setup();
    expect(hook.result.current.canEditPreference('grayscale')).toBe(false);
    expect(hook.result.current.canEditPreference('colorBlind')).toBe(false);
  });

  it('keeps a dormant grayscale override when grayscale is forced off and color-blind mode is enabled', async () => {
    policy.allowUserOverride.grayscale = false;
    document = { overrides: { grayscale: true } };
    const { hook } = await setup();
    expect(hook.result.current.canEditPreference('colorBlind')).toBe(true);
    act(() => hook.result.current.setPreferences({ colorBlind: true, grayscale: false }));
    await waitFor(() => expect(api.countOf('PUT')).toBe(1));
    expect(document.overrides).toEqual({ grayscale: true, colorBlind: true });
    expect(hook.result.current.preferences).toMatchObject({ grayscale: false, colorBlind: true });
  });

  it.each([
    { previous: 'grayscale', next: 'colorBlind' },
    { previous: 'colorBlind', next: 'grayscale' },
  ] as const)('turns off editable $previous when only $next is explicitly enabled', async ({ previous, next }) => {
    document = { overrides: { [previous]: true } };
    const { hook } = await setup();
    act(() => hook.result.current.setPreferences({ [next]: true }));
    await waitFor(() => expect(api.countOf('PUT')).toBe(1));
    expect(document.overrides).toEqual({ [previous]: false, [next]: true });
    expect(hook.result.current.preferences).toMatchObject({ [previous]: false, [next]: true });
  });

  it.each([
    { forced: 'grayscale', requested: 'colorBlind' },
    { forced: 'colorBlind', requested: 'grayscale' },
  ] as const)('skips enabling $requested while $forced is forced on without issuing a write', async ({ forced, requested }) => {
    policy.defaults[forced] = true;
    policy.allowUserOverride[forced] = false;
    const { hook } = await setup();
    let change;
    act(() => { change = hook.result.current.setPreferences({ [requested]: true }); });
    expect(change).toEqual({ applied: 0, skipped: 1 });
    // 越过保存防抖窗口，确保不是仅在请求尚未发出时断言。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
    expect(api.countOf('PUT')).toBe(0);
    expect(document.overrides).toEqual({});
    expect(hook.result.current.preferences).toMatchObject({ [forced]: true, [requested]: false });
  });

  it('resets single overrides and all defaults while retaining terminal favorites', async () => {
    document = { overrides: { tableStriped: true, terminal: { fontSize: 20, favorites: [{ path: '/tmp', name: '临时目录' }] } } };
    const { hook } = await setup();
    act(() => hook.result.current.resetPreference('terminal.fontSize'));
    await waitFor(() => expect(api.countOf('PUT')).toBe(1));
    expect(document.overrides).toEqual({ tableStriped: true, terminal: { favorites: [{ path: '/tmp', name: '临时目录' }] } });
    act(() => hook.result.current.resetPreferences());
    await waitFor(() => expect(api.countOf('PUT')).toBe(2));
    expect(document.overrides).toEqual({ terminal: { favorites: [{ path: '/tmp', name: '临时目录' }] } });
    expect(hook.result.current.preferences.tableStriped).toBe(false);
  });

  it('resets several terminal overrides in one write while preserving neighboring values and favorites', async () => {
    document = { overrides: {
      tableStriped: true,
      terminal: { fontSize: 20, cursorBlink: false, lineHeight: 1.4, favorites: [{ path: '/tmp', name: '临时目录' }] },
    } };
    const { hook } = await setup();
    act(() => hook.result.current.resetPreference(['terminal.fontSize', 'terminal.cursorBlink']));
    await waitFor(() => expect(api.countOf('PUT')).toBe(1));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
    expect(api.countOf('PUT')).toBe(1);
    expect(document.overrides).toEqual({
      tableStriped: true,
      terminal: { lineHeight: 1.4, favorites: [{ path: '/tmp', name: '临时目录' }] },
    });
    expect(hook.result.current.preferences.terminal).toMatchObject({ fontSize: 14, cursorBlink: true, lineHeight: 1.4 });
  });

  it('rolls back rejected writes and re-reads the policy that now locks the field', async () => {
    api.on('PUT', authContract.savePreferences.fullPath, () => {
      policy.allowUserOverride.tableStriped = false;
      throw new Error('管理员已锁定此字段');
    });
    const { hook } = await setup();
    act(() => hook.result.current.setPreferences({ tableStriped: true }));
    expect(hook.result.current.preferences.tableStriped).toBe(true);
    await waitFor(() => {
      expect(hook.result.current.canOverridePreference('tableStriped')).toBe(false);
      expect(hook.result.current.preferences.tableStriped).toBe(false);
      expect(hook.result.current.overrides).toEqual({});
    });
    expect(api.countOf('GET', settingsContract.me.fullPath)).toBe(2);
    expect(api.countOf('GET', authContract.preferences.fullPath)).toBe(2);
  });

  it('does not persist edits if the policy could not be loaded', async () => {
    api.on('GET', settingsContract.me.fullPath, () => { throw new Error('offline'); });
    const { hook } = await setup();
    act(() => hook.result.current.setPreferences({ tableStriped: true }));
    expect(hook.result.current.overrides).toEqual({});
    expect(hook.result.current.canEditPreference('tableStriped')).toBe(false);
    expect(api.countOf('PUT')).toBe(0);
  });
});
