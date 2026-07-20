import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Tag, Toast, Modal, Tabs, TabPane, Tree, Typography, Dropdown, Form, Upload, Select } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { Search, RotateCcw, Plus, ChevronDown, FileUp } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { ExportButton } from '@/components/ExportButton';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useUploadFile } from '@/hooks/queries/files';
import {
  useCmsChannelTree, useCmsContentList, useCmsContentAction, useCmsContentBatch,
  useAllCmsSites, useAllCmsTags, useCmsContentBatchOps, useDuplicateCmsContent, useImportCmsContents, cmsContentKeys,
} from '@/hooks/queries/cms';
import { CMS_CONTENT_STATUS_LABELS, CMS_CONTENT_TYPE_LABELS } from '@zenith/shared';
import type { CmsChannel, CmsContent, CmsContentStatus, CmsContentType } from '@zenith/shared';
import { CmsSiteSelect, cmsPreviewUrl } from './CmsSiteSelect';

const STATUS_COLORS: Record<CmsContentStatus, 'grey' | 'orange' | 'green' | 'red' | 'violet'> = {
  draft: 'grey',
  pending: 'orange',
  published: 'green',
  offline: 'violet',
  rejected: 'red',
};

type TabKey = 'all' | 'pending' | 'published' | 'archived' | 'recycle';

function channelsToTree(nodes: CmsChannel[]): TreeNodeData[] {
  return nodes.map((n) => ({
    key: String(n.id),
    label: n.name,
    children: n.children ? channelsToTree(n.children) : undefined,
  }));
}

function channelsToSelectTree(nodes: CmsChannel[]): TreeNodeData[] {
  return nodes.map((n) => ({
    key: String(n.id),
    value: n.id,
    label: n.name,
    disabled: n.type !== 'list',
    children: n.children ? channelsToSelectTree(n.children) : undefined,
  }));
}

