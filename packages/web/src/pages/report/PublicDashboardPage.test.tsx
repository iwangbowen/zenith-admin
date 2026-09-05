import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportPublicDashboard } from '@zenith/shared/report';
import PublicDashboardPage from './PublicDashboardPage';

const mocks = vi.hoisted(() => {
  const dashboard: ReportPublicDashboard = {
    name: '公开销售看板',
    widgets: [{ i: 'text', type: 'text', title: '摘要', options: { text: '公开内容' } }],
    filters: [{ id: 'region', label: '区域', type: 'input' }],
    layout: [{ i: 'text', x: 0, y: 0, w: 12, h: 3 }],
    canvasLayout: [],
    config: {},
    filterOptions: {},
  };
  return {
    dashboard,
    access: vi.fn().mockResolvedValue({
      accessSessionToken: 'session-token-123456',
      expiresAt: '2026-07-11 05:00:00',
      dashboard,
    }),
  };
});

vi.mock('@/hooks/queries/report-dashboards', () => ({
  usePublicReportDashboardAccess: () => ({
    mutateAsync: mocks.access,
    isPending: false,
  }),
  usePublicReportDashboard: () => ({
    data: null,
    error: null,
    isFetching: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  }),
  usePublicReportDashboardData: () => ({
    data: {},
    error: null,
    isFetching: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('./widgets/FilterBar', () => ({
  FilterBar: () => <div data-testid="public-filter">filters</div>,
}));

vi.mock('./widgets/ScreenCanvas', () => ({
  ScreenCanvas: () => <div data-testid="public-canvas">dashboard-content</div>,
}));

beforeEach(() => {
  mocks.access.mockClear();
  vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PublicDashboardPage', () => {
  it('renders the public dashboard without requiring PermissionContext', async () => {
    render(
      <MemoryRouter initialEntries={['/public/report/share-token']}>
        <Routes>
          <Route path="/public/report/:token" element={<PublicDashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.access).toHaveBeenCalledWith({ params: { token: 'share-token' }, body: { password: undefined } }));
    expect(document.body.contains(await screen.findByText('公开销售看板'))).toBe(true);
    expect(document.body.contains(screen.getByTestId('public-filter'))).toBe(true);
    expect(document.body.contains(screen.getByTestId('public-canvas'))).toBe(true);
  });
});
