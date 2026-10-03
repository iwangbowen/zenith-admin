import { Tag } from '@douyinfe/semi-ui';
import { enumValueOf } from '@zenith/shared/core';
import { REPORT_DELIVERY_STATUSES, REPORT_DELIVERY_STATUS_LABELS, REPORT_DELIVERY_STATUS_OPTIONS, REPORT_DELIVERY_TRIGGER_LABELS, reportDeliveryRunContract, type ReportDeliveryRun, type ReportDeliveryStatus } from '@zenith/shared/report';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar } from '@/components/list-page';
import { StatusSelect } from '@/components/search-filters';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { useListPage } from '@/hooks/useListPage';
import { useReportDeliveryRunList } from '@/hooks/queries/report-subscriptions';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';

const STATUS_COLORS: Record<ReportDeliveryStatus, 'grey' | 'blue' | 'green' | 'orange' | 'red'> = {
  pending: 'grey', running: 'blue', success: 'green', partial: 'orange', failed: 'red', cancelled: 'grey',
};

export default function SubscriptionRunsView({ active }: Readonly<{ active: boolean }>) {
  const page = useListPage({ op: reportDeliveryRunContract.list, useList: useReportDeliveryRunList, enabled: active, table: { empty: '暂无投递记录' } });
  useListDeepLink(['status'], (picked) => page.applySearch({ status: enumValueOf(REPORT_DELIVERY_STATUSES, picked.status) }));
  return (
    <>
      <ListSearchToolbar page={page} filters={['status']} overrides={{ status: (list) => <StatusSelect items={REPORT_DELIVERY_STATUS_OPTIONS} {...list.bind('status')} /> }} />
      <ConfigurableTable<ReportDeliveryRun> {...page.tableProps} columns={[
        { title: 'ID', dataIndex: 'id', width: 80 },
        { title: '投递目标', dataIndex: 'targetName', minWidth: 180, render: renderEllipsis },
        { title: '触发方式', dataIndex: 'triggerType', width: 100, render: (value: ReportDeliveryRun['triggerType']) => REPORT_DELIVERY_TRIGGER_LABELS[value] },
        dateTimeColumn('开始时间', 'startedAt'), dateTimeColumn('完成时间', 'completedAt'), dateTimeColumn('下次重试', 'nextRetryAt'),
        { title: '错误', dataIndex: 'errorMessage', width: 260, render: renderEllipsis },
        { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: (status: ReportDeliveryStatus) => <Tag color={STATUS_COLORS[status]}>{REPORT_DELIVERY_STATUS_LABELS[status]}</Tag> },
      ]} />
    </>
  );
}
