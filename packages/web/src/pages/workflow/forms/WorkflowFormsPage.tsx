import { useMemo } from 'react';
import { Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useNavigate } from 'react-router-dom';
import type { WorkflowForm, WorkflowFormStatus } from '@zenith/shared/workflow';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { useListSearch } from '@/hooks/useListSearch';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import {
  useDeleteWorkflowForm,
  useDuplicateWorkflowForm,
  useWorkflowFormList,
  workflowFormKeys,
} from '@/hooks/queries/workflow-forms';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { dateTimeColumn } from '@/utils/table-columns';

type StatusFilter = WorkflowFormStatus | undefined;
type TagColor = 'green' | 'grey';

interface SearchParams {
  keyword: string;
  status: StatusFilter;
  categoryId: number | undefined;
}

const defaultSearchParams: SearchParams = { keyword: '', status: undefined, categoryId: undefined };

const STATUS_MAP: Record<WorkflowFormStatus, { text: string; color: TagColor }> = {
  enabled: { text: '启用', color: 'green' },
  disabled: { text: '停用', color: 'grey' },
};

function toStatus(value: unknown): StatusFilter {
  return value === 'enabled' || value === 'disabled' ? value : undefined;
}

export default function WorkflowFormsPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const { items: statusItems } = useDictItems('common_status');
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: workflowFormKeys.lists });
  const { categories } = useWorkflowCategories();
  const listQuery = useWorkflowFormList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    categoryId: submittedParams.categoryId,
  });
  const data = listQuery.data ?? null;
  const deleteMutation = useDeleteWorkflowForm();
  const duplicateMutation = useDuplicateWorkflowForm();

  const categoryOptions = useMemo(
    () => categories.map((category) => ({ label: category.name, value: category.id })),
    [categories],
  );

  const categoryNameMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ params: { id } });
      Toast.success('删除成功');
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleDuplicate = async (id: number) => {
    try {
      await duplicateMutation.mutateAsync({ params: { id } });
      Toast.success('复制成功');
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '复制失败');
    }
  };

  const columns: ColumnProps<WorkflowForm>[] = [
    {
      title: '表单名称',
      dataIndex: 'name',
      minWidth: 220,
    },
    {
      title: '标识',
      dataIndex: 'code',
      width: 160,
      render: (value: string | null) => value || '-',
    },
    {
      title: '分类',
      dataIndex: 'categoryName',
      width: 140,
      render: (_value: unknown, record: WorkflowForm) => (
        record.categoryName || (record.categoryId === null ? null : categoryNameMap.get(record.categoryId)) || '-'
      ),
    },
    {
      title: '字段数',
      dataIndex: 'schema',
      width: 90,
      render: (_value: unknown, record: WorkflowForm) => record.schema?.fields?.length ?? 0,
    },
    {
      title: '引用数',
      align: 'right',
      dataIndex: 'usageCount',
      width: 90,
      render: (value: number | undefined) => value ?? 0,
    },
    {
      title: '创建人',
      dataIndex: 'createdByName',
      width: 120,
      render: (value: string | null | undefined) => value || '-',
    },
    dateTimeColumn('更新时间', 'updatedAt'),
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: WorkflowFormStatus) => {
        const status = STATUS_MAP[value];
        return <Tag color={status.color}>{status.text}</Tag>;
      },
    },
    createOperationColumn<WorkflowForm>({
      width: 210,
      desktopInlineKeys: ['edit', 'duplicate', 'delete'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('workflow:form:edit'),
          onClick: () => navigate(`/workflow/forms/designer?id=${record.id}`),
        },
        {
          key: 'duplicate',
          label: '复制',
          hidden: !hasPermission('workflow:form:create'),
          onClick: () => void handleDuplicate(record.id),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('workflow:form:delete'),
          disabled: (record.usageCount ?? 0) > 0,
          disabledReason: `该表单正被 ${record.usageCount} 个流程引用，解除引用后才能删除`,
          onClick: () => {
            confirmDelete({
              title: '确定要删除该表单吗？',
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="搜索表单名称/标识" value={draftParams.keyword} onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))} onSearch={handleSearch} />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.status}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, status: toStatus(value) }))}
    />
  );

  const renderCategoryFilter = () => (
    <FilterSelect
      placeholder="全部分类"
      items={categoryOptions}
      value={draftParams.categoryId}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, categoryId: value }))}
      width={160}
    />
  );

  const renderSearchButton = () => (
    <SearchButton onClick={handleSearch} />
  );

  const renderResetButton = () => (
    <ResetButton onClick={handleReset} />
  );

  const renderCreateButton = () => hasPermission('workflow:form:create') ? (
    <CreateButton onClick={() => navigate('/workflow/forms/designer')}>新建表单</CreateButton>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderStatusFilter()}
            {renderCategoryFilter()}
            {renderSearchButton()}
            {renderResetButton()}
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
            {renderStatusFilter()}
            {renderCategoryFilter()}
          </>
        )}
        filterTitle="表单筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable<WorkflowForm>
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
      />
    </div>
  );
}
