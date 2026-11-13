import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { PermissionContext } from '@/hooks/usePermission';
import { createTestQueryClient, createWrapper } from '@/test-utils/query-harness';

const state = vi.hoisted(() => ({ policy: vi.fn(), risk: vi.fn() }));
vi.mock('@/hooks/usePreferences', () => ({
  usePreferences: () => ({ preferences: { tablePageSize: 10 }, updatePreferences: vi.fn() }),
  useOptionalPreferences: () => ({ preferences: { tablePageSize: 10 }, updatePreferences: vi.fn() }),
  defaultPreferences: { tablePageSize: 10 },
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
// 本组只验证权限驱动的 Tab 查询，不挂载版本历史与编辑工具。
vi.mock('@/components/settings/SettingsEditorTools', () => ({ SettingsEditorTools: () => null }));
// 会话并发字段依赖 Semi Form 上下文（useFormApi / useFormState），本测试只关心 Tab 权限与请求触发
vi.mock('./SessionPolicyFields', () => ({ SessionPolicyFields: () => null }));

import IdentitySecurityPage from './IdentitySecurityPage';

function show(permissions: string[], path = '/system/identity-security') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <PermissionContext.Provider value={permissions}><IdentitySecurityPage /></PermissionContext.Provider>
    </MemoryRouter>,
    { wrapper: createWrapper(createTestQueryClient()) },
  );
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
    expect(state.policy).toHaveBeenLastCalledWith('identitySecurity', false);
    expect(state.risk.mock.lastCall?.[1]).toBe(false);
  });
});
