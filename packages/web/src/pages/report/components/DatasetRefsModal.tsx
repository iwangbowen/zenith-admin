import { Empty, Spin, Tag, Typography, Space } from '@douyinfe/semi-ui';
import { Database, LayoutDashboard, Printer, BellPlus } from 'lucide-react';
import AppModal from '@/components/AppModal';
import type { ReportDataset } from '@zenith/shared';
import { useReportDatasetRefs } from '@/hooks/queries/report-datasets';

interface Props {
  dataset: ReportDataset | null;
  onClose: () => void;
}

/** 数据集血缘弹窗：上游数据源 + 下游引用（仪表盘/打印模板/预警） */
export function DatasetRefsModal({ dataset, onClose }: Readonly<Props>) {
  const refsQuery = useReportDatasetRefs(dataset?.id, !!dataset);
  const refs = refsQuery.data ?? null;
  const empty = refs && !refs.dashboards.length && !refs.printTemplates.length && !refs.alerts.length;

  return (
    <AppModal title={`血缘分析 · ${dataset?.name ?? ''}`} visible={!!dataset} onCancel={onClose} onOk={onClose} okText="关闭" width={620} fullscreenable={false}>
      {refsQuery.isFetching && !refs ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin /></div>
      ) : (
        <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
          <div>
            <Typography.Title heading={6} style={{ margin: '0 0 8px' }}><Database size={14} style={{ marginRight: 6, verticalAlign: -2 }} />上游数据源</Typography.Title>
            <Tag color="blue">{dataset?.datasourceName || `#${dataset?.datasourceId}`}</Tag>
          </div>
          <div style={{ width: '100%' }}>
            <Typography.Title heading={6} style={{ margin: '0 0 8px' }}>下游引用</Typography.Title>
            {empty ? (
              <Empty description="暂无下游引用，删除该数据集不会影响其它资源" style={{ padding: '12px 0' }} />
            ) : (
              <Space vertical align="start" spacing={12} style={{ width: '100%' }}>
                {refs?.dashboards.map((d) => (
                  <div key={`dash-${d.id}`}>
                    <Typography.Text strong><LayoutDashboard size={13} style={{ marginRight: 4, verticalAlign: -2 }} />仪表盘《{d.name}》</Typography.Text>
                    <div style={{ marginTop: 4 }}>
                      {d.widgets.map((w) => <Tag key={`w-${w}`} size="small" style={{ marginRight: 4, marginBottom: 4 }}>组件：{w}</Tag>)}
                      {d.filterIds.map((f) => <Tag key={`f-${f}`} size="small" color="amber" style={{ marginRight: 4, marginBottom: 4 }}>筛选器：{f}</Tag>)}
                    </div>
                  </div>
                ))}
                {refs?.printTemplates.map((t) => (
                  <Typography.Text key={`print-${t.id}`}><Printer size={13} style={{ marginRight: 4, verticalAlign: -2 }} />打印报表《{t.name}》</Typography.Text>
                ))}
                {refs?.alerts.map((a) => (
                  <Typography.Text key={`alert-${a.id}`}><BellPlus size={13} style={{ marginRight: 4, verticalAlign: -2 }} />预警规则《{a.name}》</Typography.Text>
                ))}
              </Space>
            )}
          </div>
        </Space>
      )}
    </AppModal>
  );
}

export default DatasetRefsModal;
