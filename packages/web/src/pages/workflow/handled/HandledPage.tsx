import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Space, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw, Search } from 'lucide-react';
import type { WorkflowInstance, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import WorkflowInstanceDetailSheet from '@/components/workflow/WorkflowInstanceDetailSheet';
import { renderEllipsis } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';

type TagColor = 'amber' | 'blue' | 'green' | 'grey' | 'orange' | 'purple' | 'red';

const INSTANCE_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  draft: { text: '草稿', color: 'grey' },
  running: { text: '审批中', color: 'blue' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red' },
  withdrawn: { text: '已撤回', color: 'orange' },
  cancelled: { text: '已取消', color: 'purple' },
};

const MY_TASK_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  approved: { text: '我已通过', color: 'green' },
  rejected: { text: '我已驳回', color: 'red' },
};

export default function HandledPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<WorkflowInstance> | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [keyword, setKeyword] = useState('');
  const keywordRef = useRef('');
  keywordRef.current = keyword;
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const fetchList = useCallback(async (p = page, ps = pageSize, kw?: string) => {
    const activeKeyword = kw ?? keywordRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(activeKeyword ? { keyword: activeKeyword } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<WorkflowInstance>>(`/api/workflows/instances/handled-mine?${query}`);
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
    void fetchList(1);
  };

  const handleReset = () => {
    setKeyword('');
    setPage(1);
    void fetchList(1, pageSize, '');
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
    {
      title: '操作',
      key: 'action',
      width: 90,
      fixed: 'right',
      render: (_: unknown, record: WorkflowInstance) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => openDetail(record.id)}>详情</Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索标题 / 流程名称"
          value={keyword}
          onChange={setKeyword}
          onEnterPress={handleSearch}
          showClear
          style={{ width: 220 }}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={loading}
        pagination={buildPagination(data?.total ?? 0, fetchList)}
        onRefresh={() => void fetchList()}
        refreshLoading={loading}
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
