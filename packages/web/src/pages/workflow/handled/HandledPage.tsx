import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { WorkflowInstance } from '@zenith/shared/workflow';
import SavedViewsBar from '@/components/workflow/SavedViewsBar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import WorkflowInstanceDetailSheet from '@/components/workflow/WorkflowInstanceDetailSheet';
import { dateTimeColumn } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { KeywordInput } from '@/components/search-filters';
import {
  workflowDefinitionNameColumn,
  workflowInitiatorColumn,
  workflowInstanceStatusColumn,
  workflowInstanceTitleColumn,
  workflowSerialNoColumn,
} from '@/components/workflow/WorkflowInstanceListColumns';
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
    workflowInstanceTitleColumn<WorkflowInstance>(),
    workflowSerialNoColumn<WorkflowInstance>(),
    workflowDefinitionNameColumn<WorkflowInstance>(),
    workflowInitiatorColumn<WorkflowInstance>(),
    {
      title: '我的处理',
      dataIndex: 'myTaskStatus',
      width: 110,
      render: (v: string | null) => {
        const s = v ? MY_TASK_STATUS_MAP[v] : null;
        return s ? <Tag color={s.color}>{s.text}</Tag> : '—';
      },
    },
    dateTimeColumn('处理时间', 'myActionAt'),
    workflowInstanceStatusColumn<WorkflowInstance>({ title: '流程状态' }),
    createOperationColumn<WorkflowInstance>({
      width: 100,
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
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索标题 / 流程名称" value={draftKeyword} onChange={setDraftKeyword} onSearch={handleSearch} />}
        onSearch={handleSearch}
        onReset={handleReset}
      />
      <ConfigurableTable<WorkflowInstance>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
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
