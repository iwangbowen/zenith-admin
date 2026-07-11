import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { WorkflowInstance } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';
import { KeywordSearchToolbar } from '@/components/KeywordSearchToolbar';
import SavedViewsBar from '@/components/workflow/SavedViewsBar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import WorkflowInstanceDetailSheet from '@/components/workflow/WorkflowInstanceDetailSheet';
import { INSTANCE_STATUS_MAP } from '@/components/workflow/workflow-runtime';
import { renderEllipsis } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useHandledWorkflowInstances, workflowInstanceKeys } from '@/hooks/queries/workflow-instances';

type TagColor = 'amber' | 'blue' | 'green' | 'grey' | 'orange' | 'purple' | 'red';

const MY_TASK_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  approved: { text: '我已通过', color: 'green' },
  rejected: { text: '我已驳回', color: 'red' },
};

export default function HandledPage() {
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const listQuery = useHandledWorkflowInstances({
    page,
    pageSize,
    keyword: submittedKeyword || undefined,
  });
  const data = listQuery.data;

  const handleSearch = () => {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: workflowInstanceKeys.lists });
  };

  const handleReset = () => {
    setDraftKeyword('');
    setSubmittedKeyword('');
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: workflowInstanceKeys.lists });
  };

  const openDetail = (id: number) => {
    setSelectedId(id);
    setDetailVisible(true);
  };

  const columns: ColumnProps<WorkflowInstance>[] = [
    { title: '申请标题', dataIndex: 'title', width: 200, render: renderEllipsis },
    { title: '业务编号', dataIndex: 'serialNo', width: 130, render: (v: string | null) => v ?? '—' },
    { title: '流程名称', dataIndex: 'definitionName', width: 160, render: renderEllipsis },
    { title: '发起人', dataIndex: 'initiatorName', width: 120, render: (v: string | null) => v ?? '—' },
    {
      title: '我的处理',
      dataIndex: 'myTaskStatus',
      width: 110,
      render: (v: string | null) => {
        const s = v ? MY_TASK_STATUS_MAP[v] : null;
        return s ? <Tag color={s.color}>{s.text}</Tag> : '—';
      },
    },
    { title: '处理时间', dataIndex: 'myActionAt', width: 180, render: (v: string | null) => (v ? formatDateTime(v) : '—') },
    {
      title: '流程状态',
      dataIndex: 'status',
      width: 100,
      fixed: 'right',
      render: (v: string) => {
        const s = INSTANCE_STATUS_MAP[v];
        return <Tag color={s?.color ?? 'grey'}>{s?.text ?? v}</Tag>;
      },
    },
    createOperationColumn<WorkflowInstance>({
      width: 90,
      desktopInlineKeys: ['detail'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => openDetail(record.id) },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SavedViewsBar
        pageKey="workflow-handled"
        currentFilters={{ keyword: submittedKeyword }}
        onApply={(filters) => {
          const keyword = typeof filters.keyword === 'string' ? filters.keyword : '';
          setDraftKeyword(keyword);
          setSubmittedKeyword(keyword);
          setPage(1);
          void queryClient.invalidateQueries({ queryKey: workflowInstanceKeys.lists });
        }}
      />
      <KeywordSearchToolbar
        placeholder="搜索标题 / 流程名称"
        value={draftKeyword}
        onChange={setDraftKeyword}
        onSearch={handleSearch}
        onReset={handleReset}
      />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
      />
      <WorkflowInstanceDetailSheet
        instanceId={selectedId}
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        title="已办详情"
      />
    </div>
  );
}
