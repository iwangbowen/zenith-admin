import { useEffect, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, RouterProvider, createMemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  defaultPreferences,
  PreferencesContext,
} from './usePreferences';
import type { PreferencesContextValue } from './usePreferences';
import { useUrlSelectionState } from './useUrlSelectionState';
import { useUrlTabState } from './useUrlTabState';

function createWrapper(initialEntry: string, initialSync: boolean) {
  let setSyncPreference: Dispatch<SetStateAction<boolean>> | null = null;

  function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    const [syncToUrl, setSyncToUrl] = useState(initialSync);
    setSyncPreference = setSyncToUrl;
    const context: PreferencesContextValue = {
      preferences: {
        ...defaultPreferences,
        syncPageStateToUrl: syncToUrl,
      },
      setPreferences: vi.fn(),
      resetPreferences: vi.fn(),
      ready: true,
    };

    return (
      <PreferencesContext.Provider value={context}>
        <MemoryRouter initialEntries={[initialEntry]}>
          {children}
        </MemoryRouter>
      </PreferencesContext.Provider>
    );
  }

  return {
    Wrapper,
    setSyncPreference(value: boolean) {
      act(() => setSyncPreference?.(value));
    },
  };
}

describe('useUrlSelectionState', () => {
  it('enables URL sync from the current selection without navigation churn', async () => {
    const wrapper = createWrapper('/system/dicts?view=compact', false);
    const hook = renderHook(() => {
      const [selection, setSelection] = useUrlSelectionState('dict');
      const location = useLocation();
      return { selection, setSelection, location };
    }, { wrapper: wrapper.Wrapper });

    act(() => hook.result.current.setSelection('42'));
    expect(hook.result.current.selection).toBe('42');
    expect(hook.result.current.location.search).toBe('?view=compact');

    wrapper.setSyncPreference(true);
    await waitFor(() => {
      const params = new URLSearchParams(hook.result.current.location.search);
      expect(params.get('view')).toBe('compact');
      expect(params.get('dict')).toBe('42');
    });

    const settledLocationKey = hook.result.current.location.key;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(hook.result.current.selection).toBe('42');
    expect(hook.result.current.location.key).toBe(settledLocationKey);
  });

  it('follows external URL changes and consumes deep links when sync is disabled', async () => {
    const wrapper = createWrapper('/system/dicts?dict=7&view=compact', false);
    const hook = renderHook(() => {
      const [selection] = useUrlSelectionState('dict');
      const location = useLocation();
      const navigate = useNavigate();
      return { selection, location, navigate };
    }, { wrapper: wrapper.Wrapper });

    await waitFor(() => {
      expect(hook.result.current.selection).toBe('7');
      expect(new URLSearchParams(hook.result.current.location.search).has('dict')).toBe(false);
    });

    wrapper.setSyncPreference(true);
    act(() => hook.result.current.navigate('/system/dicts?dict=9&view=compact'));
    await waitFor(() => {
      expect(hook.result.current.selection).toBe('9');
      expect(new URLSearchParams(hook.result.current.location.search).get('dict')).toBe('9');
    });
  });

  it('settles when the page clears an invalid deep link before the hook\'s own URL write lands', async () => {
    // 数据路由器的导航异步落地：页面在数据落定后立即清掉无效参数时，hook 自己发起的
    // 「消费模式剥离参数」导航尚未完成，此时 location 仍是旧值，不得被当作外部变化重新导入
    let renders = 0;
    let probe: { selection: string | null; search: string } = { selection: null, search: '' };
    function Probe() {
      const [selection, setSelection] = useUrlSelectionState('dict');
      const location = useLocation();
      renders += 1;
      probe = { selection, search: location.search };
      useEffect(() => {
        // 上限防止旧实现的同步渲染风暴饿死事件循环把用例挂死：超过上限就放弃清参，让断言直接失败
        if (renders > 200) return;
        if (selection !== null && !/^\d+$/.test(selection)) setSelection(null);
      }, [selection, setSelection]);
      return null;
    }
    const context: PreferencesContextValue = {
      preferences: { ...defaultPreferences, syncPageStateToUrl: false },
      setPreferences: vi.fn(),
      resetPreferences: vi.fn(),
      ready: true,
    };
    const router = createMemoryRouter(
      [{ path: '*', element: <Probe /> }],
      { initialEntries: ['/system/dicts?dict=abc&view=compact'] },
    );
    render(
      <PreferencesContext.Provider value={context}>
        <RouterProvider router={router} />
      </PreferencesContext.Provider>,
    );

    await waitFor(() => {
      const params = new URLSearchParams(probe.search);
      expect(probe.selection).toBeNull();
      expect(params.has('dict')).toBe(false);
      expect(params.get('view')).toBe('compact');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(probe.selection).toBeNull();
    expect(renders).toBeLessThan(20);
  });
});

describe('useUrlTabState', () => {
  it('writes user tab changes once and follows external navigation', async () => {
    const wrapper = createWrapper('/analytics?view=compact', true);
    const hook = renderHook(() => {
      const [tab, setTab] = useUrlTabState(['overview', 'events'] as const, 'overview');
      const location = useLocation();
      const navigate = useNavigate();
      return { tab, setTab, location, navigate };
    }, { wrapper: wrapper.Wrapper });

    act(() => hook.result.current.setTab('events'));
    await waitFor(() => {
      expect(hook.result.current.tab).toBe('events');
      expect(new URLSearchParams(hook.result.current.location.search).get('tab')).toBe('events');
    });

    act(() => hook.result.current.navigate('/analytics?tab=overview&view=compact'));
    await waitFor(() => {
      const params = new URLSearchParams(hook.result.current.location.search);
      expect(hook.result.current.tab).toBe('overview');
      expect(params.has('tab')).toBe(false);
      expect(params.get('view')).toBe('compact');
    });
  });
});
