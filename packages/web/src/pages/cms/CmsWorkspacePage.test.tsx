import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { defaultPreferences, preferencePolicySchema } from '@zenith/shared/preferences';
import { PreferencesContext, type PreferencesContextValue } from '@/hooks/usePreferences';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CmsWorkspacePage from './CmsWorkspacePage';
import CmsDashboardPage from './CmsDashboardPage';

const dashboard = vi.hoisted(() => ({
  stats: vi.fn(() => ({ data: undefined, isFetching: false, refetch: vi.fn() })),
  visits: vi.fn(() => ({ data: undefined, isFetching: false, refetch: vi.fn() })),
}));
// 看板页直接 import 叶子模块（`@/hooks/queries/cms` 只是再导出 barrel），mock 必须落在被 import 的那个模块上，
// 否则真实 hook 会去找 QueryClient —— 这两个用例没套 Provider，会以「No QueryClient set」整体失败。
vi.mock('@/hooks/queries/cms-stats', () => ({ useCmsDashboardStats: dashboard.stats, useCmsVisitStats: dashboard.visits }));
vi.mock('@/hooks/queries/cms', () => ({ useCmsDashboardStats: dashboard.stats }));
// 看板内的待办条同样直接取叶子模块的 hook（无 Provider 的用例必须把它也挡在 mock 边界上）
vi.mock('@/hooks/queries/cms-editorial', () => ({
  useCmsEditorialMetrics: () => ({ data: undefined, isFetching: false, refetch: vi.fn() }),
}));

const permissions = vi.hoisted(() => ({ codes: [] as string[] }));
const workspace = vi.hoisted(() => ({
  useCmsEditorialWorkspace: vi.fn(() => ({
    data: { list: [], counters: [], total: 0 },
    isError: false,
    isLoading: false,
    error: null,
  })),
}));

vi.mock('@/hooks/queries/cms-operations', () => ({ useCmsEditorialWorkspace: workspace.useCmsEditorialWorkspace }));
vi.mock('@/hooks/usePagination', () => ({ usePagination: () => ({ page: 1, pageSize: 10, buildPagination: vi.fn(), setPage: vi.fn() }) }));
vi.mock('@/hooks/useListDeepLink', () => ({ useListDeepLink: () => undefined }));
vi.mock('@/components/ListPagination', () => ({ ListPagination: () => null }));
vi.mock('./CmsEditorialTasks', () => ({ default: () => <div data-testid="cms-editorial-tasks" /> }));
vi.mock('./CmsFeedbackSheet', () => ({ default: () => null }));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    hasPermission: (code: string) => permissions.codes.includes('*') || permissions.codes.includes(code),
    hasAnyPermission: (...codes: string[]) => permissions.codes.includes('*') || codes.some((code) => permissions.codes.includes(code)),
  }),
}));
vi.mock('@/components/SearchToolbar', () => ({ SearchToolbar: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/ConfigurableTable', () => ({ ConfigurableTable: () => <div data-testid="table" /> }));
vi.mock('./CmsSiteSelect', () => ({
  CmsSiteSelect: ({ onChange }: { onChange: (siteId: number) => void }) => (
    <button type="button" onClick={() => onChange(7)}>选择站点</button>
  ),
}));

const preferencesContext: PreferencesContextValue = {
  preferences: defaultPreferences,
  overrides: {},
  policy: preferencePolicySchema.parse({}),
  setPreferences: () => ({ applied: 0, skipped: 0 }),
  resetPreferences: () => undefined,
  resetPreference: () => undefined,
  canEditPreference: () => true,
  canOverridePreference: () => true,
  isPreferenceOverridden: () => false,
  hasEditablePreferences: true,
  hasManagedPreferences: false,
  ready: true,
};
const WorkspaceWrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const DashboardWrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <PreferencesContext.Provider value={preferencesContext}>{children}</PreferencesContext.Provider>
  </MemoryRouter>
);

beforeEach(() => {
  permissions.codes = [];
  dashboard.stats.mockClear();
  workspace.useCmsEditorialWorkspace.mockClear();
});
describe('CMS 内容工作台入口', () => {
  it('requires site access and at least one operational permission', () => {
    permissions.codes = ['cms:content:list'];
    const { rerender } = render(<CmsWorkspacePage />, { wrapper: WorkspaceWrapper });
    expect(screen.getByText(/需要站点查询权限/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '选择站点' })).not.toBeInTheDocument();

    permissions.codes = ['cms:site:list', 'cms:dashboard:view'];
    rerender(<CmsWorkspacePage />);
    expect(screen.getByText(/需要站点查询权限/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择站点' })).toBeInTheDocument();
    expect(screen.queryByText('编辑与读者反馈工作台')).not.toBeInTheDocument();
    expect(workspace.useCmsEditorialWorkspace).not.toHaveBeenCalled();
  });

  it('keeps the dashboard distinct and requires site-list permission for the site selector', () => {
    permissions.codes = ['cms:dashboard:view'];
    const { rerender } = render(<CmsDashboardPage />, { wrapper: DashboardWrapper });
    expect(screen.getByText('使用数据看板需要 CMS 看板查询和站点查询权限。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '选择站点' })).not.toBeInTheDocument();
    expect(dashboard.stats).toHaveBeenLastCalledWith(undefined);

    permissions.codes = ['cms:dashboard:view', 'cms:site:list'];
    rerender(<CmsDashboardPage />);
    expect(screen.getByRole('button', { name: '选择站点' })).toBeInTheDocument();
    expect(dashboard.stats).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(screen.getByRole('button', { name: '选择站点' }));
    expect(dashboard.stats).toHaveBeenLastCalledWith(7);
  });

  it('opens the workspace for content, feedback or editorial-task permissions without dashboard access', () => {
    for (const permission of ['cms:content:list', 'cms:form:list', 'cms:editorial-task:manage']) {
      permissions.codes = ['cms:site:list', permission];
      const { unmount } = render(<CmsWorkspacePage />, { wrapper: WorkspaceWrapper });
      fireEvent.click(screen.getByRole('button', { name: '选择站点' }));
      expect(screen.getByText('编辑与读者反馈工作台')).toBeInTheDocument();
      expect(workspace.useCmsEditorialWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ siteId: 7 }), true);
      expect(dashboard.stats).not.toHaveBeenCalled();
      unmount();
    }
  });
});
