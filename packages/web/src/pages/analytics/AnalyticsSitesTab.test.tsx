
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AnalyticsSite } from '@zenith/shared';
import { PreferencesContext, defaultPreferences } from '@/hooks/usePreferences';


const mockSite = vi.hoisted<AnalyticsSite>(() => ({
  id: 1,
  tenantId: null,
  tenantName: null,
  siteKey: 'zk_admin_default_0000000000000000',
  name: '管理后台',
  appId: 'admin',
  allowedOrigins: ['https://example.com'],
  dailyEventQuota: 1000,
  todayUsage: 920,
  status: 'enabled',
  remark: null,
  createdAt: '2026-01-01 10:00:00',
  updatedAt: '2026-01-02 10:00:00',
}));

const invalidateQueriesMock = vi.fn();
const refetchMock = vi.fn();
const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const deleteMutate = vi.fn();
const regenerateMutate = vi.fn();

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }) };
});

vi.mock('@/hooks/queries/analytics', () => ({
  analyticsKeys: { data: { sitesLists: ['analytics', 'data', 'sites'] } },
  useAnalyticsSites: () => ({ data: { list: [mockSite], total: 1, page: 1, pageSize: 20 }, isFetching: false, refetch: refetchMock }),
  useCreateSite: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateSite: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
  useDeleteSite: () => ({ mutate: deleteMutate, isPending: false }),
  useRegenerateSiteKey: () => ({ mutate: regenerateMutate, isPending: false }),
}));

import AnalyticsSitesTab from './AnalyticsSitesTab';


function renderWithPreferences() {
  return render(
    <PreferencesContext.Provider value={{ preferences: defaultPreferences, setPreferences: vi.fn(), resetPreferences: vi.fn(), ready: true }}>
      <AnalyticsSitesTab />
    </PreferencesContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AnalyticsSitesTab', () => {
  it('renders site rows with copyable site key and platform tenant label', () => {
    renderWithPreferences();
    expect(screen.getByText('管理后台')).toBeInTheDocument();
    expect(screen.getByText('zk_admin_default_0000000000000000')).toBeInTheDocument();
    expect(screen.getByText('平台')).toBeInTheDocument();
  });

  it('renders today usage against daily quota', () => {
    renderWithPreferences();
    expect(screen.getByText('920 / 1000')).toBeInTheDocument();
  });

  it('invalidates site lists when searching and resetting', () => {
    renderWithPreferences();
    fireEvent.change(screen.getByPlaceholderText('站点名称'), { target: { value: '管理' } });
    fireEvent.click(screen.getByText('查询'));
    fireEvent.click(screen.getByText('重置'));
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['analytics', 'data', 'sites'] });
  });
});
