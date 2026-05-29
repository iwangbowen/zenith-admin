import { useCallback, useEffect, useState } from 'react';
import { Button, Dropdown, Input, Modal, Select, Space, Tag,
  Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { MoreHorizontal, Plus, RotateCcw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowDefinition, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import WorkflowVersionsModal from '../components/WorkflowVersionsModal';
import CategorySidebar from './components/CategorySidebar';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { renderEllipsis } from '../../../utils/table-columns';

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
  const [historyTarget, setHistoryTarget] = useState<WorkflowDefinition | null>(null);
  const [openMoreId, setOpenMoreId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const { categories, refetch: refetchCategories } = useWorkflowCategories();

  const fetchList = useCallback(async (p = page, kw = searchKeyword, st = searchStatus, cid = selectedCategoryId) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(pageSize),
        ...(kw ? { keyword: kw } : {}),
        ...(st ? { status: st } : {}),
        ...(cid === null ? {} : { categoryId: String(cid) }),
      }).toString();
      const res = await request.get<PaginatedResponse<WorkflowDefinition>>(`/api/workflows/definitions?${query}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchKeyword, searchStatus, selectedCategoryId]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const handleSelectCategory = (id: number | null) => {
    setSelectedCategoryId(id);
    void fetchList(1, searchKeyword, searchStatus, id);
  };

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
      width: 260,
      render: renderEllipsis,
    },
    {
      title: '分类',
      dataIndex: 'categoryName',
      width: 110,
      render: (_v: unknown, record: WorkflowDefinition) => {
        if (!record.categoryName) return <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>;
        const color = record.categoryColor ?? undefined;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />}
            <span>{record.categoryName}</span>
          </span>
        );
      },
    },
    {
      title: '描述',
      dataIndex: 'description',
      render: renderEllipsis,
    },
    {
      title: '版本',
      dataIndex: 'version',
      width: 70,
      render: (v: number) => `v${v}`,
    },
    {
      title: '创建人',
      dataIndex: 'createdByName',
      width: 90,
      render: renderEllipsis,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 170,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (v: string) => {
        const s = STATUS_MAP[v];
        return <Tag color={s?.color ?? 'grey'}>{s?.text ?? v}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      fixed: 'right',
      render: (_: unknown, record: WorkflowDefinition) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => navigate(`/workflow/designer/${record.id}`)}>
            设计
          </Button>
          {record.status === 'draft' && hasPermission('workflow:definition:publish') && (
            <Button theme="borderless" size="small" type="primary" onClick={() => {
              Modal.confirm({
                title: '确定发布此流程？',
                content: '发布后不可删除，请确认流程配置正确。',
                onOk: () => handlePublish(record),
              });
            }}>发布</Button>
          )}
          {record.status === 'published' && hasPermission('workflow:definition:publish') && (
            <Button theme="borderless" size="small" type="warning" onClick={() => {
              Modal.confirm({
                title: '确定禁用此流程？',
                content: '禁用后该流程不可发起新申请，是否继续？',
                okButtonProps: { type: 'danger', theme: 'solid' },
                onOk: () => handleDisable(record),
              });
            }}>禁用</Button>
          )}
          <Dropdown
            trigger="custom"
            visible={openMoreId === record.id}
            onClickOutSide={() => setOpenMoreId(null)}
            position="bottomRight"
            render={
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => { setOpenMoreId(null); setHistoryTarget(record); }}>历史版本</Dropdown.Item>
                {record.status !== 'published' && hasPermission('workflow:definition:delete') && (
                  <Dropdown.Item
                    type="danger"
                    onClick={() => {
                      setOpenMoreId(null);
                      Modal.confirm({
                        title: '确定要删除该流程吗？',
                        okButtonProps: { type: 'danger', theme: 'solid' },
                        onOk: () => handleDelete(record.id),
                      });
                    }}
                  >删除</Dropdown.Item>
                )}
              </Dropdown.Menu>
            }
          >
            <Button
              theme="borderless"
              size="small"
              icon={<MoreHorizontal size={14} />}
              onClick={() => setOpenMoreId(openMoreId === record.id ? null : record.id)}
            />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
      <CategorySidebar
        categories={categories}
        selectedId={selectedCategoryId}
        onSelect={handleSelectCategory}
        onChanged={() => { refetchCategories(); void fetchList(); }}
        canManage={hasPermission('workflow:definition:create')}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
      <SearchToolbar>
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
          {hasPermission('workflow:definition:create') && (
            <Button type="primary" icon={<Plus size={14} />} onClick={() => {
              const qs = selectedCategoryId === null ? '' : `?categoryId=${selectedCategoryId}`;
              navigate(`/workflow/designer/new${qs}`);
            }}>
              新建流程
            </Button>
          )}
      </SearchToolbar>
      <ConfigurableTable
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
      {historyTarget && (
        <WorkflowVersionsModal
          visible={!!historyTarget}
          definitionId={historyTarget.id}
          currentVersion={historyTarget.version}
          currentStatus={historyTarget.status}
          onCancel={() => setHistoryTarget(null)}
          onRestored={() => { void fetchList(); }}
        />
      )}
      </div>
    </div>
  );
}
