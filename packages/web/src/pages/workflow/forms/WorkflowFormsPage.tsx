import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Popconfirm, Select, Space, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { PaginatedResponse, WorkflowForm, WorkflowFormStatus } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';

type StatusFilter = WorkflowFormStatus | '';
type TagColor = 'green' | 'grey';

interface SearchParams {
  keyword: string;
  status: StatusFilter;
  categoryId: number | null;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '', categoryId: null };

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: '', label: '全部' },
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '停用' },
];

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
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<WorkflowForm> | null>(null);
  const { page, setPage, pageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const { categories } = useWorkflowCategories();

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

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const { keyword, status, categoryId } = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(keyword ? { keyword } : {}),
        ...(status ? { status } : {}),
        ...(categoryId === null ? {} : { categoryId: String(categoryId) }),
      }).toString();
      const res = await request.get<PaginatedResponse<WorkflowForm>>(`/api/workflows/forms?${query}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const handleSearch = () => {
    setPage(1);
    void fetchList(1, pageSize);
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchList(1, pageSize, defaultSearchParams);
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete<null>(`/api/workflows/forms/${id}`, undefined, { silent: true });
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchList();
      return;
    }
    Toast.error(res.message || '删除失败');
  };

  const handleDuplicate = async (id: number) => {
    const res = await request.post<WorkflowForm>(`/api/workflows/forms/${id}/duplicate`, {}, { silent: true });
    if (res.code === 0) {
      Toast.success('复制成功');
      void fetchList();
      return;
    }
    Toast.error(res.message || '复制失败');
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
    {
      title: '操作',
      key: 'action',
      width: 180,
      fixed: 'right',
      render: (_value: unknown, record: WorkflowForm) => (
        <Space>
          {hasPermission('workflow:form:edit') && (
            <Button
              theme="borderless"
              size="small"
              onClick={() => navigate(`/workflow/forms/designer?id=${record.id}`)}
            >
              编辑
            </Button>
          )}
          {hasPermission('workflow:form:create') && (
            <Button
              theme="borderless"
              size="small"
              onClick={() => void handleDuplicate(record.id)}
            >
              复制
            </Button>
          )}
          {hasPermission('workflow:form:delete') && (
            <Popconfirm title="确定要删除该表单吗？" onConfirm={() => void handleDelete(record.id)}>
              <Button theme="borderless" type="danger" size="small">删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索表单名称/标识"
          value={searchParams.keyword}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, keyword: value }))}
          onEnterPress={handleSearch}
          showClear
          style={{ width: 220 }}
        />
        <Select
          placeholder="状态"
          value={searchParams.status}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, status: toStatus(value) }))}
          optionList={STATUS_OPTIONS}
          showClear
          style={{ width: 120 }}
        />
        <Select
          placeholder="分类"
          value={searchParams.categoryId === null ? '' : String(searchParams.categoryId)}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, categoryId: toCategoryId(value) }))}
          optionList={categoryOptions}
          showClear
          style={{ width: 160 }}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('workflow:form:create') && (
          <Button
            type="primary"
            icon={<Plus size={14} />}
            onClick={() => navigate('/workflow/forms/designer')}
          >
            新建表单
          </Button>
        )}
      </SearchToolbar>

      <ConfigurableTable<WorkflowForm>
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={loading}
        onRefresh={() => void fetchList()}
        refreshLoading={loading}
        pagination={buildPagination(data?.total ?? 0, fetchList)}
      />
    </div>
  );
}
