import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Tag, Toast, Modal, Tabs, TabPane, Tree, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useIsMobile } from '@/hooks/useMediaQuery';
import {
  useCmsChannelTree, useCmsContentList, useCmsContentAction, useCmsContentBatch,
  useAllCmsSites, cmsContentKeys,
} from '@/hooks/queries/cms';
import { CMS_CONTENT_STATUS_LABELS } from '@zenith/shared';
import type { CmsChannel, CmsContent, CmsContentStatus } from '@zenith/shared';
import { CmsSiteSelect, cmsPreviewUrl } from './CmsSiteSelect';

const STATUS_COLORS: Record<CmsContentStatus, 'grey' | 'orange' | 'green' | 'red' | 'violet'> = {
  draft: 'grey',
  pending: 'orange',
  published: 'green',
  offline: 'violet',
  rejected: 'red',
};

type TabKey = 'all' | 'pending' | 'published' | 'recycle';

function channelsToTree(nodes: CmsChannel[]): TreeNodeData[] {
  return nodes.map((n) => ({
    key: String(n.id),
    label: n.name,
    children: n.children ? channelsToTree(n.children) : undefined,
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
    keyword: submittedKeyword || undefined,
    deleted: activeTab === 'recycle' ? true : undefined,
  }, siteId !== undefined);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const actionMutation = useCmsContentAction();
  const batchMutation = useCmsContentBatch();

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

  async function runBatch(action: 'recycle' | 'restore' | 'purge', ids: number[], successMsg: string) {
    await batchMutation.mutateAsync({ action, ids });
    setSelectedIds([]);
    Toast.success(successMsg);
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
          {record.isTop ? <Tag size="small" color="blue" style={{ marginRight: 4 }}>顶</Tag> : null}
          {record.isRecommend ? <Tag size="small" color="cyan" style={{ marginRight: 4 }}>荐</Tag> : null}
          {record.isHot ? <Tag size="small" color="red" style={{ marginRight: 4 }}>热</Tag> : null}
          <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 240, verticalAlign: 'middle' }}>{v}</Typography.Text>
        </span>
      ),
    },
    { title: '栏目', dataIndex: 'channelName', width: 110 },
    { title: '作者', dataIndex: 'author', width: 90, render: (v: string | null) => v ?? '-' },
    { title: '浏览', dataIndex: 'viewCount', width: 80 },
    { title: '发布时间', dataIndex: 'publishedAt', width: 150, render: (v: string | null) => v ?? '-' },
    { title: '更新时间', dataIndex: 'updatedAt', width: 150 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (v: CmsContentStatus) => <Tag size="small" color={STATUS_COLORS[v]}>{CMS_CONTENT_STATUS_LABELS[v]}</Tag>,
    },
    createOperationColumn<CmsContent>({
      width: 220,
      desktopInlineKeys: activeTab === 'recycle' ? ['restore', 'purge'] : ['edit', 'publish'],
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

  const batchBar = activeTab === 'recycle' && selectedIds.length > 0 && hasPermission('cms:content:delete') ? (
    <>
      <Button onClick={() => void runBatch('restore', selectedIds, `已恢复 ${selectedIds.length} 条`)}>批量恢复</Button>
      <Button type="danger" onClick={() => {
        Modal.confirm({ title: `彻底删除 ${selectedIds.length} 条内容？`, content: '删除后不可恢复', onOk: () => runBatch('purge', selectedIds, '已彻底删除') });
      }}>批量删除</Button>
    </>
  ) : null;

  const tableContent = (
    <>
      <SearchToolbar
        primary={(
          <>
            <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setChannelId(undefined); setPage(1); }} width={180} />
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderResetButton()}
            {batchBar}
          </>
        )}
        actions={renderCreateButton()}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={<CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setChannelId(undefined); setPage(1); }} width={180} />}
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
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
        rowSelection={activeTab === 'recycle' ? {
          selectedRowKeys: selectedIds.map(String),
          onChange: (keys) => setSelectedIds((keys ?? []).map(Number)),
        } : undefined}
      />
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
            <TabPane tab="回收站" itemKey="recycle">{tableContent}</TabPane>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
