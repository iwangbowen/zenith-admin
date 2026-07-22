import { useRef, useState } from 'react';
import { Banner, Button, Form, Input, Tag, Toast, Typography, Tabs, TabPane, Modal, Select, DatePicker } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RefreshCw, SplitSquareHorizontal, Plus, Trash2 } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
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
  useBatchCmsSearchWords, useCmsHotwordGroups, useSaveCmsHotwordGroup, useDeleteCmsHotwordGroup,
  useSaveCmsHotword, useDeleteCmsHotword,
} from '@/hooks/queries/cms';
import { CMS_SEARCH_WORD_TYPES, CMS_SEARCH_WORD_TYPE_LABELS, COMMON_STATUS_OPTIONS } from '@zenith/shared';
import type { CmsSearchResult, CmsSearchWord, CmsHotKeyword } from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';
import { formatDateTimeForApi } from '@/utils/date';

// ─── 检索测试 Tab ─────────────────────────────────────────────────────────────
function SearchTestTab({ siteId, onSiteChange }: Readonly<{ siteId: number | undefined; onSiteChange: (v: number) => void }>) {
  const { hasPermission } = usePermission();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);

  const searchQuery = useCmsSearchTest({ siteId, keyword, page }, !!keyword);
  const segmentQuery = useCmsSegmentPreview(siteId, keyword, !!keyword);
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
    { title: '发布时间', dataIndex: 'publishedAt', width: 180, render: (v: string | null) => v ?? '-' },
  ];

  const taskColumns: ColumnProps[] = [
    { title: '任务', dataIndex: 'title', width: 260 },
    { title: '进度', width: 280, render: (_: unknown, record) => <AsyncTaskProgress task={record} /> },
    { title: '提交时间', dataIndex: 'createdAt', width: 180 },
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
        scroll={{ x: 1080 }}
        pagination={{ currentPage: page, pageSize: 10, total, onPageChange: setPage }}
        onRefresh={() => void searchQuery.refetch()}
        refreshLoading={searchQuery.isFetching}
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
function DictTab({ siteId, onSiteChange }: Readonly<{ siteId: number | undefined; onSiteChange: (value: number) => void }>) {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [type, setType] = useState<'extension' | 'stop' | undefined>(undefined);
  const [groupName, setGroupName] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsSearchWord | null>(null);

  const listQuery = useCmsSearchWordList({
    page, pageSize, siteId: siteId ?? 0, keyword: submittedKeyword || undefined,
    type, groupName: groupName || undefined, status,
  }, siteId !== undefined);
  const saveMutation = useSaveCmsSearchWord();
  const deleteMutation = useDeleteCmsSearchWord();
  const batchMutation = useBatchCmsSearchWords();
  const canManage = hasPermission('cms:search:manage');

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (!editingRecord) values.siteId = siteId;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  }

  const columns: ColumnProps<CmsSearchWord>[] = [
    { title: '词条', dataIndex: 'word', width: 200 },
    { title: '类型', dataIndex: 'type', width: 100, render: (value: CmsSearchWord['type']) => CMS_SEARCH_WORD_TYPE_LABELS[value] },
    { title: '分组', dataIndex: 'groupName', width: 130 },
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
              content: '词典会即时重建；历史内容索引仍建议重新构建',
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
        <CmsSiteSelect value={siteId} onChange={(value) => { onSiteChange(value); setPage(1); }} width={180} />
        <Input prefix={<Search size={14} />} placeholder="搜索词条..." value={draftKeyword} onChange={setDraftKeyword} showClear style={{ width: 200 }}
          onEnterPress={() => { setPage(1); setSubmittedKeyword(draftKeyword); }} />
        <Select placeholder="词典类型" showClear value={type} onChange={(value) => setType(value as 'extension' | 'stop' | undefined)} style={{ width: 120 }}
          optionList={CMS_SEARCH_WORD_TYPES.map((value) => ({ value, label: CMS_SEARCH_WORD_TYPE_LABELS[value] }))} />
        <Input placeholder="分组" value={groupName} onChange={setGroupName} style={{ width: 130 }} />
        <Select placeholder="状态" showClear value={status} onChange={(value) => setStatus(value as string | undefined)} style={{ width: 110 }}
          optionList={COMMON_STATUS_OPTIONS} />
        <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); setSubmittedKeyword(draftKeyword); }}>查询</Button>
        {canManage ? <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingRecord(null); setModalVisible(true); }}>新增词条</Button> : null}
        {canManage && selectedIds.length > 0 ? (
          <>
            <Button onClick={() => void batchMutation.mutateAsync({ action: 'update', body: { ids: selectedIds, status: 'enabled' } }).then(() => setSelectedIds([]))}>批量启用</Button>
            <Button onClick={() => {
              let nextGroup = '';
              Modal.confirm({
                title: '批量调整词典分组',
                content: <Input placeholder="目标分组" onChange={(value) => { nextGroup = value; }} />,
                onOk: async () => {
                  if (!nextGroup.trim()) throw new Error('validation');
                  await batchMutation.mutateAsync({ action: 'update', body: { ids: selectedIds, groupName: nextGroup.trim() } });
                  setSelectedIds([]);
                },
              });
            }}>批量分组</Button>
            <Button type="danger" onClick={() => void batchMutation.mutateAsync({ action: 'delete', body: { ids: selectedIds } }).then(() => setSelectedIds([]))}>批量删除</Button>
          </>
        ) : null}
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
        rowSelection={{ selectedRowKeys: selectedIds.map(String), onChange: (keys) => setSelectedIds((keys ?? []).map(Number)) }}
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
            ? { word: editingRecord.word, type: editingRecord.type, groupName: editingRecord.groupName, weight: editingRecord.weight, status: editingRecord.status, remark: editingRecord.remark ?? '' }
            : { type: 'extension', groupName: '默认分组', weight: 1000, status: 'enabled' }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="word" label="词条" placeholder="如：泽尼斯系统" rules={[{ required: true, message: '请输入词条' }]} />
          <Form.Select field="type" label="类型" optionList={CMS_SEARCH_WORD_TYPES.map((value) => ({ value, label: CMS_SEARCH_WORD_TYPE_LABELS[value] }))} />
          <Form.Input field="groupName" label="分组" />
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
  const [groupId, setGroupId] = useState<number | undefined>(undefined);
  const [keyword, setKeyword] = useState('');
  const [startTime, setStartTime] = useState<Date | undefined>(undefined);
  const [endTime, setEndTime] = useState<Date | undefined>(undefined);
  const groupsQuery = useCmsHotwordGroups(siteId);
  const hotQuery = useCmsHotKeywords({
    siteId,
    groupId,
    keyword: keyword || undefined,
    startTime: startTime ? formatDateTimeForApi(startTime) : undefined,
    endTime: endTime ? formatDateTimeForApi(endTime) : undefined,
  });
  const clearMutation = useClearCmsHotKeywords();
  const saveGroupMutation = useSaveCmsHotwordGroup();
  const deleteGroupMutation = useDeleteCmsHotwordGroup();
  const saveHotwordMutation = useSaveCmsHotword();
  const deleteHotwordMutation = useDeleteCmsHotword();
  const canManage = hasPermission('cms:search:manage');

  const columns: ColumnProps<CmsHotKeyword>[] = [
    { title: '排名', width: 80, render: (_: unknown, __: CmsHotKeyword, index: number) => index + 1 },
    { title: '关键词', dataIndex: 'keyword', width: 260 },
    { title: '分组', dataIndex: 'groupName', width: 140, render: (value: string | null) => value ?? '未分组' },
    { title: '搜索次数', dataIndex: 'count', width: 120 },
    { title: '排序', dataIndex: 'sort', width: 90 },
    createOperationColumn<CmsHotKeyword>({
      width: 140,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage && record.id ? [{
        key: 'edit',
        label: '编辑',
        onClick: () => {
          let sort = record.sort;
          let status: 'enabled' | 'disabled' = record.status;
          Modal.confirm({
            title: `编辑热词「${record.keyword}」`,
            content: (
              <div style={{ display: 'grid', gap: 8 }}>
                <Input defaultValue={String(sort)} placeholder="排序" onChange={(value) => { sort = Number(value) || 0; }} />
                <Select defaultValue={status} optionList={COMMON_STATUS_OPTIONS} onChange={(value) => { status = value as 'enabled' | 'disabled'; }} />
              </div>
            ),
            onOk: async () => {
              await saveHotwordMutation.mutateAsync({ id: record.id!, values: { sort, status } });
              Toast.success('热词已更新');
            },
          });
        },
      }, {
        key: 'delete',
        label: '删除',
        danger: true,
        onClick: () => void deleteHotwordMutation.mutateAsync(record.id!).then(() => Toast.success('热词已删除')),
      }] : [],
    }),
  ];

  return (
    <>
      <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }} description="统计前台搜索框的关键词频次（Redis 累计），可用于运营选题与内链词建设。" />
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={onSiteChange} width={180} />
        <Select placeholder="热词分组" showClear value={groupId} onChange={(value) => setGroupId(value as number | undefined)} style={{ width: 150 }}
          optionList={(groupsQuery.data ?? []).map((group) => ({ value: group.id, label: group.name }))} />
        <Input placeholder="关键词" value={keyword} onChange={setKeyword} showClear style={{ width: 150 }} />
        <DatePicker type="dateTime" value={startTime} onChange={(value) => setStartTime(value as Date | undefined)} placeholder="开始时间" />
        <DatePicker type="dateTime" value={endTime} onChange={(value) => setEndTime(value as Date | undefined)} placeholder="结束时间" />
        {canManage && siteId ? (
          <Button icon={<Plus size={14} />} onClick={() => {
            let name = '';
            Modal.confirm({
              title: '新建热词分组',
              content: <Input placeholder="分组名称" onChange={(value) => { name = value; }} />,
              onOk: async () => {
                if (!name.trim()) throw new Error('validation');
                await saveGroupMutation.mutateAsync({ values: { siteId, name: name.trim(), sort: 0, status: 'enabled' } });
                Toast.success('分组已创建');
              },
            });
          }}>新建分组</Button>
        ) : null}
        {canManage && siteId ? (
          <Button type="primary" icon={<Plus size={14} />} onClick={() => {
            let word = '';
            Modal.confirm({
              title: '添加可管理热词',
              content: <Input placeholder="热词" onChange={(value) => { word = value; }} />,
              onOk: async () => {
                if (!word.trim()) throw new Error('validation');
                await saveHotwordMutation.mutateAsync({ values: { siteId, groupId: groupId ?? null, keyword: word.trim(), sort: 0, status: 'enabled' } });
                Toast.success('热词已添加');
              },
            });
          }}>添加热词</Button>
        ) : null}
        {canManage && groupId ? (
          <Button onClick={() => {
            const current = groupsQuery.data?.find((group) => group.id === groupId);
            let name = current?.name ?? '';
            Modal.confirm({
              title: '重命名当前热词分组',
              content: <Input defaultValue={name} onChange={(value) => { name = value; }} />,
              onOk: async () => {
                if (!name.trim()) throw new Error('validation');
                await saveGroupMutation.mutateAsync({ id: groupId, values: { name: name.trim() } });
                Toast.success('分组已更新');
              },
            });
          }}>重命名分组</Button>
        ) : null}
        {canManage && groupId ? (
          <Button type="danger" onClick={() => {
            Modal.confirm({
              title: '删除当前热词分组？',
              content: '仅空分组可删除。',
              onOk: async () => {
                await deleteGroupMutation.mutateAsync(groupId);
                setGroupId(undefined);
                Toast.success('分组已删除');
              },
            });
          }}>删除分组</Button>
        ) : null}
        {canManage && siteId ? (
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
          <DictTab siteId={siteId} onSiteChange={setSiteId} />
        </TabPane>
        <TabPane tab="搜索热词" itemKey="hot">
          <HotKeywordsTab siteId={siteId} onSiteChange={setSiteId} />
        </TabPane>
      </Tabs>
    </div>
  );
}
