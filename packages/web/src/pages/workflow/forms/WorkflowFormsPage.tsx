import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowForm, WorkflowFormStatus } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useDictItems } from '@/hooks/useDictItems';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import {
  useDeleteWorkflowForm,
  useDuplicateWorkflowForm,
  useWorkflowFormList,
  workflowFormKeys,
} from '@/hooks/queries/workflow-forms';

type StatusFilter = WorkflowFormStatus | '';
type TagColor = 'green' | 'grey';

interface SearchParams {
  keyword: string;
  status: StatusFilter;
  categoryId: number | null;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '', categoryId: null };

const STATUS_MAP: Record<WorkflowFormStatus, { text: string; color: TagColor }> = {
  enabled: { text: '启用', color: 'green' },
  disabled: { text: '停用', color: 'grey' },
};

function toCategoryId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

function toStatus(value: unknown): StatusFilter {
  return value === 'enabled' || value === 'disabled' ? value : '';
}

export default function WorkflowFormsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const { items: statusItems } = useDictItems('common_status');
  const { page, setPage, pageSize, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const { categories } = useWorkflowCategories();
  const listQuery = useWorkflowFormList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    categoryId: submittedParams.categoryId ?? undefined,
  });
  const data = listQuery.data ?? null;
  const deleteMutation = useDeleteWorkflowForm();
  const duplicateMutation = useDuplicateWorkflowForm();

  const categoryOptions = useMemo(
    () => [
      { label: '全部分类', value: '' },
      ...categories.map((category) => ({ label: category.name, value: String(category.id) })),
    ],
    [categories],
  );

  const categoryNameMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: workflowFormKeys.lists });
  };

  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: workflowFormKeys.lists });
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  };

  const handleDuplicate = async (id: number) => {
    await duplicateMutation.mutateAsync(id);
    Toast.success('复制成功');
  };

  const columns: ColumnProps<WorkflowForm>[] = [
    {
      title: '表单名称',
      dataIndex: 'name',
      width: 220,
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
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value: string) => formatDateTime(value),
    },
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
      width: 220,
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
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该表单吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索表单名称/标识"
      value={draftParams.keyword}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 220 }}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="状态"
      value={draftParams.status}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, status: toStatus(value) }))}
      optionList={[{ value: '', label: '全部' }, ...statusItems.map((i) => ({ value: i.value as StatusFilter, label: i.label }))]}
      showClear
      style={{ width: 120 }}
    />
  );

  const renderCategoryFilter = () => (
    <Select
      placeholder="分类"
      value={draftParams.categoryId === null ? '' : String(draftParams.categoryId)}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, categoryId: toCategoryId(value) }))}
      optionList={categoryOptions}
      showClear
      style={{ width: 160 }}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  );

  const renderCreateButton = () => hasPermission('workflow:form:create') ? (
    <Button
      type="primary"
      icon={<Plus size={14} />}
      onClick={() => navigate('/workflow/forms/designer')}
    >
      新建表单
    </Button>
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
