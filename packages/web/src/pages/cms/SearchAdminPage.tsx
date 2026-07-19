import { useRef, useState } from 'react';
import { Banner, Button, Form, Input, Tag, Toast, Typography, Tabs, TabPane, Modal } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RefreshCw, SplitSquareHorizontal, Plus, Trash2 } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import {
  useCmsSearchTest, useCmsSegmentPreview, useCmsSearchReindex,
  useCmsSearchWordList, useSaveCmsSearchWord, useDeleteCmsSearchWord,
  useCmsHotKeywords, useClearCmsHotKeywords,
} from '@/hooks/queries/cms';
import type { CmsSearchResult, CmsSearchWord, CmsHotKeyword } from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';

// ─── 检索测试 Tab ─────────────────────────────────────────────────────────────
function SearchTestTab({ siteId, onSiteChange }: Readonly<{ siteId: number | undefined; onSiteChange: (v: number) => void }>) {
  const { hasPermission } = usePermission();
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
    <>
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={(v) => { onSiteChange(v); setPage(1); }} width={180} />
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
          <Button icon={<RefreshCw size={14} />} loading={reindexMutation.isPending} onClick={() => void handleReindex()}>
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
        pagination={{ currentPage: page, pageSize: 10, total, onPageChange: setPage }}
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
    </>
  );
}

// ─── 自定义词典 Tab ───────────────────────────────────────────────────────────
function DictTab() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsSearchWord | null>(null);

  const listQuery = useCmsSearchWordList({ page, pageSize, keyword: submittedKeyword || undefined });
  const saveMutation = useSaveCmsSearchWord();
  const deleteMutation = useDeleteCmsSearchWord();
  const canManage = hasPermission('cms:search:manage');

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  }

  const columns: ColumnProps<CmsSearchWord>[] = [
    { title: '词条', dataIndex: 'word', width: 200 },
    { title: '词频权重', dataIndex: 'weight', width: 110 },
    { title: '备注', dataIndex: 'remark', width: 220, render: (v: string | null) => v ?? '-' },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="red" size="small">停用</Tag>),
    },
    {
      title: '操作', width: 140, fixed: 'right',
      render: (_: unknown, record: CmsSearchWord) => canManage ? (
        <span style={{ display: 'flex', gap: 4 }}>
          <Button theme="borderless" size="small" onClick={() => { setEditingRecord(record); setModalVisible(true); }}>编辑</Button>
          <Button theme="borderless" type="danger" size="small" onClick={() => {
            Modal.confirm({
              title: '确定要删除该词条吗？',
              content: '词条删除后需重启服务或重建索引才完全失效',
              onOk: async () => {
                await deleteMutation.mutateAsync(record.id);
                Toast.success('删除成功');
              },
            });
          }}>删除</Button>
        </span>
      ) : null,
    },
  ];

  return (
    <>
      <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }} description="自定义词典用于纠正分词（如品牌名、行业术语）。新增/修改即时对新内容生效；历史内容需在「检索测试」中重建索引。" />
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="搜索词条..." value={draftKeyword} onChange={setDraftKeyword} showClear style={{ width: 200 }}
          onEnterPress={() => { setPage(1); setSubmittedKeyword(draftKeyword); }} />
        <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); setSubmittedKeyword(draftKeyword); }}>查询</Button>
        {canManage ? <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingRecord(null); setModalVisible(true); }}>新增词条</Button> : null}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无自定义词条"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />
      <AppModal
        title={editingRecord ? '编辑词条' : '新增词条'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={480}
        closeOnEsc
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={editingRecord
            ? { word: editingRecord.word, weight: editingRecord.weight, status: editingRecord.status, remark: editingRecord.remark ?? '' }
            : { weight: 1000, status: 'enabled' }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="word" label="词条" placeholder="如：泽尼斯系统" rules={[{ required: true, message: '请输入词条' }]} />
          <Form.InputNumber field="weight" label="词频权重" min={1} max={999999} style={{ width: 180 }} extraText="越大越优先成词，默认 1000" />
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
          <Form.Input field="remark" label="备注" />
        </Form>
      </AppModal>
    </>
  );
}

// ─── 搜索热词 Tab ─────────────────────────────────────────────────────────────
function HotKeywordsTab({ siteId, onSiteChange }: Readonly<{ siteId: number | undefined; onSiteChange: (v: number) => void }>) {
  const { hasPermission } = usePermission();
  const hotQuery = useCmsHotKeywords(siteId);
  const clearMutation = useClearCmsHotKeywords();

  const columns: ColumnProps<CmsHotKeyword>[] = [
    { title: '排名', width: 80, render: (_: unknown, __: CmsHotKeyword, index: number) => index + 1 },
    { title: '关键词', dataIndex: 'keyword', width: 260 },
    { title: '搜索次数', dataIndex: 'count', width: 120 },
  ];

  return (
    <>
      <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }} description="统计前台搜索框的关键词频次（Redis 累计），可用于运营选题与内链词建设。" />
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={onSiteChange} width={180} />
        {hasPermission('cms:search:manage') && siteId ? (
          <Button type="danger" icon={<Trash2 size={14} />} onClick={() => {
            Modal.confirm({
              title: '清空当前站点的搜索热词？',
              onOk: async () => {
                await clearMutation.mutateAsync(siteId);
                Toast.success('已清空');
                void hotQuery.refetch();
              },
            });
          }}>清空热词</Button>
        ) : null}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={hotQuery.data ?? []}
        loading={hotQuery.isFetching}
        rowKey="keyword"
        size="small"
        empty="暂无搜索记录"
        onRefresh={() => void hotQuery.refetch()}
        refreshLoading={hotQuery.isFetching}
        pagination={false}
      />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function SearchAdminPage() {
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useState('test');

  return (
    <div className="page-container page-tabs-page">
      <Tabs activeKey={activeTab} onChange={setActiveTab} type="line" lazyRender keepDOM={false}>
        <TabPane tab="检索测试" itemKey="test">
          <SearchTestTab siteId={siteId} onSiteChange={setSiteId} />
        </TabPane>
        <TabPane tab="自定义词典" itemKey="dict">
          <DictTab />
        </TabPane>
        <TabPane tab="搜索热词" itemKey="hot">
          <HotKeywordsTab siteId={siteId} onSiteChange={setSiteId} />
        </TabPane>
      </Tabs>
    </div>
  );
}
