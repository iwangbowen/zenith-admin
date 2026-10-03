import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Children, isValidElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { createTestQueryClient, createWrapper } from '@/test-utils/query-harness';

const state = vi.hoisted(() => ({ delivery: vi.fn(), quality: vi.fn(), events: vi.fn(), deploy: vi.fn(), broadcast: vi.fn() }));
vi.mock('@/hooks/usePreferences', () => ({ usePreferences: () => ({ preferences: { tablePageSize: 10 } }), useOptionalPreferences: () => ({ preferences: { syncPageStateToUrl: false } }) }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: () => false }) }));
vi.mock('@/hooks/useDictItems', () => ({ useDictItems: () => ({ options: [] }) }));
vi.mock('@/hooks/useEditModal', () => ({ useEditModal: () => ({ openCreate: vi.fn(), openEdit: vi.fn(), formApi: { current: null }, visible: false, editing: null, formProps: {} }) }));
vi.mock('@/hooks/useAsyncTasks', () => ({ useMyAsyncTasks: () => ({ tasks: [] }) }));
vi.mock('@/components/ConfigurableTable', () => ({ default: () => null }));
vi.mock('@/components/CronBuilderPopover', () => ({ CronBuilderPopover: () => null }));
vi.mock('@/components/FormTimezoneSelect', () => ({ FormTimezoneSelect: () => null }));
vi.mock('@/components/ExportButton', () => ({ default: () => null }));
vi.mock('@/components/SearchToolbar', () => ({ SearchToolbar: () => null }));
vi.mock('@/components/short-link/InsertShortLinkButton', () => ({ default: () => null }));
vi.mock('@/components/EditFormModal', () => ({ EditFormModal: () => null, EditFormSheet: () => null }));
vi.mock('@/components/toolbar-controls', () => ({ CreateButton: () => null, RefreshButton: () => null }));
vi.mock('@/components/list-page', () => ({
  ListSearchToolbar: () => null, listTableProps: () => ({}), deleteAction: () => ({}),
  useRowSelection: () => ({ selectedRowKeys: [], clear: vi.fn(), rowSelection: {} }),
  useStatusToggle: () => ({ column: () => ({}) }), useCrudOperationColumn: () => ({}),
}));
vi.mock('@/components/search-filters', () => ({ FilterSelect: () => null, KeywordInput: () => null, StatusSelect: () => null }));
vi.mock('@douyinfe/semi-ui', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Modal = Object.assign(() => null, { confirm: vi.fn() });
  const Form = Object.assign(Box, { Select: Box, Input: Box, InputNumber: Box, Switch: Box, TextArea: Box, TagInput: Box, Radio: Box });
  return {
    Banner: Box, Button: Box, Card: Box, Col: Box, Row: Box, Divider: Box, Empty: Box, Space: Box, Tag: Box, Spin: Box,
    Form, Modal, SideSheet: () => null, Descriptions: () => null, Toast: { success: vi.fn() }, Typography: { Text: Box, Paragraph: Box, Title: Box },
    Tabs: ({ children, activeKey }: { children: ReactNode; activeKey: string }) => <div>{Children.toArray(children).filter((child) => isValidElement<{ itemKey: string }>(child) && child.props.itemKey === activeKey)}</div>,
    TabPane: ({ tab, children }: { tab: string; children: ReactNode }) => <section aria-label={tab}>{children}</section>,
  };
});
vi.mock('@/hooks/queries/report-subscriptions', () => {
  const query = () => ({ data: undefined, refetch: vi.fn(), isFetching: false });
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    reportSubscriptionKeys: { lists: ['report/subscriptions', 'list'] },
    useReportSubscriptionList: query, useReportSubscriptionDashboardOptions: query, useReportSubscriptionHistory: query,
    useReportDeliveryRunList: (...args: unknown[]) => { state.delivery(...args); return query(); },
    useBatchReportSubscriptionEnabled: mutation, useDeleteReportSubscriptions: mutation, useRunReportSubscription: mutation, useSaveReportSubscription: mutation,
  };
});
vi.mock('@/hooks/queries/report-dq', () => {
  const query = () => ({ data: undefined, refetch: vi.fn(), isFetching: false });
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    reportDqKeys: { lists: ['report/dq', 'rules'] }, useCurrentReportDqScore: query, useReportDqScoreHistory: query, useReportDqAnomalyList: query, useReportDqRuleList: query,
    useReportDqRunList: (...args: unknown[]) => { state.quality(...args); return query(); },
    useDeleteReportDqRule: mutation, useRunReportDqRule: mutation, useSaveReportDqRule: mutation, useToggleReportDqRule: mutation, useUpdateReportDqAnomalyStatus: mutation,
  };
});
vi.mock('@/hooks/queries/report-datasets', () => ({ useEnabledReportDatasets: () => ({ data: [] }) }));
vi.mock('@/hooks/queries/payment-events', () => ({
  paymentEventKeys: { lists: ['payment/events', 'list'] }, usePaymentOpsHealth: () => ({ data: undefined }),
  usePaymentEventList: (...args: unknown[]) => { state.events(...args); return { data: undefined }; }, useRedispatchPaymentEvent: () => ({ isPending: false }),
}));
vi.mock('@/hooks/queries/broadcasts', () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    broadcastKeys: { lists: ['broadcasts', 'list'] }, useBroadcastDetail: () => ({ data: undefined }),
    useBroadcastList: (...args: unknown[]) => { state.broadcast(...args); return { data: undefined }; },
    useDeleteBroadcasts: mutation, useSaveBroadcast: mutation, useSendBroadcast: mutation,
  };
});
vi.mock('@/hooks/queries/deploy', () => {
  const query = () => ({ data: undefined, refetch: vi.fn(), isFetching: false });
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    deployKeys: { runs: ['deploy/runs', 'list'] }, useDeployReleaseList: query, useDeployRunDetail: query, useDeployRunLogs: query, useDeployTargetList: query,
    useDeployRunList: (...args: unknown[]) => { state.deploy(...args); return query(); },
    useCreateDeployRun: mutation, useDeleteDeployTarget: mutation, useSaveDeployTarget: mutation, useSyncDeployTarget: mutation,
  };
});
vi.mock('@/hooks/queries/app-releases', () => ({ useAllClientApps: () => ({ data: [] }), useAppReleaseList: () => ({ data: undefined }) }));
vi.mock('@/hooks/queries/ops-hosts', () => ({ useOpsHosts: () => ({ data: undefined }) }));