export default function ContentsPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [channelId, setChannelId] = useState<number | undefined>(undefined);
  const [contentType, setContentType] = useState<CmsContentType | undefined>(undefined);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const treeQuery = useCmsChannelTree(siteId);
  const { data: sites } = useAllCmsSites();
  const currentSite = sites?.find((s) => s.id === siteId);

  const statusFilter: CmsContentStatus | undefined =
    activeTab === 'pending' ? 'pending' : activeTab === 'published' ? 'published' : undefined;

  const listQuery = useCmsContentList({
    page,
    pageSize,
    siteId: siteId ?? 0,
    channelId,
    status: statusFilter,
    contentType,
    keyword: submittedKeyword || undefined,
    deleted: activeTab === 'recycle' ? true : undefined,
    archived: activeTab === 'archived' ? true : undefined,
  }, siteId !== undefined);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const actionMutation = useCmsContentAction();
  const batchMutation = useCmsContentBatch();
  const batchOpsMutation = useCmsContentBatchOps();
  const duplicateMutation = useDuplicateCmsContent();
  const uploadMutation = useUploadFile();
  const importMutation = useImportCmsContents();
  const { data: allTags } = useAllCmsTags(siteId);
  const moveFormApi = useRef<FormApi | null>(null);
  const tagFormApi = useRef<FormApi | null>(null);
  const distributeFormApi = useRef<FormApi | null>(null);
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [distributeModalVisible, setDistributeModalVisible] = useState(false);
  const [distributeTargetSiteId, setDistributeTargetSiteId] = useState<number | undefined>(undefined);
  const distributeTargetTreeQuery = useCmsChannelTree(distributeTargetSiteId);

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: cmsContentKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftKeyword('');
    setSubmittedKeyword('');
    setChannelId(undefined);
    setContentType(undefined);
    void queryClient.invalidateQueries({ queryKey: cmsContentKeys.lists });
  }

  function handleTabChange(key: string) {
    setActiveTab(key as TabKey);
    setPage(1);
    setSelectedIds([]);
  }

  async function runAction(id: number, action: 'submit' | 'publish' | 'offline', successMsg: string) {
    await actionMutation.mutateAsync({ id, action });
    Toast.success(successMsg);
  }

  function handleReject(record: CmsContent) {
    let reason = '';
    Modal.confirm({
      title: `驳回「${record.title}」`,
      content: (
        <Input placeholder="请输入驳回原因" onChange={(v) => { reason = v; }} />
      ),
      onOk: async () => {
        if (!reason.trim()) {
          Toast.warning('请输入驳回原因');
          throw new Error('validation');
        }
        await actionMutation.mutateAsync({ id: record.id, action: 'reject', body: { reason } });
        Toast.success('已驳回');
      },
    });
  }

  async function runBatch(action: 'recycle' | 'restore' | 'purge' | 'archive' | 'unarchive', ids: number[], successMsg: string) {
    await batchMutation.mutateAsync({ action, ids });
    setSelectedIds([]);
    Toast.success(successMsg);
  }

  // ─── P3 批量操作 ──────────────────────────────────────────────────────────
  async function handleBatchFlags(flags: Record<string, boolean>, label: string) {
    await batchOpsMutation.mutateAsync({ action: 'batch-flags', body: { ids: selectedIds, ...flags } });
    setSelectedIds([]);
    Toast.success(`已${label} ${selectedIds.length} 条内容`);
  }

  async function handleBatchMoveOk() {
    const values = await moveFormApi.current?.validate().catch(() => null);
    if (!values?.channelId) throw new Error('validation');
    await batchOpsMutation.mutateAsync({ action: 'batch-move', body: { ids: selectedIds, channelId: values.channelId } });
    setSelectedIds([]);
    setMoveModalVisible(false);
    Toast.success('移动成功');
  }

  async function handleBatchTagOk() {
    const values = await tagFormApi.current?.validate().catch(() => null);
    if (!values?.tagIds || (values.tagIds as number[]).length === 0) throw new Error('validation');
    await batchOpsMutation.mutateAsync({ action: 'batch-tag', body: { ids: selectedIds, tagIds: values.tagIds } });
    setSelectedIds([]);
    setTagModalVisible(false);
    Toast.success('打标成功');
  }

  async function handleDistributeOk() {
    const values = await distributeFormApi.current?.validate().catch(() => null);
    if (!values?.targetSiteId || !values?.targetChannelId) throw new Error('validation');
    const mode = (values.mode as 'copy' | 'mapping') ?? 'copy';
    await batchOpsMutation.mutateAsync({ action: 'distribute', body: { ids: selectedIds, targetSiteId: values.targetSiteId, targetChannelId: values.targetChannelId, mode } });
    setSelectedIds([]);
    setDistributeModalVisible(false);
    Toast.success(mode === 'mapping' ? '映射成功（正文将跟随来源内容更新）' : '分发成功（目标站点草稿箱）');
  }

  const channelPathMap = useMemo(() => {
    const map = new Map<number, string>();
    const walk = (nodes: CmsChannel[]) => {
      for (const n of nodes) {
        map.set(n.id, n.path);
        if (n.children) walk(n.children);
      }
    };
    walk(treeQuery.data ?? []);
    return map;
  }, [treeQuery.data]);

  function previewContent(record: CmsContent) {
    if (!currentSite) return;
    const chPath = channelPathMap.get(record.channelId) ?? '';
    window.open(cmsPreviewUrl(currentSite.code, `${chPath}/${record.slug ?? record.id}.html`), '_blank');
  }

  const columns: ColumnProps<CmsContent>[] = [
    {
      title: '标题',
      dataIndex: 'title',
      width: 320,
      render: (v: string, record) => (
        <span>
          {record.isTop ? <Tag size="small" color="blue" style={{ marginRight: 4 }}>{record.topWeight > 0 ? `顶${record.topWeight}` : '顶'}</Tag> : null}
          {record.contentType !== 'article' ? <Tag size="small" color="light-blue" style={{ marginRight: 4 }}>{CMS_CONTENT_TYPE_LABELS[record.contentType]}</Tag> : null}
          {record.isRecommend ? <Tag size="small" color="cyan" style={{ marginRight: 4 }}>荐</Tag> : null}
          {record.isHot ? <Tag size="small" color="red" style={{ marginRight: 4 }}>热</Tag> : null}
          {record.memberId ? <Tag size="small" color="purple" style={{ marginRight: 4 }}>投稿</Tag> : null}
          {record.mappingSourceId ? <Tag size="small" color="teal" style={{ marginRight: 4 }}>映射</Tag> : null}
          {record.isOriginal ? <Tag size="small" color="green" style={{ marginRight: 4 }}>原创</Tag> : null}
          <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 240, verticalAlign: 'middle' }}>{v}</Typography.Text>
        </span>
      ),
    },
    { title: '栏目', dataIndex: 'channelName', width: 110 },
    { title: '作者', dataIndex: 'author', width: 90, render: (v: string | null) => v ?? '-' },
    { title: '浏览', dataIndex: 'viewCount', width: 80 },
    { title: '赞/藏', dataIndex: 'likeCount', width: 90, render: (_: number, record) => `${record.likeCount}/${record.favoriteCount}` },
    { title: '发布时间', dataIndex: 'publishedAt', width: 180, render: (v: string | null) => v ?? '-' },
    { title: '更新时间', dataIndex: 'updatedAt', width: 180 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (v: CmsContentStatus) => <Tag size="small" color={STATUS_COLORS[v]}>{CMS_CONTENT_STATUS_LABELS[v]}</Tag>,
    },
    createOperationColumn<CmsContent>({
      width: 220,
      desktopInlineKeys: activeTab === 'recycle' ? ['restore', 'purge'] : activeTab === 'archived' ? ['unarchive'] : ['edit', 'publish'],
      actions: (record) => activeTab === 'recycle'
        ? [
            ...(hasPermission('cms:content:delete') ? [
              { key: 'restore', label: '恢复', onClick: () => void runBatch('restore', [record.id], '已恢复为草稿') },
              {
                key: 'purge',
                label: '彻底删除',
                danger: true,
                onClick: () => {
                  Modal.confirm({ title: '确定要彻底删除吗？', content: '删除后不可恢复', onOk: () => runBatch('purge', [record.id], '已彻底删除') });
                },
              },
            ] : []),
          ]
        : activeTab === 'archived'
        ? [
            ...(hasPermission('cms:content:update') ? [{
              key: 'unarchive',
              label: '取消归档',
              onClick: () => void runBatch('unarchive', [record.id], '已取消归档'),
            }] : []),
            ...(record.status === 'published' ? [{
              key: 'preview',
              label: '预览',
              onClick: () => previewContent(record),
            }] : []),
          ]
        : [
            ...(hasPermission('cms:content:update') ? [{
              key: 'edit',
              label: '编辑',
              onClick: () => navigate(`/cms/contents/edit?id=${record.id}&siteId=${record.siteId}`),
            }] : []),
            ...(record.status === 'published' ? [{
              key: 'preview',
              label: '预览',
              onClick: () => previewContent(record),
            }] : []),
            ...(hasPermission('cms:content:update') && (record.status === 'draft' || record.status === 'rejected') ? [{
              key: 'submit',
              label: '提交审核',
              onClick: () => void runAction(record.id, 'submit', '已提交审核'),
            }] : []),
            ...(hasPermission('cms:content:publish') && record.status !== 'published' ? [{
              key: 'publish',
              label: '发布',
              onClick: () => void runAction(record.id, 'publish', '发布成功'),
            }] : []),
            ...(hasPermission('cms:content:audit') && record.status === 'pending' ? [{
              key: 'reject',
              label: '驳回',
              danger: true,
              onClick: () => handleReject(record),
            }] : []),
            ...(hasPermission('cms:content:publish') && record.status === 'published' ? [{
              key: 'offline',
              label: '下线',
              danger: true,
              onClick: () => void runAction(record.id, 'offline', '已下线'),
            }] : []),
            ...(hasPermission('cms:content:create') ? [{
              key: 'duplicate',
              label: '复制',
              onClick: () => {
                void duplicateMutation.mutateAsync(record.id).then(() => Toast.success('已复制为草稿'));
              },
            }] : []),
            ...(hasPermission('cms:content:update') && (record.status === 'published' || record.status === 'offline') ? [{
              key: 'archive',
              label: '归档',
              onClick: () => {
                Modal.confirm({ title: `归档「${record.title}」？`, content: '归档后前台详情页保留，但不再出现在栏目列表/首页/标签页等聚合位', onOk: () => runBatch('archive', [record.id], '已归档') });
              },
            }] : []),
            ...(hasPermission('cms:content:delete') ? [{
              key: 'recycle',
              label: '回收站',
              danger: true,
              onClick: () => {
                Modal.confirm({ title: '移入回收站？', content: '已发布内容将同时下线', onOk: () => runBatch('recycle', [record.id], '已移入回收站') });
              },
            }] : []),
          ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索标题/作者..."
      value={draftKeyword}
      onChange={setDraftKeyword}
      showClear
      style={{ width: 220 }}
      onEnterPress={handleSearch}
    />
  );
  const renderTypeFilter = () => (
    <Select
      placeholder="内容形态"
      value={contentType}
      onChange={(v) => { setContentType(v as CmsContentType | undefined); setPage(1); }}
      showClear
      style={{ width: 130 }}
      optionList={Object.entries(CMS_CONTENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );
  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );
  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  );
  const renderCreateButton = () => hasPermission('cms:content:create') && siteId ? (
    <Button type="primary" icon={<Plus size={14} />}
      onClick={() => navigate(`/cms/contents/edit?siteId=${siteId}${channelId ? `&channelId=${channelId}` : ''}`)}>
      新增
    </Button>
  ) : null;
  const renderImportButton = () => hasPermission('cms:content:create') && siteId ? (
    <Upload
      action=""
      accept=".xlsx"
      limit={1}
      showUploadList={false}
      customRequest={async ({ fileInstance, onSuccess, onError }) => {
        if (!channelId) {
          Toast.warning('请先在左侧栏目树选择导入的目标栏目');
          onError?.({ status: 0 });
          return;
        }
        try {
          const formData = new FormData();
          formData.append('file', fileInstance);
          const uploaded = await uploadMutation.mutateAsync({ formData });
          await importMutation.mutateAsync({ fileId: uploaded.id, siteId, channelId });
          Toast.success('导入任务已提交，可在顶栏任务托盘查看进度');
          onSuccess?.({});
        } catch {
          onError?.({ status: 0 });
        }
      }}
    >
      <Button icon={<FileUp size={14} />} loading={uploadMutation.isPending || importMutation.isPending}>
        导入
      </Button>
    </Upload>
  ) : null;
  const renderExportButton = () => siteId ? (
    <ExportButton
      entity="cms.contents"
      query={{
        siteId,
        channelId,
        status: statusFilter,
        keyword: submittedKeyword || undefined,
      }}
    />
  ) : null;

  const batchBar = selectedIds.length > 0 ? (
    activeTab === 'recycle' ? (hasPermission('cms:content:delete') ? (
      <>
        <Button onClick={() => void runBatch('restore', selectedIds, `已恢复 ${selectedIds.length} 条`)}>批量恢复</Button>
        <Button type="danger" onClick={() => {
          Modal.confirm({ title: `彻底删除 ${selectedIds.length} 条内容？`, content: '删除后不可恢复', onOk: () => runBatch('purge', selectedIds, '已彻底删除') });
        }}>批量删除</Button>
      </>
    ) : null) : activeTab === 'archived' ? (hasPermission('cms:content:update') ? (
      <Button onClick={() => void runBatch('unarchive', selectedIds, `已取消归档 ${selectedIds.length} 条`)}>批量取消归档</Button>
    ) : null) : (
      <>
        {hasPermission('cms:content:update') ? (
          <>
            <Button onClick={() => setMoveModalVisible(true)}>批量移动</Button>
            <Button onClick={() => setTagModalVisible(true)}>批量打标</Button>
            <Dropdown
              trigger="click"
              render={(
                <Dropdown.Menu>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isTop: true }, '置顶')}>置顶</Dropdown.Item>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isTop: false }, '取消置顶')}>取消置顶</Dropdown.Item>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isRecommend: true }, '推荐')}>推荐</Dropdown.Item>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isRecommend: false }, '取消推荐')}>取消推荐</Dropdown.Item>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isHot: true }, '设为热门')}>设为热门</Dropdown.Item>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isHot: false }, '取消热门')}>取消热门</Dropdown.Item>
                </Dropdown.Menu>
              )}
            >
              <Button icon={<ChevronDown size={14} />} iconPosition="right">批量属性</Button>
            </Dropdown>
            <Button onClick={() => {
              Modal.confirm({ title: `归档 ${selectedIds.length} 条内容？`, content: '仅已发布/已下线内容会被归档；归档后不参与前台列表聚合', onOk: () => runBatch('archive', selectedIds, '归档完成') });
            }}>批量归档</Button>
          </>
        ) : null}
        {hasPermission('cms:content:create') ? (
          <Button onClick={() => { setDistributeTargetSiteId(undefined); setDistributeModalVisible(true); }}>站群分发</Button>
        ) : null}
        {hasPermission('cms:content:delete') ? (
          <Button type="danger" onClick={() => {
            Modal.confirm({ title: `移入回收站 ${selectedIds.length} 条？`, content: '已发布内容将同时下线', onOk: () => runBatch('recycle', selectedIds, '已移入回收站') });
          }}>批量回收</Button>
        ) : null}
      </>
    )
  ) : null;

  const tableContent = (
    <>
      <SearchToolbar
        primary={(
          <>
            <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setChannelId(undefined); setPage(1); }} width={180} />
            {renderKeywordSearch()}
            {renderTypeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {batchBar}
          </>
        )}
        actions={(
          <>
            {renderExportButton()}
            {renderImportButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setChannelId(undefined); setPage(1); }} width={180} />
            {renderTypeFilter()}
          </>
        )}
        filterTitle="筛选条件"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无内容"
        scroll={{ x: 1320 }}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
        rowSelection={{
          selectedRowKeys: selectedIds.map(String),
          onChange: (keys) => setSelectedIds((keys ?? []).map(Number)),
        }}
      />
      {/* P3 批量操作弹窗 */}
      <AppModal
        title={`批量移动 ${selectedIds.length} 条内容`}
        visible={moveModalVisible}
        onOk={handleBatchMoveOk}
        onCancel={() => setMoveModalVisible(false)}
        okButtonProps={{ loading: batchOpsMutation.isPending }}
        width={480}
        closeOnEsc
      >
        <Form getFormApi={(api) => { moveFormApi.current = api; }} allowEmpty labelPosition="left" labelWidth={90}>
          <Form.TreeSelect field="channelId" label="目标栏目" style={{ width: '100%' }}
            treeData={channelsToSelectTree(treeQuery.data ?? [])}
            rules={[{ required: true, message: '请选择目标栏目' }]} />
        </Form>
      </AppModal>
      <AppModal
        title={`批量打标 ${selectedIds.length} 条内容`}
        visible={tagModalVisible}
        onOk={handleBatchTagOk}
        onCancel={() => setTagModalVisible(false)}
        okButtonProps={{ loading: batchOpsMutation.isPending }}
        width={480}
        closeOnEsc
      >
        <Form getFormApi={(api) => { tagFormApi.current = api; }} allowEmpty labelPosition="left" labelWidth={90}>
          <Form.Select field="tagIds" label="追加标签" multiple style={{ width: '100%' }}
            optionList={(allTags ?? []).map((t) => ({ value: t.id, label: t.name }))}
            rules={[{ required: true, message: '请选择标签' }]} />
        </Form>
      </AppModal>
      <AppModal
        title={`站群分发 ${selectedIds.length} 条内容`}
        visible={distributeModalVisible}
        onOk={handleDistributeOk}
        onCancel={() => setDistributeModalVisible(false)}
        okButtonProps={{ loading: batchOpsMutation.isPending }}
        width={520}
        closeOnEsc
      >
        <Form
          getFormApi={(api) => { distributeFormApi.current = api; }}
          allowEmpty
          labelPosition="left"
          labelWidth={90}
          onValueChange={(values) => {
            if (values.targetSiteId !== distributeTargetSiteId) setDistributeTargetSiteId(values.targetSiteId as number);
          }}
        >
          <Form.Select field="targetSiteId" label="目标站点" style={{ width: '100%' }}
            optionList={(sites ?? []).filter((s) => s.id !== siteId).map((s) => ({ value: s.id, label: s.name }))}
            rules={[{ required: true, message: '请选择目标站点' }]} />
          <Form.TreeSelect field="targetChannelId" label="目标栏目" style={{ width: '100%' }}
            treeData={channelsToSelectTree(distributeTargetTreeQuery.data ?? [])}
            rules={[{ required: true, message: '请选择目标栏目' }]} />
          <Form.RadioGroup field="mode" label="分发方式" initValue="copy">
            <Form.Radio value="copy">独立复制（完整拷贝，分发后独立编辑）</Form.Radio>
            <Form.Radio value="mapping">映射（正文共享来源内容，源改动自动同步）</Form.Radio>
          </Form.RadioGroup>
        </Form>
      </AppModal>
    </>
  );

  return (
    <div className="page-container page-tabs-page">
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {!isMobile && (
          <div style={{ width: 216, flexShrink: 0, background: 'var(--semi-color-bg-1)', borderRadius: 'var(--semi-border-radius-medium)', border: '1px solid var(--semi-color-border)', padding: '8px 4px', maxHeight: 'calc(100vh - 180px)', overflow: 'auto' }}>
            <Tree
              treeData={[{ key: 'all', label: '全部栏目' }, ...channelsToTree(treeQuery.data ?? [])]}
              value={channelId ? String(channelId) : 'all'}
              onSelect={(key) => {
                setChannelId(key === 'all' ? undefined : Number(key));
                setPage(1);
              }}
              defaultExpandAll
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Tabs activeKey={activeTab} onChange={handleTabChange} type="line" lazyRender keepDOM={false}>
            <TabPane tab="全部" itemKey="all">{tableContent}</TabPane>
            <TabPane tab="待审核" itemKey="pending">{tableContent}</TabPane>
            <TabPane tab="已发布" itemKey="published">{tableContent}</TabPane>
            <TabPane tab="归档" itemKey="archived">{tableContent}</TabPane>
            <TabPane tab="回收站" itemKey="recycle">{tableContent}</TabPane>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
