import { createPreferencesContext } from '@/test-utils/preferences';
import { useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  PreferencesContext,
} from './usePreferences';
import { useUrlSelectionState } from './useUrlSelectionState';
import { useUrlTabState } from './useUrlTabState';

function createWrapper(initialEntry: string, initialSync: boolean) {
  let setSyncPreference: Dispatch<SetStateAction<boolean>> | null = null;

  function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    const [syncToUrl, setSyncToUrl] = useState(initialSync);
    setSyncPreference = setSyncToUrl;
    const context = createPreferencesContext({ syncPageStateToUrl: syncToUrl });

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
    const wrapper = createWrapper('/system/dicts?view=compact#context', false);
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
      expect(hook.result.current.location.hash).toBe('#context');
    });

    const settledLocationKey = hook.result.current.location.key;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(hook.result.current.selection).toBe('42');
    expect(hook.result.current.location.key).toBe(settledLocationKey);
  });

  it('follows external URL changes and consumes deep links when sync is disabled', async () => {
    const wrapper = createWrapper('/system/dicts?dict=7&view=compact#context', false);
    const hook = renderHook(() => {
      const [selection] = useUrlSelectionState('dict');
      const location = useLocation();
      const navigate = useNavigate();
      return { selection, location, navigate };
    }, { wrapper: wrapper.Wrapper });

    await waitFor(() => {
      expect(hook.result.current.selection).toBe('7');
      expect(new URLSearchParams(hook.result.current.location.search).has('dict')).toBe(false);
      expect(hook.result.current.location.hash).toBe('#context');
    });

    wrapper.setSyncPreference(true);
    act(() => hook.result.current.navigate('/system/dicts?dict=9&view=compact'));
    await waitFor(() => {
      expect(hook.result.current.selection).toBe('9');
      expect(new URLSearchParams(hook.result.current.location.search).get('dict')).toBe('9');
    });
  });
});

describe('useUrlTabState', () => {
  it('writes user tab changes once and follows external navigation', async () => {
    const wrapper = createWrapper('/analytics?view=compact#context', true);
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
      expect(hook.result.current.location.hash).toBe('#context');
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
