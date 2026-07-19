import { useState } from 'react';
import { Banner, Button, Input, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RefreshCw, SplitSquareHorizontal } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { SearchToolbar } from '@/components/SearchToolbar';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import { usePermission } from '@/hooks/usePermission';
import { useCmsSearchTest, useCmsSegmentPreview, useCmsSearchReindex } from '@/hooks/queries/cms';
import type { CmsSearchResult } from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';

export default function SearchAdminPage() {
  const { hasPermission } = usePermission();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [draftKeyword, setDraftKeyword] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);

  const searchQuery = useCmsSearchTest({ siteId, keyword, page }, !!keyword);
  const segmentQuery = useCmsSegmentPreview(keyword, !!keyword);
  const reindexMutation = useCmsSearchReindex();
  const { tasks, loading: tasksLoading, refresh } = useMyAsyncTasks({ taskTypes: ['cms-search-reindex'] });

  const list = searchQuery.data?.list ?? [];
  const total = searchQuery.data?.total ?? 0;

  function handleSearch() {
    setPage(1);
    setKeyword(draftKeyword.trim());
  }

  async function handleReindex() {
    await reindexMutation.mutateAsync(siteId ?? null);
    Toast.success('索引重建任务已提交');
    refresh();
  }

  const columns: ColumnProps<CmsSearchResult>[] = [
    {
      title: '标题（高亮）',
      dataIndex: 'titleHighlight',
      width: 320,
      render: (v: string) => <span dangerouslySetInnerHTML={{ __html: v }} />,
    },
    {
      title: '摘要片段',
      dataIndex: 'snippet',
      width: 380,
      render: (v: string) => <span dangerouslySetInnerHTML={{ __html: v }} />,
    },
    { title: '栏目', dataIndex: 'channelName', width: 110 },
    { title: '相关度', dataIndex: 'rank', width: 90, render: (v: number) => v.toFixed(4) },
    { title: '发布时间', dataIndex: 'publishedAt', width: 150, render: (v: string | null) => v ?? '-' },
  ];

  const taskColumns: ColumnProps[] = [
    { title: '任务', dataIndex: 'title', width: 260 },
    { title: '进度', width: 280, render: (_: unknown, record) => <AsyncTaskProgress task={record} /> },
    { title: '提交时间', dataIndex: 'createdAt', width: 160 },
  ];

  return (
    <div className="page-container">
      <Banner
        type="info"
        closeIcon={null}
        style={{ marginBottom: 12 }}
        description={(
          <Typography.Text>
            全文检索基于 PostgreSQL tsvector + GIN 索引，中文分词由服务端 jieba 完成（标题权重 A / 关键词摘要 B / 正文 C）。
            内容保存时自动更新索引；批量导入历史数据或调整分词逻辑后可在此重建索引。
          </Typography.Text>
        )}
      />

      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setPage(1); }} width={180} />
        <Input
          prefix={<Search size={14} />}
          placeholder="输入关键词测试检索效果..."
          value={draftKeyword}
          onChange={setDraftKeyword}
          showClear
          style={{ width: 260 }}
          onEnterPress={handleSearch}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>检索测试</Button>
        {hasPermission('cms:search:manage') ? (
          <Button
            icon={<RefreshCw size={14} />}
            loading={reindexMutation.isPending}
            onClick={() => void handleReindex()}
          >
            重建索引{siteId ? '（当前站点）' : '（全部站点）'}
          </Button>
        ) : null}
      </SearchToolbar>

      {keyword && segmentQuery.data ? (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <SplitSquareHorizontal size={14} style={{ color: 'var(--semi-color-text-2)' }} />
          <Typography.Text type="secondary" size="small">分词结果：</Typography.Text>
          {segmentQuery.data.tokens.map((t) => <Tag key={t} size="small" color="blue">{t}</Tag>)}
          <Typography.Text type="secondary" size="small">命中 {total} 条</Typography.Text>
        </div>
      ) : null}

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={searchQuery.isFetching}
        rowKey="id"
        size="small"
        empty={keyword ? '未检索到内容' : '输入关键词开始检索测试'}
        pagination={{
          currentPage: page,
          pageSize: 10,
          total,
          onPageChange: setPage,
        }}
      />

      <Typography.Title heading={6} style={{ margin: '20px 0 8px' }}>索引重建任务</Typography.Title>
      <ConfigurableTable
        bordered
        columns={taskColumns}
        dataSource={tasks}
        loading={tasksLoading}
        rowKey="id"
        size="small"
        empty="暂无重建任务"
        onRefresh={refresh}
        refreshLoading={tasksLoading}
        pagination={false}
      />
    </div>
  );
}
