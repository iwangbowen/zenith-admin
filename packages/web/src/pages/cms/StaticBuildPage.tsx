import { useState } from 'react';
import { Banner, Button, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Zap, ExternalLink } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { SearchToolbar } from '@/components/SearchToolbar';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import { usePermission } from '@/hooks/usePermission';
import { useCmsStaticBuild, useAllCmsSites } from '@/hooks/queries/cms';
import { CMS_STATIC_MODE_LABELS } from '@zenith/shared';
import type { AsyncTask } from '@zenith/shared';
import { CmsSiteSelect, cmsPreviewUrl } from './CmsSiteSelect';

export default function StaticBuildPage() {
  const { hasPermission } = usePermission();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const { data: sites } = useAllCmsSites();
  const currentSite = sites?.find((s) => s.id === siteId);
  const buildMutation = useCmsStaticBuild();
  const { tasks, loading, refresh } = useMyAsyncTasks({ taskTypes: ['cms-static-build'] });

  async function handleBuild() {
    if (!siteId) return;
    await buildMutation.mutateAsync(siteId);
    Toast.success('任务已提交，可在下方列表查看进度');
    refresh();
  }

  const columns: ColumnProps<AsyncTask>[] = [
    { title: '任务', dataIndex: 'title', width: 260 },
    {
      title: '进度',
      width: 280,
      render: (_: unknown, record) => <AsyncTaskProgress task={record} />,
    },
    { title: '提交时间', dataIndex: 'createdAt', width: 180 },
    { title: '完成时间', dataIndex: 'finishedAt', width: 180, render: (v: string | null) => v ?? '-' },
  ];

  return (
    <div className="page-container">
      <Banner
        type="info"
        closeIcon={null}
        style={{ marginBottom: 12 }}
        description={(
          <Typography.Text>
            全站静态化会将 首页、全部栏目分页、全部已发布内容、sitemap.xml、robots.txt 渲染为静态 HTML 文件。
            当前站点静态化模式：<b>{currentSite ? CMS_STATIC_MODE_LABELS[currentSite.staticMode] : '-'}</b>。
            混合模式下内容发布时已自动增量生成，全量生成用于模板/碎片/导航变更后的整站刷新。
          </Typography.Text>
        )}
      />

      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={setSiteId} width={200} />
        {hasPermission('cms:static:build') ? (
          <Button
            type="primary"
            icon={<Zap size={14} />}
            loading={buildMutation.isPending}
            disabled={!siteId}
            onClick={() => void handleBuild()}
          >
            全站生成
          </Button>
        ) : null}
        {currentSite ? (
          <Button icon={<ExternalLink size={14} />} onClick={() => window.open(cmsPreviewUrl(currentSite.code), '_blank')}>
            访问站点
          </Button>
        ) : null}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={tasks}
        loading={loading}
        rowKey="id"
        size="small"
        empty="暂无静态化任务"
        onRefresh={refresh}
        refreshLoading={loading}
        pagination={false}
      />
    </div>
  );
}
