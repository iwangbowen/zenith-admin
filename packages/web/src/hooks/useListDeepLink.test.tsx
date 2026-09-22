import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HashRouter, MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useListDeepLink } from './useListDeepLink';

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={[{ pathname: '/list', search: '?keyword=first&view=compact', hash: '#context', state: { returnTo: 'source' } }]}>{children}</MemoryRouter>;
}

describe('useListDeepLink', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('preserves existing callback behavior and unrelated query, hash and router state', async () => {
    // Existing callbacks may return an incidental value; their return remains ignored.
    const apply = vi.fn(() => true);
    const hook = renderHook(() => {
      useListDeepLink(['keyword'], apply);
      return { location: useLocation(), navigate: useNavigate() };
    }, { wrapper });

    await waitFor(() => expect(hook.result.current.location.search).toBe('?view=compact'));
    expect(hook.result.current.location.hash).toBe('#context');
    expect(hook.result.current.location.state).toEqual({ returnTo: 'source' });
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

  it('consumes competing detail parameters together while selecting one target tab', async () => {
    const apply = vi.fn();
    const hook = renderHook(() => {
      useListDeepLink(['hitId', 'reviewId'], apply, {
        getNextParams: (params) => ({ tab: params.hitId ? 'hits' : 'reviews' }),
      });
      return useLocation();
    }, {
      wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/list?hitId=7&reviewId=11&view=compact']}>{children}</MemoryRouter>,
    });

    await waitFor(() => expect(hook.result.current.search).toBe('?view=compact&tab=hits'));
    expect(apply).toHaveBeenCalledExactlyOnceWith({ hitId: '7', reviewId: '11' });
  });

  it('preserves parameters inside the Electron hash route', async () => {
    window.history.replaceState(null, '', '/#/list?keyword=first&view=compact#context');
    const apply = vi.fn();
    const hook = renderHook(() => {
      useListDeepLink(['keyword'], apply, { getNextParams: () => ({ tab: 'cases' }) });
      return useLocation();
    }, { wrapper: ({ children }: { children: ReactNode }) => <HashRouter>{children}</HashRouter> });

    await waitFor(() => expect(hook.result.current.search).toBe('?view=compact&tab=cases'));
    expect(apply).toHaveBeenCalledExactlyOnceWith({ keyword: 'first' });
    expect(window.location.hash).toBe('#/list?view=compact&tab=cases#context');
  });
});
