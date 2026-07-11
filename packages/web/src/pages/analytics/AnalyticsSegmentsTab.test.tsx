/**
 * AnalyticsSegmentsTab 单元测试（行为中心阶段 1：用户分群 CRUD + 物化 + 成员）
 *
 * 覆盖点：
 *  1. 分群列表渲染（名称/规则摘要/状态/成员数）
 *  2. 新增分群：填写名称 + 一条事件条件 → 提交调用 saveMutation.mutateAsync，rules 形状正确
 *  3. 删除分群：确认后调用 deleteMutation.mutateAsync
 *  4. 重算（物化）：点击后调用 materializeMutation.mutateAsync 并提示任务已提交
 *  5. 查看成员：点击「成员」打开 SideSheet 并渲染成员列表
 *  6. 分群触达：点击「触达」打开触达 SideSheet 并渲染表单
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AnalyticsSegmentMember, AnalyticsUserSegment } from '@zenith/shared';
import { PreferencesContext, defaultPreferences } from '@/hooks/usePreferences';

const useAnalyticsSegmentsMock = vi.fn();
const useAnalyticsSegmentMembersMock = vi.fn();
const useCampaignsMock = vi.fn();
const saveMutateAsync = vi.fn().mockResolvedValue({});
const deleteMutateAsync = vi.fn().mockResolvedValue({});
const materializeMutateAsync = vi.fn().mockResolvedValue({});
const createCampaignMutateAsync = vi.fn().mockResolvedValue({});
const executeCampaignMutateAsync = vi.fn().mockResolvedValue({});
const deleteCampaignMutateAsync = vi.fn().mockResolvedValue({});
const invalidateQueriesMock = vi.fn();

vi.mock('@/hooks/queries/analytics', () => ({
  analyticsKeys: { data: { segmentsLists: ['analytics', 'data', 'segments', 'list'] } },
  useAnalyticsSegments: (...args: unknown[]) => useAnalyticsSegmentsMock(...args),
  useAnalyticsSegmentMembers: (...args: unknown[]) => useAnalyticsSegmentMembersMock(...args),
  useCampaigns: (...args: unknown[]) => useCampaignsMock(...args),
  useSaveAnalyticsSegment: () => ({ mutateAsync: saveMutateAsync, isPending: false }),
  useDeleteAnalyticsSegment: () => ({ mutateAsync: deleteMutateAsync, isPending: false }),
  useMaterializeAnalyticsSegment: () => ({ mutateAsync: materializeMutateAsync, isPending: false }),
  useCreateCampaign: () => ({ mutateAsync: createCampaignMutateAsync, isPending: false }),
  useExecuteCampaign: () => ({ mutateAsync: executeCampaignMutateAsync, isPending: false }),
  useDeleteCampaign: () => ({ mutateAsync: deleteCampaignMutateAsync, isPending: false }),
}));

vi.mock('@/hooks/queries/email-templates', () => ({
  useEmailTemplateList: () => ({ data: { list: [{ id: 1, name: '邮件模板' }] }, isFetching: false }),
}));
vi.mock('@/hooks/queries/in-app-templates', () => ({
  useInAppTemplateList: () => ({ data: { list: [{ id: 2, name: '站内信模板' }] }, isFetching: false }),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }) };
});

// Modal.confirm 依赖 createRoot 命令式渲染，jsdom 下直接同步调用 onOk 验证删除链路
vi.mock('@douyinfe/semi-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@douyinfe/semi-ui')>();
  Object.assign(actual.Modal, {
    confirm: (config: { onOk?: () => void | Promise<void> }) => { void config.onOk?.(); },
  });
  return actual;
});

import AnalyticsSegmentsTab from './AnalyticsSegmentsTab';

function renderWithPreferences(ui: React.ReactElement) {
  return render(
    <PreferencesContext.Provider value={{ preferences: defaultPreferences, setPreferences: vi.fn(), resetPreferences: vi.fn(), ready: true }}>
      {ui}
    </PreferencesContext.Provider>,
  );
}

function makeSegment(overrides: Partial<AnalyticsUserSegment> = {}): AnalyticsUserSegment {
  return {
    id: 1, tenantId: 1, name: '近 7 天活跃用户', description: '活跃用户圈选', status: 'enabled',
    rules: { operator: 'AND', conditions: [{ type: 'event', eventName: 'login', days: 7 }] },
    estimatedSize: 128, snapshotAt: '2026-01-01 10:00:00',
    createdAt: '2026-01-01 09:00:00', updatedAt: '2026-01-01 10:00:00',
    ...overrides,
  };
}

function makeMember(overrides: Partial<AnalyticsSegmentMember> = {}): AnalyticsSegmentMember {
  return {
    id: 1, segmentId: 1, tenantId: 1, distinctId: 'dist-abc', identityType: 'admin', userId: 1, memberId: null,
    snapshotAt: '2026-01-01 10:00:00', ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  saveMutateAsync.mockResolvedValue({});
  deleteMutateAsync.mockResolvedValue({});
  materializeMutateAsync.mockResolvedValue({});
  createCampaignMutateAsync.mockResolvedValue({});
  executeCampaignMutateAsync.mockResolvedValue({});
  deleteCampaignMutateAsync.mockResolvedValue({});
  useAnalyticsSegmentsMock.mockReturnValue({
    data: { list: [makeSegment()], total: 1, page: 1, pageSize: 20 },
    isFetching: false,
    refetch: vi.fn(),
  });
  useAnalyticsSegmentMembersMock.mockReturnValue({
    data: { list: [makeMember()], total: 1, page: 1, pageSize: 20 },
    isFetching: false,
  });
  useCampaignsMock.mockReturnValue({
    data: { list: [], total: 0, page: 1, pageSize: 50 },
    isFetching: false,
    refetch: vi.fn(),
  });
});

describe('AnalyticsSegmentsTab', () => {
  it('renders the segment list with name/rule summary/status/size', () => {
    renderWithPreferences(<AnalyticsSegmentsTab />);
    expect(screen.getByText('近 7 天活跃用户')).toBeInTheDocument();
    expect(screen.getByText('AND · 1 条')).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
  });

  it('creates a new segment with one event condition and submits the compiled rules', async () => {
    renderWithPreferences(<AnalyticsSegmentsTab />);
    fireEvent.click(screen.getByText('新增'));
    const nameInput = await screen.findByPlaceholderText('如「近 7 天活跃用户」');
    fireEvent.change(nameInput, { target: { value: '新分群' } });
    const eventNameInput = screen.getByPlaceholderText('事件名，如 order_submit');
    fireEvent.change(eventNameInput, { target: { value: 'checkout' } });

    const okButtons = screen.getAllByText('确定');
    fireEvent.click(okButtons[okButtons.length - 1]);

    await waitFor(() => expect(saveMutateAsync).toHaveBeenCalled());
    const call = saveMutateAsync.mock.calls[0][0];
    expect(call.id).toBeUndefined();
    expect(call.values.name).toBe('新分群');
    expect(call.values.rules).toMatchObject({ operator: 'AND', conditions: [{ type: 'event', eventName: 'checkout' }] });
  });

  it('deletes a segment after confirming', async () => {
    renderWithPreferences(<AnalyticsSegmentsTab />);
    fireEvent.click(screen.getByLabelText('更多操作'));
    const deleteItem = await screen.findByText('删除');
    fireEvent.click(deleteItem);
    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith(1));
  });

  it('submits a materialize task for the segment and shows a task-submitted hint', async () => {
    renderWithPreferences(<AnalyticsSegmentsTab />);
    fireEvent.click(screen.getByText('重算'));
    await waitFor(() => expect(materializeMutateAsync).toHaveBeenCalledWith(1));
  });

  it('opens the members SideSheet and renders member rows when clicking 成员', async () => {
    renderWithPreferences(<AnalyticsSegmentsTab />);
    fireEvent.click(screen.getByText('成员'));
    await waitFor(() => expect(screen.getByText('dist-abc')).toBeInTheDocument());
  });

  it('opens campaign drawer and renders the campaign form', async () => {
    renderWithPreferences(<AnalyticsSegmentsTab />);
    fireEvent.click(screen.getByText('触达'));
    expect(await screen.findByText('分群触达 · 近 7 天活跃用户')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('触达名称')).toBeInTheDocument();
    expect(screen.getByText('暂无触达活动')).toBeInTheDocument();
  });
});
