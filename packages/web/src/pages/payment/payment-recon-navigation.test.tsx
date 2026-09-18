import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PreferencesContext } from '@/hooks/usePreferences';
import { createPreferencesContext } from '@/test-utils/preferences';
import { usePaymentReconNavigation } from './payment-recon-navigation';

function renderNavigation(initialEntry: string, syncPageStateToUrl = false) {
  const preferences = createPreferencesContext({ syncPageStateToUrl });
  return renderHook(() => ({
    ...usePaymentReconNavigation(),
    location: useLocation(),
    navigate: useNavigate(),
  }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <PreferencesContext.Provider value={preferences}>
        <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
      </PreferencesContext.Provider>
    ),
  });
}

describe.each([false, true])('payment reconciliation deep links (URL sync: %s)', (sync) => {
  it('opens an initial case on its tab and preserves unrelated URL parameters', async () => {
    const hook = renderNavigation('/payment/recon?caseId=42&tab=tasks&view=compact', sync);

    await waitFor(() => {
      expect(hook.result.current.caseId).toBe(42);
      expect(hook.result.current.periodId).toBeUndefined();
      expect(hook.result.current.tab).toBe('cases');
      const params = new URLSearchParams(hook.result.current.location.search);
      expect(params.has('caseId')).toBe(false);
      expect(params.get('view')).toBe('compact');
      expect(params.get('tab')).toBe(sync ? 'cases' : null);
    });
  });

  it('opens an initial period on its tab', async () => {
    const hook = renderNavigation('/payment/recon?periodId=18&tab=cases', sync);

    await waitFor(() => {
      expect(hook.result.current.periodId).toBe(18);
      expect(hook.result.current.caseId).toBeUndefined();
      expect(hook.result.current.tab).toBe('periods');
      expect(hook.result.current.location.search).toBe('');
    });
  });

  it('handles same-page notifications, clears the other drawer and resets the statement version', async () => {
    const hook = renderNavigation('/payment/recon', sync);
    act(() => hook.result.current.navigate('/payment/recon?periodId=18'));
    await waitFor(() => expect(hook.result.current.periodId).toBe(18));
    act(() => hook.result.current.setStatementId(99));

    act(() => hook.result.current.navigate('/payment/recon?caseId=42'));
    await waitFor(() => {
      expect(hook.result.current.caseId).toBe(42);
      expect(hook.result.current.periodId).toBeUndefined();
      expect(hook.result.current.statementId).toBeUndefined();
      expect(hook.result.current.tab).toBe('cases');
    });

    act(() => hook.result.current.navigate('/payment/recon?periodId=19'));
    await waitFor(() => {
      expect(hook.result.current.periodId).toBe(19);
      expect(hook.result.current.caseId).toBeUndefined();
      expect(hook.result.current.tab).toBe('periods');
    });
    act(() => hook.result.current.setStatementId(100));
    act(() => hook.result.current.navigate('/payment/recon?periodId=20'));
    await waitFor(() => {
      expect(hook.result.current.periodId).toBe(20);
      expect(hook.result.current.statementId).toBeUndefined();
    });
  });

  it.each(['caseId', 'periodId'] as const)('reopens a closed drawer from the same %s notification', async (param) => {
    const url = `/payment/recon?${param}=42`;
    const hook = renderNavigation(url, sync);
    await waitFor(() => expect(hook.result.current[param]).toBe(42));
    act(() => {
      if (param === 'caseId') hook.result.current.closeCase();
      else hook.result.current.closePeriod();
    });
    expect(hook.result.current[param]).toBeUndefined();

    act(() => hook.result.current.navigate(url));
    await waitFor(() => expect(hook.result.current[param]).toBe(42));
    expect(new URLSearchParams(hook.result.current.location.search).has(param)).toBe(false);
  });

  it('chooses the case when both targets are present without opening stacked drawers', async () => {
    const hook = renderNavigation('/payment/recon?caseId=42&periodId=18', sync);
    await waitFor(() => {
      expect(hook.result.current.caseId).toBe(42);
      expect(hook.result.current.periodId).toBeUndefined();
      expect(hook.result.current.tab).toBe('cases');
      const params = new URLSearchParams(hook.result.current.location.search);
      expect(params.has('caseId')).toBe(false);
      expect(params.has('periodId')).toBe(false);
    });
  });
});

describe.each(['caseId', 'periodId'])('invalid %s notification targets', (param) => {
  it.each(['abc', '0', '-1', '1.5', '1e2', '0x10', 'Infinity', 'NaN', '9007199254740993', ' 42 '])('does not pass %s to detail queries', async (value) => {
    const hook = renderNavigation(`/payment/recon?${param}=${encodeURIComponent(value)}`);
    await waitFor(() => expect(hook.result.current.location.search).toBe(''));
    expect(hook.result.current.caseId).toBeUndefined();
    expect(hook.result.current.periodId).toBeUndefined();
    expect(hook.result.current.tab).toBe('periods');
  });
});
