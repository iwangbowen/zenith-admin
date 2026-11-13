import React, { createRef } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportEmbedState, ReportWidget } from '@zenith/shared/report';
import { ReportEmbed, type ReportEmbedHandle } from './ReportEmbed';

const mocks = vi.hoisted(() => {
  const widget: ReportWidget = {
    i: 'sales',
    type: 'bar',
    title: '销售额',
    datasetId: 1,
    options: { categoryField: 'region', valueFields: ['amount'] },
    interaction: { enabled: true, setFilterId: 'region' },
    drilldown: { enabled: true, type: 'url', url: 'https://example.com/{value}' },
  };
  return {
    widget,
    dashboard: {
      id: 8,
      name: '销售看板',
      widgets: [widget],
      filters: [{
        id: 'region',
        label: '区域',
        type: 'select' as const,
        defaultValue: 'east',
        optionSource: { kind: 'static' as const, options: [{ value: 'east', label: '华东' }] },
      }],
      layout: [{ i: 'sales', x: 0, y: 0, w: 12, h: 5 }],
      canvasLayout: [],
      config: {},
      status: 'enabled',
      lifecycleStatus: 'published',
      revision: 1,
      createdAt: '',
      updatedAt: '',
      filterOptions: {},
    },
    dashboardError: null as Error | null,
    dashboardRefetch: vi.fn().mockResolvedValue(undefined),
    dataRefetch: vi.fn().mockResolvedValue(undefined),
    embedDataRefetch: vi.fn().mockResolvedValue(undefined),
    toPng: vi.fn().mockResolvedValue('data:image/png;base64,embed'),
  };
});

vi.mock('@/hooks/queries/reports-embed', () => ({
  useReportEmbedDashboard: () => ({
    data: mocks.dashboardError ? null : mocks.dashboard,
    error: mocks.dashboardError,
    isLoading: false,
    isFetching: false,
    refetch: mocks.dashboardRefetch,
  }),
  useReportEmbedData: () => ({
    data: {},
    error: null,
    isFetching: false,
    refetch: mocks.embedDataRefetch,
  }),
}));

vi.mock('@/hooks/queries/report-dashboards', () => ({
  useReportDashboardWidgetData: () => ({
    get: () => ({ data: null, loading: false, error: null }),
    refresh: vi.fn(),
    query: { error: null, refetch: mocks.dataRefetch },
  }),
}));

vi.mock('@/pages/report/widgets/FilterBar', () => ({
  FilterBar: (props: {
    values: Record<string, unknown>;
    onChange: (filterId: string, value: unknown) => void;
  }) => (
    <div>
      <output data-testid="filter-values">{JSON.stringify(props.values)}</output>
      <button type="button" onClick={() => props.onChange('region', 'west')}>change-filter</button>
    </div>
  ),
}));

vi.mock('@/pages/report/widgets/ScreenCanvas', () => ({
  ScreenCanvas: (props: {
    widgets: ReportWidget[];
    filterValues: Record<string, unknown>;
    onWidgetClick?: (widget: ReportWidget) => void;
    onCategoryClick?: (widget: ReportWidget, value: string) => void;
  }) => (
    <div>
      <output data-testid="canvas-values">{JSON.stringify(props.filterValues)}</output>
      <button type="button" onClick={() => props.onWidgetClick?.(props.widgets[0])}>widget-click</button>
      <button type="button" onClick={() => props.onCategoryClick?.(props.widgets[0], 'north')}>category-click</button>
    </div>
  ),
}));

vi.mock('html-to-image', () => ({
  toPng: (...args: unknown[]) => mocks.toPng(...args),
}));

