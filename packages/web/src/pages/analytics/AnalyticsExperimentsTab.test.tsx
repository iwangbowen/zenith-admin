
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AnalyticsExperiment } from '@zenith/shared';
import { PreferencesContext, defaultPreferences } from '@/hooks/usePreferences';

const mockExperiment = vi.hoisted<AnalyticsExperiment>(() => ({
  id: 1,
  tenantId: null,
  tenantName: null,
  expKey: 'homepage_banner',
  name: '首页 Banner 文案实验',
  description: null,
  status: 'running',
  trafficAllocation: 100,
  variants: [{ key: 'control', name: '对照组', weight: 50 }, { key: 'new_copy', name: '新文案', weight: 50 }],
  metricEventName: 'order_submit',
  startAt: '2026-01-01 10:00:00',
  endAt: null,
  createdBy: 1,
  updatedBy: 1,
  createdAt: '2026-01-01 10:00:00',
  updatedAt: '2026-01-02 10:00:00',
}));

const invalidateQueriesMock = vi.fn();
const refetchMock = vi.fn();

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }) };
});

vi.mock('@/hooks/queries/analytics', () => ({
  analyticsKeys: { data: { experimentsLists: ['analytics', 'data', 'experiments'] } },
  useExperiments: () => ({ data: { list: [mockExperiment], total: 1, page: 1, pageSize: 20 }, isFetching: false, refetch: refetchMock }),
  useAnalyticsEventMeta: () => ({ data: { list: [{ eventName: 'order_submit', displayName: '提交订单' }] } }),
  useCreateExperiment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateExperiment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteExperiment: () => ({ mutate: vi.fn(), isPending: false }),
  useExperimentAction: () => ({ mutate: vi.fn(), isPending: false }),
  useExperimentReport: () => ({ data: { experimentId: 1, expKey: 'homepage_banner', metricEventName: 'order_submit', variants: [] }, isFetching: false, refetch: vi.fn() }),
}));

import AnalyticsExperimentsTab from './AnalyticsExperimentsTab';

function renderWithPreferences() {
  return render(
    <PreferencesContext.Provider value={{ preferences: defaultPreferences, setPreferences: vi.fn(), resetPreferences: vi.fn(), ready: true }}>
      <AnalyticsExperimentsTab />
    </PreferencesContext.Provider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('AnalyticsExperimentsTab', () => {
  it('renders experiment rows and status', () => {
    renderWithPreferences();
    expect(screen.getByText('homepage_banner')).toBeInTheDocument();
    expect(screen.getByText('首页 Banner 文案实验')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
  });

  it('invalidates experiment lists when searching and resetting', () => {
    renderWithPreferences();
    fireEvent.change(screen.getByPlaceholderText('实验名称'), { target: { value: 'Banner' } });
    fireEvent.click(screen.getByText('查询'));
    fireEvent.click(screen.getByText('重置'));
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['analytics', 'data', 'experiments'] });
  });
});
