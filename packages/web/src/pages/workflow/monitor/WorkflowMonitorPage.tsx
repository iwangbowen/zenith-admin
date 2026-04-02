import { useCallback, useEffect, useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  Descriptions,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CheckCircle2, Clock, Mail, RotateCcw, Search, XCircle } from 'lucide-react';
import type { WorkflowInstance, WorkflowTask } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const INSTANCE_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  draft:     { text: '草稿',  color: 'grey'   },
  running:   { text: '审批中', color: 'blue'   },
  approved:  { text: '已通过', color: 'green'  },
  rejected:  { text: '已驳回', color: 'red'    },
  withdrawn: { text: '已撤回', color: 'orange' },
};

const TASK_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  pending:  { text: '待审批', color: 'blue'  },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red'   },
  skipped:  { text: '已跳过', color: 'grey'  },
};

interface MonitorStats {
  total: number;
  running: number;
  approved: number;
  rejected: number;
  withdrawn: number;
}

interface MonitorResponse {
  stats: MonitorStats;
  list: WorkflowInstance[];
  total: number;
  page: number;
  pageSize: number;
}

/** 状态统计卡片 */
function StatCard({
  label,
  value,
  color,
  onClick,
  active,
}: Readonly<{
  label: string;
  value: number;
  color: string;
  onClick: () => void;
  active: boolean;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        cursor: 'pointer',
        flex: 1,
        minWidth: 120,
        border: 'none',
        background: 'none',
        padding: 0,
        textAlign: 'left',
      }}
    >
      <Card
        style={{
          border: active ? `2px solid ${color}` : '2px solid transparent',
          transition: 'border-color 0.2s',
        }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <Typography.Text type="tertiary" size="small">{label}</Typography.Text>
        <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 4, lineHeight: 1 }}>{value}</div>
      </Card>
    </button>
  );
}