beforeEach(() => {
  mocks.dashboardError = null;
  mocks.dashboardRefetch.mockClear();
  mocks.dataRefetch.mockClear();
  mocks.embedDataRefetch.mockClear();
  mocks.toPng.mockClear();
  vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ReportEmbed SDK', () => {
  it('keeps controlled filters authoritative and emits only user-driven changes', async () => {
    const user = userEvent.setup();
    const ref = createRef<ReportEmbedHandle>();
    const onFilterChange = vi.fn();
    const { rerender } = render(
      <ReportEmbed
        ref={ref}
        dashboardId={8}
        showFilters
        filterValues={{ region: 'east' }}
        onFilterChange={onFilterChange}
      />,
    );

    expect(ref.current?.getState().filterValues).toEqual({ region: 'east' });
    await user.click(screen.getByRole('button', { name: 'change-filter' }));
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({
      filterId: 'region',
      value: 'west',
      filterValues: { region: 'west' },
    }));
    expect(ref.current?.getState().filterValues).toEqual({ region: 'east' });

    expect(ref.current?.setFilter('region', 'north')).toBe(false);
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    rerender(
      <ReportEmbed
        ref={ref}
        dashboardId={8}
        showFilters
        filterValues={{ region: 'north' }}
        onFilterChange={onFilterChange}
      />,
    );
    expect(ref.current?.getState().filterValues).toEqual({ region: 'north' });
  });

  it('supports uncontrolled filters, callbacks, interception and imperative methods without PermissionContext', async () => {
    const user = userEvent.setup();
    const ref = createRef<ReportEmbedHandle>();
    const onLoad = vi.fn<(state: ReportEmbedState) => void>();
    const onFilterChange = vi.fn();
    const onWidgetClick = vi.fn();
    const onDrilldown = vi.fn();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <ReportEmbed
        ref={ref}
        dashboardId={8}
        showFilters
        interceptDrilldown
        onLoad={onLoad}
        onFilterChange={onFilterChange}
        onWidgetClick={onWidgetClick}
        onDrilldown={onDrilldown}
      />,
    );

    await waitFor(() => expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({
      loaded: true,
      filterValues: { region: 'east' },
    })));
    await user.click(screen.getByRole('button', { name: 'change-filter' }));
    expect(ref.current?.getState().filterValues).toEqual({ region: 'west' });

    await user.click(screen.getByRole('button', { name: 'widget-click' }));
    expect(onWidgetClick).toHaveBeenCalledWith({
      widgetId: 'sales',
      widgetTitle: '销售额',
      widgetType: 'bar',
    });

    await user.click(screen.getByRole('button', { name: 'category-click' }));
    expect(onDrilldown).toHaveBeenCalledWith(expect.objectContaining({
      widgetId: 'sales',
      drilldownType: 'url',
      selected: { field: 'region', value: 'north' },
    }));
    expect(onDrilldown.mock.calls[0][0]).not.toHaveProperty('url');
    expect(open).not.toHaveBeenCalled();

    act(() => {
      expect(ref.current?.setFilter('region', 'south')).toBe(true);
    });
    expect(ref.current?.getState().filterValues).toEqual({ region: 'south' });
    expect(onFilterChange).toHaveBeenCalledTimes(2);

    act(() => {
      expect(ref.current?.resetFilters()).toBe(true);
    });
    expect(ref.current?.getState().filterValues).toEqual({ region: 'east' });
    await ref.current?.refresh();
    expect(mocks.dashboardRefetch).toHaveBeenCalled();
    expect(mocks.dataRefetch).toHaveBeenCalled();
    await expect(ref.current?.exportPng()).resolves.toBe('data:image/png;base64,embed');
  });

  it('blocks user, ref and postMessage filter mutations in read-only mode', async () => {
    const user = userEvent.setup();
    const ref = createRef<ReportEmbedHandle>();
    const onFilterChange = vi.fn();
    render(<ReportEmbed ref={ref} dashboardId={8} showFilters readOnly onFilterChange={onFilterChange} />);

    await user.click(screen.getByRole('button', { name: 'change-filter' }));
    expect(onFilterChange).not.toHaveBeenCalled();
    expect(ref.current?.setFilter('region', 'west')).toBe(false);
    expect(ref.current?.resetFilters()).toBe(false);
    expect(ref.current?.getState()).toEqual(expect.objectContaining({
      readOnly: true,
      filterValues: { region: 'east' },
    }));
  });

  it('reports dashboard load errors', async () => {
    mocks.dashboardError = new Error('token expired');
    const onError = vi.fn();
    render(<ReportEmbed embedToken="expired" onError={onError} />);

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'token expired' })));
  });
});
