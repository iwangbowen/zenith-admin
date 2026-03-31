import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Popconfirm, Select, Space, Table, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowDefinition, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  draft: { text: '草稿', color: 'grey' },
  published: { text: '已发布', color: 'green' },
  disabled: { text: '已禁用', color: 'red' },
};

export default function WorkflowDefinitionsPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<WorkflowDefinition> | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchStatus, setSearchStatus] = useState('');

  const fetchList = useCallback(async (p = page, kw = searchKeyword, st = searchStatus) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(pageSize),
        ...(kw ? { keyword: kw } : {}),
        ...(st ? { status: st } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<WorkflowDefinition>>(`/api/workflows/definitions?${query}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchKeyword, searchStatus]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const handleSearch = () => {
    setSearchKeyword(keyword);
    setSearchStatus(status);
    void fetchList(1, keyword, status);
  };

  const handleReset = () => {
    setKeyword('');
    setStatus('');
    setSearchKeyword('');
    setSearchStatus('');
    void fetchList(1, '', '');
  };

  const handlePublish = async (record: WorkflowDefinition) => {
    const res = await request.post(`/api/workflows/definitions/${record.id}/publish`, {});
    if (res.code === 0) {
      Toast.success('发布成功');
      void fetchList();
    }
  };

  const handleDisable = async (record: WorkflowDefinition) => {
    const res = await request.post(`/api/workflows/definitions/${record.id}/disable`, {});
    if (res.code === 0) {
      Toast.success('已禁用');
      void fetchList();
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/workflows/definitions/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchList();
    }
  };

  const columns: ColumnProps<WorkflowDefinition>[] = [
    {
      title: '流程名称',
      dataIndex: 'name',
      width: 200,
    },
    {
      title: '描述',
      dataIndex: 'description',
      render: (v: string | null) => v ?? '—',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const s = STATUS_MAP[v];
        return <Tag color={s?.color ?? 'grey'}>{s?.text ?? v}</Tag>;
      },
    },
    {
      title: '版本',
      dataIndex: 'version',
      width: 80,
      render: (v: number) => `v${v}`,
    },
    {
      title: '创建人',
      dataIndex: 'createdByName',
      width: 120,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      fixed: 'right',
      render: (_: unknown, record: WorkflowDefinition) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => navigate(`/workflow/designer/${record.id}`)}>
            设计
          </Button>
          {record.status === 'draft' && hasPermission('workflow:definition:publish') && (
            <Popconfirm title="确定发布此流程？发布后不可删除" onConfirm={() => void handlePublish(record)}>
              <Button theme="borderless" size="small" type="primary">发布</Button>
            </Popconfirm>
          )}
          {record.status === 'published' && hasPermission('workflow:definition:publish') && (
            <Popconfirm title="禁用后该流程不可发起新申请，是否继续？" onConfirm={() => void handleDisable(record)}>
              <Button theme="borderless" size="small" type="warning">禁用</Button>
            </Popconfirm>
          )}
          {record.status !== 'published' && hasPermission('workflow:definition:delete') && (
            <Popconfirm title="确定要删除吗？" onConfirm={() => void handleDelete(record.id)}>
              <Button theme="borderless" type="danger" size="small">删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        left={<>
          <Input
            prefix={<Search size={14} />}
            placeholder="搜索流程名称"
            value={keyword}
            onChange={setKeyword}
            showClear
            style={{ width: 200 }}
          />
          <Select
            placeholder="状态"
            value={status || undefined}
            onChange={v => setStatus(typeof v === 'string' ? v : '')}
            showClear
            style={{ width: 120 }}
          >
            <Select.Option value="draft">草稿</Select.Option>
            <Select.Option value="published">已发布</Select.Option>
            <Select.Option value="disabled">已禁用</Select.Option>
          </Select>
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        </>}
        right={
          hasPermission('workflow:definition:create') ? (
            <Button type="secondary" icon={<Plus size={14} />} onClick={() => navigate('/workflow/designer/new')}>
              新建流程
            </Button>
          ) : undefined
        }
      />
      <Table
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={loading}
        pagination={{
          currentPage: page,
          pageSize,
          total: data?.total ?? 0,
          onPageChange: (p) => { void fetchList(p); },
        }}
      />
    </div>
  );
}