/** 飞书风格审批时间线（只读，复用） */
function ApprovalTimeline({ tasks }: Readonly<{ tasks: WorkflowTask[] }>) {
  return (
    <div style={{ paddingLeft: 4 }}>
      {tasks.map((task, idx) => {
        const isLast = idx === tasks.length - 1;
        const isApproved = task.status === 'approved';
        const isRejected = task.status === 'rejected';
        const isSkipped = task.status === 'skipped';
        const isCc = task.nodeType === 'ccNode';

        let iconColor = 'var(--semi-color-primary)';
        if (isApproved) iconColor = '#0dc87c';
        else if (isRejected) iconColor = '#ff4d4f';
        else if (isSkipped) iconColor = '#c0c0c0';

        let StatusIcon = Clock;
        if (isApproved) StatusIcon = CheckCircle2;
        else if (isRejected) StatusIcon = XCircle;
        else if (isCc) StatusIcon = Mail;

        let actionText = '';
        if (isApproved && !isCc) actionText = '已同意';
        else if (isRejected) actionText = '已驳回';
        else if (isSkipped) actionText = '已跳过';
        else if (isCc && isApproved) actionText = '已抄送';
        else actionText = '待处理';

        return (
          <div key={task.id} style={{ display: 'flex', gap: 12, position: 'relative' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                backgroundColor: isSkipped ? '#f0f0f0' : `${iconColor}18`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <StatusIcon size={15} color={iconColor} />
              </div>
              {!isLast && (
                <div style={{ width: 2, flex: 1, minHeight: 20, backgroundColor: 'var(--semi-color-border)', margin: '4px 0' }} />
              )}
            </div>
            <div style={{ flex: 1, paddingBottom: isLast ? 0 : 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Typography.Text strong style={{ fontSize: 13 }}>{task.nodeName}</Typography.Text>
                <Tag color={TASK_STATUS_MAP[task.status]?.color ?? 'grey'} size="small" style={{ flexShrink: 0 }}>
                  {actionText}
                </Tag>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: task.comment ? 6 : 0 }}>
                <Avatar
                  size="extra-extra-small"
                  style={{ backgroundColor: isSkipped ? '#c0c0c0' : 'var(--semi-color-primary-light-active)', flexShrink: 0 }}
                  src={task.assigneeAvatar ?? undefined}
                >
                  {(task.assigneeName ?? '?').charAt(0)}
                </Avatar>
                <Typography.Text size="small" type="tertiary">{task.assigneeName ?? '未指定'}</Typography.Text>
                {task.actionAt && (
                  <Typography.Text size="small" type="quaternary" style={{ marginLeft: 'auto' }}>
                    {formatDateTime(task.actionAt)}
                  </Typography.Text>
                )}
              </div>
              {task.comment && (
                <div style={{
                  marginTop: 6, padding: '8px 10px',
                  backgroundColor: 'var(--semi-color-fill-0)',
                  borderRadius: 6, borderLeft: `3px solid ${iconColor}`,
                }}>
                  <Typography.Text size="small" type="secondary">{task.comment}</Typography.Text>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function WorkflowMonitorPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MonitorResponse | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // 详情弹窗
  const [detailVisible, setDetailVisible] = useState(false);
  const [detail, setDetail] = useState<WorkflowInstance | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchList = useCallback(async (p = page, kw = keyword, st = statusFilter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (kw) params.set('keyword', kw);
      if (st) params.set('status', st);
      const res = await request.get<MonitorResponse>(`/api/workflows/instances/all?${params.toString()}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, statusFilter]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const handleSearch = () => {
    setKeyword(keywordInput);
    void fetchList(1, keywordInput, statusFilter);
  };

  const handleReset = () => {
    setKeywordInput('');
    setKeyword('');
    setStatusFilter('');
    void fetchList(1, '', '');
  };

  const handleStatCardClick = (st: string) => {
    const next = statusFilter === st ? '' : st;
    setStatusFilter(next);
    void fetchList(1, keyword, next);
  };

  const openDetail = (item: WorkflowInstance) => {
    setDetailLoading(true);
    setDetailVisible(true);
    request.get<WorkflowInstance>(`/api/workflows/instances/${item.id}`)
      .then(res => { if (res.code === 0) setDetail(res.data); })
      .catch(() => undefined)
      .finally(() => setDetailLoading(false));
  };

  const stats = data?.stats ?? { total: 0, running: 0, approved: 0, rejected: 0, withdrawn: 0 };

  const columns: ColumnProps<WorkflowInstance>[] = [
    {
      title: '申请标题',
      dataIndex: 'title',
      ellipsis: true,
    },
    {
      title: '流程名称',
      dataIndex: 'definitionName',
      width: 160,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: '申请人',
      dataIndex: 'initiatorName',
      width: 120,
      render: (v: string | null, record: WorkflowInstance) => (
        <Space spacing={6}>
          <Avatar size="extra-extra-small" src={record.initiatorAvatar ?? undefined} style={{ backgroundColor: 'var(--semi-color-primary-light-active)' }}>
            {(v ?? '?').charAt(0)}
          </Avatar>
          <span>{v ?? '—'}</span>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const s = INSTANCE_STATUS_MAP[v];
        return <Tag color={s?.color ?? 'grey'}>{s?.text ?? v}</Tag>;
      },
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '最后更新',
      dataIndex: 'updatedAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      fixed: 'right',
      render: (_: unknown, record: WorkflowInstance) => (
        <Button theme="borderless" size="small" onClick={() => openDetail(record)}>查看详情</Button>
      ),
    },
  ];

  return (
    <div className="page-container">
      {/* 统计卡片 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="全部" value={stats.total}     color="var(--semi-color-text-0)" onClick={() => handleStatCardClick('')}          active={statusFilter === ''} />
        <StatCard label="审批中" value={stats.running}  color="var(--semi-color-primary)"        onClick={() => handleStatCardClick('running')}   active={statusFilter === 'running'} />
        <StatCard label="已通过" value={stats.approved} color="#0dc87c"                          onClick={() => handleStatCardClick('approved')}  active={statusFilter === 'approved'} />
        <StatCard label="已驳回" value={stats.rejected} color="#ff4d4f"                          onClick={() => handleStatCardClick('rejected')}  active={statusFilter === 'rejected'} />
        <StatCard label="已撤回" value={stats.withdrawn ?? 0} color="var(--semi-color-warning)"  onClick={() => handleStatCardClick('withdrawn')} active={statusFilter === 'withdrawn'} />
      </div>

      {/* 搜索栏 */}
      <SearchToolbar
        left={
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索申请标题 / 流程名称"
              showClear
              value={keywordInput}
              onChange={v => setKeywordInput(v)}
              onEnterPress={handleSearch}
              style={{ width: 260 }}
            />
            <Select
              placeholder="所有状态"
              showClear
              value={statusFilter || undefined}
              onChange={v => setStatusFilter(v as string ?? '')}
              style={{ width: 140 }}
              optionList={[
                { label: '审批中', value: 'running' },
                { label: '已通过', value: 'approved' },
                { label: '已驳回', value: 'rejected' },
                { label: '已撤回', value: 'withdrawn' },
              ]}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        }
      />

      <Table
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={loading}
        scroll={{ x: 900 }}
        pagination={{
          currentPage: page,
          pageSize,
          total: data?.total ?? 0,
          onPageChange: (p) => { void fetchList(p); },
        }}
      />

      {/* 详情弹窗 */}
      <Modal
        title="流程详情"
        visible={detailVisible}
        onCancel={() => { setDetailVisible(false); setDetail(null); }}
        footer={null}
        style={{ width: 600 }}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}>加载中...</div>
        ) : null}
        {!detailLoading && detail ? (
          <div>
            <Descriptions
              data={[
                { key: '申请标题',  value: detail.title },
                { key: '流程名称',  value: detail.definitionName ?? '—' },
                { key: '申请人',    value: detail.initiatorName ?? '—' },
                {
                  key: '状态',
                  value: (<Tag color={INSTANCE_STATUS_MAP[detail.status]?.color ?? 'grey'}>{INSTANCE_STATUS_MAP[detail.status]?.text ?? detail.status}</Tag>),
                },
                { key: '提交时间',  value: formatDateTime(detail.createdAt) },
                { key: '最后更新',  value: formatDateTime(detail.updatedAt) },
              ]}
            />
            {detail.tasks && detail.tasks.length > 0 ? (
              <div style={{ marginTop: 20 }}>
                <Typography.Title heading={6} style={{ marginBottom: 12 }}>审批流程</Typography.Title>
                <ApprovalTimeline tasks={detail.tasks} />
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
