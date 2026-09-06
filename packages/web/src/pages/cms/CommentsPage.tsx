import { useState } from 'react';
import { Button, Tag, Toast, Tabs, TabPane, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useCmsCommentList, useCmsCommentAction } from '@/hooks/queries/cms';
import { CMS_COMMENT_STATUS_LABELS } from '@zenith/shared/cms';
import type { CmsComment, CmsCommentStatus } from '@zenith/shared/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { dateTimeColumn } from '@/utils/table-columns';

import { useUrlTabState } from '@/hooks/useUrlTabState';
import { FilterSelect } from '@/components/search-filters';
import { confirmAndDelete, deleteAction, listTableProps } from '@/components/list-page';
const STATUS_COLORS: Record<CmsCommentStatus, 'orange' | 'green' | 'red'> = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
};

type TabKey = 'pending' | 'approved' | 'rejected' | 'all';

export default function CommentsPage() {
  const { hasPermission } = usePermission();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useUrlTabState(['pending', 'approved', 'rejected', 'all'] as const, 'pending');
  const [source, setSource] = useState<'member' | 'guest' | undefined>(undefined);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const listQuery = useCmsCommentList({
    page,
    pageSize,
    siteId: siteId ?? 0,
    status: activeTab === 'all' ? undefined : activeTab,
    source,
  }, siteId !== undefined);
  const actionMutation = useCmsCommentAction();
  const canAudit = hasPermission('cms:comment:audit');
  const canDelete = hasPermission('cms:comment:delete');

  async function runAction(action: 'approve' | 'reject' | 'delete', ids: number[], successMsg: string) {
    await actionMutation.mutateAsync({ action, ids });
    setSelectedIds([]);
    Toast.success(successMsg);
  }

  function handleTabChange(key: string) {
    setActiveTab(key as TabKey);
    setPage(1);
    setSelectedIds([]);
  }

  const columns: ColumnProps<CmsComment>[] = [
    {
      title: '昵称', dataIndex: 'nickname', width: 170,
      render: (v: string, record: CmsComment) => (
        <span>
          {v}
          {record.memberId != null ? <Tag size="small" color="green" style={{ marginLeft: 6 }}>会员</Tag> : null}
          {record.riskFlag === 'watchlist' ? <Tag size="small" color="orange" style={{ marginLeft: 6 }}>观察主体</Tag> : null}
        </span>
      ),
    },
    {
      title: '评论内容',
      dataIndex: 'content',
      minWidth: 300,
      render: (v: string, record: CmsComment) => (
        <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 280 }}>
          {record.parentId > 0 && record.parentNickname ? `回复 @${record.parentNickname}：${v}` : v}
        </Typography.Text>
      ),
    },
    {
      title: '所属内容',
      dataIndex: 'contentTitle',
      width: 200,
      render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 180 }}>{v ?? '-'}</Typography.Text>,
    },
    { title: '点赞', dataIndex: 'likeCount', width: 80, align: 'right' },
    { title: 'IP', dataIndex: 'ip', width: 130, render: (v: string | null) => v ?? '-' },
    dateTimeColumn('提交时间', 'createdAt'),
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: CmsCommentStatus) => <Tag size="small" color={STATUS_COLORS[v]}>{CMS_COMMENT_STATUS_LABELS[v]}</Tag>,
    },
    createOperationColumn<CmsComment>({
      // 待审核：通过 / 拒绝 / 删除；已拒绝：通过 / 删除；已通过：删除
      width: activeTab === 'approved' ? 100 : activeTab === 'rejected' ? 150 : 210,
      desktopInlineKeys: ['approve', 'reject', 'delete'],
      actions: (record) => [
        ...(canAudit && record.status !== 'approved' ? [{
          key: 'approve', label: '通过',
          onClick: () => void runAction('approve', [record.id], '已通过并刷新页面'),
        }] : []),
        ...(canAudit && record.status === 'pending' ? [{
          key: 'reject', label: '拒绝', danger: true,
          onClick: () => void runAction('reject', [record.id], '已拒绝'),
        }] : []),
        deleteAction({
          hidden: !canDelete,
          title: '确定要删除该评论吗？',
          run: () => runAction('delete', [record.id], '删除成功'),
          successMessage: null,
        }),
      ],
    }),
  ];

  const batchBar = selectedIds.length > 0 ? (
    <>
      {canAudit ? <Button onClick={() => void runAction('approve', selectedIds, `已通过 ${selectedIds.length} 条`)}>批量通过</Button> : null}
      {canAudit ? <Button type="warning" onClick={() => void runAction('reject', selectedIds, `已拒绝 ${selectedIds.length} 条`)}>批量拒绝</Button> : null}
      {canDelete ? (
        <Button type="danger" onClick={() => {
          confirmAndDelete({
            title: `删除 ${selectedIds.length} 条评论？`,
            run: () => runAction('delete', selectedIds, '删除成功'),
            successMessage: null,
          });
        }}>批量删除</Button>
      ) : null}
    </>
  ) : null;

  const tableContent = (
    <>
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setPage(1); setSelectedIds([]); }} width={200} />
        <FilterSelect
          placeholder="全部评论来源"
          items={[{ label: '会员评论', value: 'member' }, { label: '游客评论', value: 'guest' }]}
          value={source}
          onChange={(v) => { setSource(v as 'member' | 'guest' | undefined); setPage(1); setSelectedIds([]); }}
          width={140}
        />
        {batchBar}
      </SearchToolbar>
      <ConfigurableTable<CmsComment>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: (total) => buildPagination(total, () => setSelectedIds([])),
          rowKey: (record) => String(record?.id ?? ''),
          empty: '暂无评论',
          rowSelection: {
            selectedRowKeys: selectedIds.map(String),
            onChange: (keys) => setSelectedIds((keys ?? []).map(Number)),
          },
        })}
      />
    </>
  );

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" activeKey={activeTab} onChange={handleTabChange} type="line" lazyRender keepDOM={false}>
        <TabPane tab="待审核" itemKey="pending">{tableContent}</TabPane>
        <TabPane tab="已通过" itemKey="approved">{tableContent}</TabPane>
        <TabPane tab="已拒绝" itemKey="rejected">{tableContent}</TabPane>
        <TabPane tab="全部" itemKey="all">{tableContent}</TabPane>
      </Tabs>
    </div>
  );
}
