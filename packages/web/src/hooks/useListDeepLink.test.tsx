import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HashRouter, MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useListDeepLink } from './useListDeepLink';

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/list?keyword=first&view=compact']}>{children}</MemoryRouter>;
}

describe('useListDeepLink', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('preserves existing callback behavior and unrelated router query parameters', async () => {
    // Existing callbacks may return an incidental value; their return remains ignored.
    const apply = vi.fn(() => true);
    const hook = renderHook(() => {
      useListDeepLink(['keyword'], apply);
      return { location: useLocation(), navigate: useNavigate() };
    }, { wrapper });

    await waitFor(() => expect(hook.result.current.location.search).toBe('?view=compact'));
    expect(apply).toHaveBeenCalledExactlyOnceWith({ keyword: 'first' });

    act(() => hook.result.current.navigate('/list?keyword=second&view=compact'));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(apply).toHaveBeenLastCalledWith({ keyword: 'second' });
    expect(hook.result.current.location.search).toBe('?view=compact');
  });

  it('consumes deep links and writes the target tab in a single navigation', async () => {
    const apply = vi.fn();
    const observed: string[] = [];
    const hook = renderHook(() => {
      useListDeepLink(['keyword'], apply, { getNextParams: () => ({ tab: 'cases' }) });
      const location = useLocation();
      observed.push(location.search);
      return location;
    }, { wrapper });

    await waitFor(() => expect(hook.result.current.search).toBe('?view=compact&tab=cases'));
    expect(apply).toHaveBeenCalledExactlyOnceWith({ keyword: 'first' });
    expect([...new Set(observed)]).toEqual(['?keyword=first&view=compact', '?view=compact&tab=cases']);
  });

  it('preserves parameters inside the Electron hash route', async () => {
    window.history.replaceState(null, '', '/#/list?keyword=first&view=compact');
    const apply = vi.fn();
    const hook = renderHook(() => {
      useListDeepLink(['keyword'], apply, { getNextParams: () => ({ tab: 'cases' }) });
      return useLocation();
    }, { wrapper: ({ children }: { children: ReactNode }) => <HashRouter>{children}</HashRouter> });

    await waitFor(() => expect(hook.result.current.search).toBe('?view=compact&tab=cases'));
    expect(apply).toHaveBeenCalledExactlyOnceWith({ keyword: 'first' });
    expect(window.location.hash).toBe('#/list?view=compact&tab=cases');
  });
});
