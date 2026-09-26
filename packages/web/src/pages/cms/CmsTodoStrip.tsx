import { useNavigate } from 'react-router-dom';
import { Card, Typography } from '@douyinfe/semi-ui';
import { usePermission } from '@/hooks/usePermission';
import { useCmsEditorialMetrics } from '@/hooks/queries/cms-editorial';
import { cmsContentsViewUrl } from './cms-contents-view';

interface TodoItem {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** 非零时的强调色 */
  readonly accent: string;
  readonly to: string;
}

/**
 * 数据看板待办条：内容生产指标中有行动价值的五项，一行展示、点击直达对应筛选。
 * 无 cms:content:list 权限或取数失败时不渲染（看板本身只需要 dashboard:view）。
 */
export default function CmsTodoStrip({ siteId }: Readonly<{ siteId: number | undefined }>) {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const metricsQuery = useCmsEditorialMetrics(hasPermission('cms:content:list') ? siteId : undefined);
  const metrics = metricsQuery.data;
  if (!siteId || !metrics) return null;

  const items: TodoItem[] = [
    { key: 'pending', label: '待审核', value: metrics.pending, accent: 'var(--semi-color-warning)', to: cmsContentsViewUrl(siteId, { tab: 'pending' }) },
    { key: 'overdue', label: '逾期事项', value: metrics.overdue, accent: 'var(--semi-color-danger)', to: cmsContentsViewUrl(siteId, { overdue: true }) },
    { key: 'scheduled', label: '已排期', value: metrics.scheduled, accent: 'var(--semi-color-primary)', to: cmsContentsViewUrl(siteId, { scheduled: true }) },
    { key: 'unpublished', label: '未发布修改', value: metrics.unpublishedChanges, accent: 'var(--semi-color-warning)', to: cmsContentsViewUrl(siteId, { hasUnpublishedChanges: true }) },
    { key: 'notes', label: '待处理批注', value: metrics.unresolvedNotes, accent: 'var(--semi-color-warning)', to: cmsContentsViewUrl(siteId, { hasUnresolvedNotes: true }) },
  ];

  return (
    <Card bodyStyle={{ padding: '10px 4px' }} style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => navigate(item.to)}
            title={`查看${item.label}`}
            style={{
              flex: '1 1 0',
              minWidth: 120,
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'center',
              gap: 8,
              padding: '2px 12px',
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            <Typography.Text size="small" type="tertiary">{item.label}</Typography.Text>
            <span style={{ fontSize: 20, fontWeight: 700, color: item.value > 0 ? item.accent : 'var(--semi-color-text-2)' }}>
              {item.value}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}
