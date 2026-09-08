import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { PermissionContext } from '@/hooks/usePermission';

const state = vi.hoisted(() => ({ policy: vi.fn(), risk: vi.fn() }));
vi.mock('@/hooks/usePreferences', () => ({
  usePreferences: () => ({ preferences: { tablePageSize: 10 } }),
  useOptionalPreferences: () => null,
}));
vi.mock('@/hooks/queries/settings', () => ({
  useSettings: (...args: unknown[]) => { state.policy(...args); return { data: undefined, refetch: vi.fn(), isFetching: false }; },
  useSaveSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/queries/identity-security', () => ({
  identitySecurityKeys: { riskLists: ['identity-security', 'riskEvents'] },
  useLoginRiskEventList: (...args: unknown[]) => { state.risk(...args); return { data: undefined, refetch: vi.fn() }; },
}));
vi.mock('@douyinfe/semi-ui', () => {
  const Form = Object.assign(({ children }: { children?: ReactNode }) => <div>{children}</div>, {
    Switch: () => null, InputNumber: () => null, Select: () => null,
  });
  const Tabs = Object.assign(({ children }: { children?: ReactNode }) => <div>{children}</div>, {
    TabPane: ({ tab, children }: { tab: string; children?: ReactNode }) => <section aria-label={tab}>{children}</section>,
  });
  return { Form, Tabs, Button: ({ children }: { children?: ReactNode }) => <button>{children}</button>, Empty: ({ description }: { description: string }) => <p>{description}</p>, Toast: { success: vi.fn() } };
});
vi.mock('@/components/ConfigurableTable', () => ({ default: () => <div>risk table</div> }));
vi.mock('@/components/SearchToolbar', () => ({ SearchToolbar: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/list-page', () => ({ ListSearchToolbar: () => null, listTableProps: () => ({}) }));
vi.mock('@/components/toolbar-controls', () => ({ RefreshButton: () => null }));
vi.mock('@/components/search-filters', () => ({ KeywordInput: () => null }));

import IdentitySecurityPage from './IdentitySecurityPage';

function show(permissions: string[], path = '/system/identity-security') {
  render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[path]}>
      <PermissionContext.Provider value={permissions}><IdentitySecurityPage /></PermissionContext.Provider>
    </MemoryRouter>
  </QueryClientProvider>);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('identity security tab permissions', () => {
  it('lets risk-only readers open the page without fetching policy', () => {
    show(['system:login-risk:list'], '/system/identity-security?tab=policy');
    expect(screen.queryByLabelText('策略配置')).not.toBeInTheDocument();
    expect(screen.getByLabelText('风险事件')).toBeInTheDocument();
    expect(state.policy).toHaveBeenLastCalledWith('identitySecurity', false);
    expect(state.risk.mock.lastCall?.[1]).toBe(true);
  });
  it('does not fetch risk events for policy-only managers even through a risk URL', () => {
    show(['system:identity-security:manage'], '/system/identity-security?tab=risk');
    expect(screen.getByLabelText('策略配置')).toBeInTheDocument();
    expect(screen.queryByLabelText('风险事件')).not.toBeInTheDocument();
    expect(state.policy).toHaveBeenLastCalledWith('identitySecurity', true);
    expect(state.risk.mock.lastCall?.[1]).toBe(false);
  });
  it('loads only the active tab when both permissions exist', () => {
    show(['system:identity-security:manage', 'system:login-risk:list']);
    expect(state.policy).toHaveBeenLastCalledWith('identitySecurity', true);
    expect(state.risk.mock.lastCall?.[1]).toBe(false);
  });
  it('disables both queries when neither permission is granted', () => {
    show([]);
    expect(screen.getByText('无访问权限')).toBeInTheDocument();
    expect(state.policy).toHaveBeenLastCalledWith('identitySecurity', false);
    expect(state.risk.mock.lastCall?.[1]).toBe(false);
  });
});
