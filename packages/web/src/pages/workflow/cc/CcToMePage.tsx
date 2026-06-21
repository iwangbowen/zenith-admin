import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Select, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw, Search } from 'lucide-react';
import type { WorkflowInstance, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { AppModal } from '@/components/AppModal';
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

export default function CcToMePage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<WorkflowInstance> | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [keyword, setKeyword] = useState('');
  const keywordRef = useRef('');
  keywordRef.current = keyword;
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // 转发抄送
  const [forwardTarget, setForwardTarget] = useState<WorkflowInstance | null>(null);
  const [forwardUserIds, setForwardUserIds] = useState<number[]>([]);
  const [forwardNote, setForwardNote] = useState('');
  const [forwardLoading, setForwardLoading] = useState(false);
  const [userOptions, setUserOptions] = useState<Array<{ label: string; value: number }>>([]);

  const fetchList = useCallback(async (p = page, ps = pageSize, kw?: string) => {
    const activeKeyword = kw ?? keywordRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(activeKeyword ? { keyword: activeKeyword } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<WorkflowInstance>>(`/api/workflows/instances/cc-mine?${query}`);
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

  const openDetail = (record: WorkflowInstance) => {
    setSelectedId(record.id);
    setDetailVisible(true);
    // 自动标记已读
    if (record.ccTaskId && !record.ccReadAt) {
      request.post(`/api/workflows/instances/cc/${record.ccTaskId}/read`, {})
        .then((res) => { if (res.code === 0) void fetchList(); })
        .catch(() => { /* 标记已读失败不影响查看 */ });
    }
  };

  const openForward = async (record: WorkflowInstance) => {
    setForwardTarget(record);
    setForwardUserIds([]);
    setForwardNote('');
    if (userOptions.length === 0) {
      try {
        const res = await request.get<Array<{ id: number; nickname: string; username: string }>>('/api/users/all');
        if (res.code === 0) setUserOptions(res.data.map((u) => ({ label: u.nickname ?? u.username, value: u.id })));
      } catch { /* ignore */ }
    }
  };

  const handleForward = async () => {
    if (!forwardTarget || forwardUserIds.length === 0) {
      Toast.warning('请选择抄送人');
      return;
    }
    setForwardLoading(true);
    try {
      const res = await request.post(`/api/workflows/instances/${forwardTarget.id}/forward`, {
        userIds: forwardUserIds,
        note: forwardNote || undefined,
      });
      if (res.code === 0) {
        Toast.success(res.message || '已抄送');
        setForwardTarget(null);
      }
    } finally {
      setForwardLoading(false);
    }
  };

  const columns: ColumnProps<WorkflowInstance>[] = [
    { title: '申请标题', dataIndex: 'title', width: 200, render: renderEllipsis },
    { title: '业务编号', dataIndex: 'serialNo', width: 130, render: (v: string | null) => v ?? '—' },
    { title: '流程名称', dataIndex: 'definitionName', width: 160, render: renderEllipsis },
    { title: '发起人', dataIndex: 'initiatorName', width: 120, render: (v: string | null) => v ?? '—' },
    { title: '抄送时间', dataIndex: 'createdAt', width: 170, render: (v: string) => formatDateTime(v) },
    {
      title: '阅读',
      dataIndex: 'ccReadAt',
      width: 80,
      render: (v: string | null) => (v ? <Tag color="grey" size="small">已读</Tag> : <Tag color="red" size="small">未读</Tag>),
    },
    {
      title: '状态',
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
      width: 140,
      fixed: 'right',
      render: (_: unknown, record: WorkflowInstance) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => openDetail(record)}>详情</Button>
          <Button theme="borderless" size="small" onClick={() => void openForward(record)}>转发</Button>
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
        title="抄送详情"
      />
      <AppModal
        title="转发抄送"
        visible={forwardTarget !== null}
        onCancel={() => setForwardTarget(null)}
        onOk={() => void handleForward()}
        confirmLoading={forwardLoading}
        okText="确定转发"
        closeOnEsc
      >
        <Typography.Text type="tertiary" size="small">将该流程抄送给指定成员（自动去重，已抄送的成员会被跳过）。</Typography.Text>
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>抄送人</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            multiple
            filter
            value={forwardUserIds}
            onChange={(v) => setForwardUserIds(v as number[])}
            optionList={userOptions}
            placeholder="请选择抄送人"
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>备注</Typography.Text>
          <Input
            style={{ marginTop: 4 }}
            value={forwardNote}
            onChange={setForwardNote}
            placeholder="可选，最多 256 字"
            maxLength={256}
          />
        </div>
      </AppModal>
    </div>
  );
}
