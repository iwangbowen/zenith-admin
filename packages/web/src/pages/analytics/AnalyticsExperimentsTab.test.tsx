
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { desktopToolbar } from '@/test-utils/toolbar';
import type { AnalyticsExperiment } from '@zenith/shared/analytics';
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
  analyticsKeys: { data: { experimentsLists: ['analytics', 'experiments'] } },
  useExperiments: () => ({ data: { list: [mockExperiment], total: 1, page: 1, pageSize: 20 }, isFetching: false, refetch: refetchMock }),
  useAnalyticsEventMeta: () => ({ data: { list: [{ eventName: 'order_submit', displayName: '提交订单' }] } }),
  useCreateExperiment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateExperiment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteExperiment: () => ({ mutate: vi.fn(), isPending: false }),
  useExperimentAction: () => ({ mutate: vi.fn(), isPending: false }),
  useExperimentReport: () => ({ data: { experimentId: 1, expKey: 'homepage_banner', metricEventName: 'order_submit', variants: [] }, isFetching: false, refetch: vi.fn() }),
}));

import AnalyticsExperimentsTab, { toApiDateTime } from './AnalyticsExperimentsTab';

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
    const { container } = renderWithPreferences();
    const toolbar = desktopToolbar(container);
    fireEvent.change(toolbar.getByPlaceholderText('实验名称'), { target: { value: 'Banner' } });
    fireEvent.click(toolbar.getByText('查询'));
    fireEvent.click(toolbar.getByText('重置'));
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['analytics', 'experiments'] });
  });
});

describe('toApiDateTime — DatePicker 的 Date 值归一为接口时间字符串', () => {
  // 漏掉 Date 分支不会报错：Date 会被 JSON 序列化成 "2026-08-09T07:30:00.000Z"，
  // 后端按本地时区解析后产生数小时偏移，且构建/类型检查/页面渲染全部正常
  it('formats a Date into YYYY-MM-DD HH:mm:ss without timezone suffix', () => {
    const result = toApiDateTime(new Date(2026, 7, 9, 15, 30, 45));
    expect(result).toBe('2026-08-09 15:30:45');
    expect(result).not.toContain('T');
    expect(result).not.toContain('Z');
  });

  // 编辑回填时表单里是接口返回的字符串，不能被再格式化一次
  it('passes an already-formatted string through unchanged', () => {
    expect(toApiDateTime('2026-01-01 10:00:00')).toBe('2026-01-01 10:00:00');
  });

  // 留空表示「不限 / 手动启动」，必须是 null 而不是空串——空串会过不了后端的 min(1) 校验
  it('normalizes empty input to null', () => {
    expect(toApiDateTime(null)).toBeNull();
    expect(toApiDateTime(undefined)).toBeNull();
    expect(toApiDateTime('')).toBeNull();
    expect(toApiDateTime('   ')).toBeNull();
  });
});
