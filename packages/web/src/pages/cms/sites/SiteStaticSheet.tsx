/**
 * 站点静态化 SideSheet（原独立「静态化管理」页面整合至此）。
 * 面板在打开时才挂载，任务列表轮询随关闭停止。
 */
import { Button, SideSheet, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ExternalLink, Zap } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import { useCmsStaticBuild } from '@/hooks/queries/cms';
import type { CmsSite } from '@zenith/shared/cms';
import type { AsyncTask } from '@zenith/shared/tasks';
import { cmsPreviewUrl } from '../CmsSiteSelect';

/** 站点静态化面板（SideSheet 打开时才挂载，任务列表轮询随关闭停止） */
function SiteStaticPanel({ site, canBuild }: { site: CmsSite; canBuild: boolean }) {
  const buildMutation = useCmsStaticBuild();
  const { tasks, loading, refresh } = useMyAsyncTasks({ taskTypes: ['cms-publish-build'] });
  const siteTasks = tasks.filter((t) => {
    const payload = t.payload as { siteId?: number };
    return payload.siteId === site.id;
  });

  async function handleBuild() {
    await buildMutation.mutateAsync({ body: { siteId: site.id } });
    Toast.success('任务已提交，可在下方列表查看进度');
    void refresh();
  }

  const columns: ColumnProps<AsyncTask>[] = [
    { title: '任务', dataIndex: 'title', width: 200, render: renderEllipsis },
    { title: '进度', width: 190, render: (_: unknown, record) => <AsyncTaskProgress task={record} noteDisplay="tooltip" /> },
    dateTimeColumn('提交时间', 'createdAt'),
    dateTimeColumn('完成时间', 'completedAt'),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {canBuild ? (
          <Button type="primary" icon={<Zap size={14} />} loading={buildMutation.isPending} onClick={() => void handleBuild()}>
            全站生成
          </Button>
        ) : null}
        <Button icon={<ExternalLink size={14} />} onClick={() => window.open(cmsPreviewUrl(site.code), '_blank')}>访问站点</Button>
      </div>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={siteTasks}
        loading={loading}
        rowKey="id"
        size="small"
        empty="该站点暂无静态化任务"
        onRefresh={() => void refresh()}
        refreshLoading={loading}
        pagination={false}
      />
    </div>
  );
}

interface SiteStaticSheetProps {
  readonly site: CmsSite | null;
  readonly canBuild: boolean;
  readonly onClose: () => void;
}

export default function SiteStaticSheet({ site, canBuild, onClose }: Readonly<SiteStaticSheetProps>) {
  return (
    <SideSheet
      title={site ? `静态化 —「${site.name}」` : '静态化'}
      visible={!!site}
      onCancel={onClose}
      width={820}
      closeOnEsc
    >
      {site ? (
        <div style={{ paddingTop: 8 }}>
          <SiteStaticPanel site={site} canBuild={canBuild} />
        </div>
      ) : null}
    </SideSheet>
  );
}