import SubscriptionsPage from './report/SubscriptionsPage';
import QualityPage from './report/QualityPage';
import PaymentEventsPage from './payment/PaymentEventsPage';
import DeployPage from './system/deploy/DeployPage';
import BroadcastsPage from './system/broadcasts/BroadcastsPage';

function Location() { const location = useLocation(); return <output aria-label="地址">{location.search}</output>; }
function show(page: ReactNode, url: string) {
  render(<MemoryRouter initialEntries={[url]}>{page}<Location /></MemoryRouter>, { wrapper: createWrapper(createTestQueryClient()) });
}
beforeEach(() => vi.clearAllMocks());

describe('business-job processing deep links', () => {
  it('opens report delivery runs with a failed filter while URL tab synchronization is disabled', async () => {
    show(<SubscriptionsPage />, '/report/subscriptions?tab=runs&status=failed');
    await waitFor(() => expect(state.delivery).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }), true));
    expect(screen.getByRole('region', { name: '投递记录' })).toBeInTheDocument();
    expect(screen.getByLabelText('地址')).toHaveTextContent('');
  });

  it('opens data quality run history with the requested status', async () => {
    show(<QualityPage />, '/report/quality?tab=runs&status=failed');
    await waitFor(() => expect(state.quality).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 10, status: 'failed' })));
    expect(screen.getByRole('region', { name: '运行历史' })).toBeInTheDocument();
  });

  it('applies payment event status and consumes the parameter', async () => {
    show(<PaymentEventsPage />, '/payment/events?status=failed');
    await waitFor(() => expect(state.events).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }), undefined));
    expect(screen.getByLabelText('地址')).toHaveTextContent('');
  });

  it('selects deployment records for a status-only link and applies its filter', async () => {
    show(<DeployPage />, '/system/deploy?status=running');
    await waitFor(() => expect(state.deploy).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'running' }), undefined));
    expect(screen.getByRole('region', { name: '部署记录' })).toBeInTheDocument();
  });

  it('applies sending status to broadcasts', async () => {
    show(<BroadcastsPage />, '/system/broadcasts?status=sending');
    await waitFor(() => expect(state.broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'sending' }), undefined));
  });
});
