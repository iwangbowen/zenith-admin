import { useState } from 'react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { WorkflowHandledInstanceItem } from '@zenith/shared/workflow';
import SavedViewsBar from '@/components/workflow/SavedViewsBar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import WorkflowInstanceDetailSheet from '@/components/workflow/WorkflowInstanceDetailSheet';
import WorkflowHandledTaskTag from '@/components/workflow/WorkflowHandledTaskTag';
import { dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import { useListSearch } from '@/hooks/useListSearch';
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
import { useFilterQuery } from '@/hooks/useFilterQuery';

interface SearchParams {
  keyword: string;
}

export default function HandledPage() {
  const { page, pageSize, buildPagination, bindKeyword, submittedParams, handleSearch, handleReset, applySearch } =
    useListSearch<SearchParams>({ defaults: { keyword: '' }, listKey: workflowInstanceKeys.handledLists });
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useFilterQuery({ keyword: submittedParams.keyword });

  const listQuery = useHandledWorkflowInstances({ page, pageSize, ...filterQuery });

  const openDetail = (id: number) => {
    setSelectedId(id);
    setDetailVisible(true);
  };

  const columns: ColumnProps<WorkflowHandledInstanceItem>[] = [
    workflowInstanceTitleColumn<WorkflowHandledInstanceItem>(),
    workflowSerialNoColumn<WorkflowHandledInstanceItem>(),
    workflowDefinitionNameColumn<WorkflowHandledInstanceItem>(),
    workflowInitiatorColumn<WorkflowHandledInstanceItem>(),
    {
      title: '处理节点', dataIndex: 'handledTask', width: 180,
      render: (_value, record) => renderEllipsis(record.handledTask.nodeName),
    },
    {
      title: '审批轮次', dataIndex: 'handledTask', key: 'handledRound', width: 90,
      render: (_value, record) => `第 ${record.handledTask.round} 轮`,
    },
    {
      title: '我的处理',
      dataIndex: 'handledTask', key: 'handledDecision', width: 170,
      render: (_value, record) => <WorkflowHandledTaskTag task={record.handledTask} />,
    },
    dateTimeColumn('处理时间', 'myActionAt'),
    workflowInstanceStatusColumn<WorkflowHandledInstanceItem>({ title: '流程状态' }),
    createOperationColumn<WorkflowHandledInstanceItem>({
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
        currentFilters={{ keyword: submittedParams.keyword }}
        onApply={(filters) => applySearch({ keyword: typeof filters.keyword === 'string' ? filters.keyword : '' })}
      />
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索标题 / 流程名称" {...bindKeyword('keyword')} />}
        onSearch={handleSearch}
        onReset={handleReset}
      />
      <ConfigurableTable<WorkflowHandledInstanceItem>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, rowKey: (row) => String(row?.handledTask.id) })}
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
