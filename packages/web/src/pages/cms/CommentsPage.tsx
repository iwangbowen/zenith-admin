import { useState } from 'react';
import { Button, Tag, Toast, Modal, Tabs, TabPane, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useCmsCommentList, useCmsCommentAction } from '@/hooks/queries/cms';
import { CMS_COMMENT_STATUS_LABELS } from '@zenith/shared';
import type { CmsComment, CmsCommentStatus } from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';

const STATUS_COLORS: Record<CmsCommentStatus, 'orange' | 'green' | 'red'> = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
};

type TabKey = 'pending' | 'approved' | 'rejected' | 'all';

export default function CommentsPage() {
  const { hasPermission } = usePermission();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const listQuery = useCmsCommentList({
    page,
    pageSize,
    siteId: siteId ?? 0,
    status: activeTab === 'all' ? undefined : activeTab,
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
    { title: '昵称', dataIndex: 'nickname', width: 120 },
    {
      title: '评论内容',
      dataIndex: 'content',
      width: 340,
      render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 320 }}>{v}</Typography.Text>,
    },
    {
      title: '所属内容',
      dataIndex: 'contentTitle',
      width: 220,
      render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 200 }}>{v ?? '-'}</Typography.Text>,
    },
    { title: 'IP', dataIndex: 'ip', width: 130, render: (v: string | null) => v ?? '-' },
    { title: '提交时间', dataIndex: 'createdAt', width: 170 },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: CmsCommentStatus) => <Tag size="small" color={STATUS_COLORS[v]}>{CMS_COMMENT_STATUS_LABELS[v]}</Tag>,
    },
    createOperationColumn<CmsComment>({
      width: 190,
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
        ...(canDelete ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            Modal.confirm({ title: '确定要删除该评论吗？', onOk: () => runAction('delete', [record.id], '删除成功') });
          },
        }] : []),
      ],
    }),
  ];

  const batchBar = selectedIds.length > 0 ? (
    <>
      {canAudit ? <Button onClick={() => void runAction('approve', selectedIds, `已通过 ${selectedIds.length} 条`)}>批量通过</Button> : null}
      {canAudit ? <Button type="warning" onClick={() => void runAction('reject', selectedIds, `已拒绝 ${selectedIds.length} 条`)}>批量拒绝</Button> : null}
      {canDelete ? (
        <Button type="danger" onClick={() => {
          Modal.confirm({ title: `删除 ${selectedIds.length} 条评论？`, onOk: () => runAction('delete', selectedIds, '删除成功') });
        }}>批量删除</Button>
      ) : null}
    </>
  ) : null;

  const tableContent = (
    <>
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setPage(1); }} width={200} />
        {batchBar}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无评论"
        scroll={{ x: 1310 }}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
        rowSelection={{
          selectedRowKeys: selectedIds.map(String),
          onChange: (keys) => setSelectedIds((keys ?? []).map(Number)),
        }}
      />
    </>
  );

  return (
    <div className="page-container page-tabs-page">
      <Tabs activeKey={activeTab} onChange={handleTabChange} type="line" lazyRender keepDOM={false}>
        <TabPane tab="待审核" itemKey="pending">{tableContent}</TabPane>
        <TabPane tab="已通过" itemKey="approved">{tableContent}</TabPane>
        <TabPane tab="已拒绝" itemKey="rejected">{tableContent}</TabPane>
        <TabPane tab="全部" itemKey="all">{tableContent}</TabPane>
      </Tabs>
    </div>
  );
}
