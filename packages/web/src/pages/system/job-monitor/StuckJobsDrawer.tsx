import { Banner, SideSheet, Space, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import type { JobSourceSummary, JobStuckItem } from '@zenith/shared/platform';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { useJobMonitorStuck } from '@/hooks/queries/job-monitor';
import { copyableNoColumn, dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { formatAge } from './job-monitor-shared';

export default function StuckJobsDrawer({ source, onClose }: Readonly<{
  source: JobSourceSummary | null;
  onClose: () => void;
}>) {
  const navigate = useNavigate();
  const query = useJobMonitorStuck(source?.key, source !== null);
  return (
    <SideSheet title={`${source?.title ?? '作业'} · 卡死明细`} visible={source !== null} onCancel={onClose} width={1200}>
      <div className="zx-flat-panels">
        <Space vertical align="start" spacing={12} style={{ width: '100%' }}>
          <Typography.Text type="tertiary">本应被系统自动推进或回收、超过该作业源阈值仍未推进的作业。最多展示 50 条。</Typography.Text>
          {query.isError && <Banner type="warning" closeIcon={null} description={`卡死明细加载失败：${query.error?.message ?? '未知错误'}`} />}
        </Space>
        <ConfigurableTable<JobStuckItem>
          rowKey="refId"
          pagination={false}
          dataSource={query.data ?? []}
          loading={source !== null && query.isPending}
          onRefresh={() => { void query.refetch(); }}
          refreshLoading={query.isFetching}
          empty="暂无卡死作业，作业可能已被推进或回收"
          columns={[
            copyableNoColumn('引用 ID', 'refId', { width: 180 }),
            { title: '标题', dataIndex: 'title', minWidth: 220, render: renderEllipsis },
            { title: '状态', dataIndex: 'status', width: 100 },
            dateTimeColumn('开始时间', 'startedAt'),
            dateTimeColumn('最后活动', 'lastSeenAt'),
            { title: '已持续', dataIndex: 'ageSec', width: 120, render: (value: number) => formatAge(value) },
            { title: '节点', dataIndex: 'nodeId', width: 160, render: renderEllipsis },
            { title: '详情', dataIndex: 'detail', width: 240, render: renderEllipsis },
            createOperationColumn<JobStuckItem>({
              width: 110,
              emptyContent: EMPTY_PLACEHOLDER,
              actions: (item) => [{ key: 'process', label: '前往处理', hidden: item.drillDown === null, onClick: () => { if (item.drillDown) navigate(item.drillDown.path); } }],
            }),
          ]}
        />
      </div>
    </SideSheet>
  );
}
