import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Button,
  Descriptions,
  Form,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CheckCircle2, Clock, Eye, FileInput, Mail, Plus, RotateCcw, Search, XCircle } from 'lucide-react';
import type { WorkflowDefinition, WorkflowInstance, WorkflowTask, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

function formatFormValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v as string | number | boolean);
}

const INSTANCE_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  draft: { text: '草稿', color: 'grey' },
  running: { text: '审批中', color: 'blue' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red' },
  withdrawn: { text: '已撤回', color: 'orange' },
};

const TASK_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  pending: { text: '待审批', color: 'blue' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red' },
  skipped: { text: '已跳过', color: 'grey' },
};

/** 飞书风格审批时间线 */
function ApprovalTimeline({ tasks }: Readonly<{ tasks: WorkflowTask[] }>) {
  return (
    <div style={{ paddingLeft: 4 }}>
      {tasks.map((task, idx) => {
        const isLast = idx === tasks.length - 1;
        const isApproved = task.status === 'approved';
        const isRejected = task.status === 'rejected';
        const isPending = task.status === 'pending';
        const isSkipped = task.status === 'skipped';
        const isCc = task.nodeType === 'ccNode';

        // 图标颜色
        let iconColor = 'var(--semi-color-primary)';
        if (isApproved) iconColor = '#0dc87c';
        else if (isRejected) iconColor = '#ff4d4f';
        else if (isSkipped) iconColor = '#c0c0c0';

        // 状态图标
        let StatusIcon = Clock;
        if (isApproved) StatusIcon = CheckCircle2;
        else if (isRejected) StatusIcon = XCircle;
        else if (isCc) StatusIcon = Mail;

        // 操作文字
        let actionText = '';
        if (isApproved && !isCc) actionText = '已同意';
        else if (isRejected) actionText = '已驳回';
        else if (isSkipped) actionText = '已跳过';
        else if (isCc && isApproved) actionText = '已抄送';
        else if (isPending) actionText = '待处理';

        return (
          <div key={task.id} style={{ display: 'flex', gap: 12, position: 'relative' }}>
            {/* 左侧时间线 */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                backgroundColor: isSkipped ? '#f0f0f0' : `${iconColor}18`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <StatusIcon size={15} color={iconColor} />
              </div>
              {!isLast && (
                <div style={{ width: 2, flex: 1, minHeight: 20, backgroundColor: 'var(--semi-color-border)', margin: '4px 0' }} />
              )}
            </div>

            {/* 右侧内容 */}
            <div style={{ flex: 1, paddingBottom: isLast ? 0 : 16 }}>
              {/* 节点名称行 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Typography.Text strong style={{ fontSize: 13 }}>{task.nodeName}</Typography.Text>
                {actionText && (
                  <Tag
                    color={TASK_STATUS_MAP[task.status]?.color ?? 'grey'}
                    size="small"
                    style={{ flexShrink: 0 }}
                  >
                    {actionText}
                  </Tag>
                )}
              </div>

              {/* 审批人行 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: task.comment ? 6 : 0 }}>
                <Avatar
                  size="extra-extra-small"
                  style={{ backgroundColor: isSkipped ? '#c0c0c0' : 'var(--semi-color-primary-light-active)', flexShrink: 0 }}
                  src={task.assigneeAvatar ?? undefined}
                >
                  {(task.assigneeName ?? '?').charAt(0)}
                </Avatar>
                <Typography.Text size="small" type="tertiary">
                  {task.assigneeName ?? '未指定'}
                </Typography.Text>
                {task.actionAt && (
                  <Typography.Text size="small" type="quaternary" style={{ marginLeft: 'auto' }}>
                    {formatDateTime(task.actionAt)}
                  </Typography.Text>
                )}
              </div>

              {/* 审批意见 */}
              {task.comment && (
                <div style={{
                  marginTop: 6,
                  padding: '8px 10px',
                  backgroundColor: 'var(--semi-color-fill-0)',
                  borderRadius: 6,
                  borderLeft: `3px solid ${iconColor}`,
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

function InstanceDetailDrawer({
  instanceId,
  visible,
  onClose,
  onRefresh,
}: Readonly<{
  instanceId: number | null;
  visible: boolean;
  onClose: () => void;
  onRefresh: () => void;
}>) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WorkflowInstance | null>(null);

  useEffect(() => {
    if (!visible || !instanceId) return;
    setLoading(true);
    request.get<WorkflowInstance>(`/api/workflows/instances/${instanceId}`)
      .then(res => { if (res.code === 0) setData(res.data); })
      .finally(() => setLoading(false));
  }, [visible, instanceId]);

  const handleWithdraw = async () => {
    if (!instanceId) return;
    const res = await request.post(`/api/workflows/instances/${instanceId}/withdraw`, {});
    if (res.code === 0) {
      Toast.success('已撤回');
      onRefresh();
      onClose();
    }
  };

  const statusInfo = data ? INSTANCE_STATUS_MAP[data.status] : null;

  return (
    <Modal
      title="申请详情"
      visible={visible}
      onCancel={onClose}
      footer={
        data?.status === 'running' ? (
          <Popconfirm title="确定要撤回吗？" onConfirm={() => void handleWithdraw()}>
            <Button type="danger">撤回申请</Button>
          </Popconfirm>
        ) : null
      }
      style={{ width: 600 }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : null}
      {!loading && data !== null && data !== undefined ? (
        <div>
          <Descriptions
            data={[
              { key: '申请标题', value: data.title },
              { key: '流程名称', value: data.definitionName ?? '—' },
              { key: '发起人', value: data.initiatorName ?? '—' },
              {
                key: '当前状态',
                value: statusInfo
                  ? (<Tag color={statusInfo.color}>{statusInfo.text}</Tag>)
                  : (<span>{data.status}</span>),
              },
              { key: '提交时间', value: formatDateTime(data.createdAt) },
            ]}
          />
          {data.formData && Object.keys(data.formData).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Typography.Title heading={6} style={{ marginBottom: 8 }}>表单内容</Typography.Title>
              <Descriptions
                data={Object.entries(data.formData).map(([k, v]) => ({ key: k, value: formatFormValue(v) }))}
              />
            </div>
          )}
          {data.tasks && data.tasks.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Typography.Title heading={6} style={{ marginBottom: 12 }}>审批记录</Typography.Title>
              <ApprovalTimeline tasks={data.tasks} />
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

export default function MyApplicationsPage() {
  const formApi = useRef<FormApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<WorkflowInstance> | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [applyVisible, setApplyVisible] = useState(false);
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [selectedDef, setSelectedDef] = useState<WorkflowDefinition | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchList = useCallback(async (p = page, st = searchStatus) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(pageSize),
        ...(st ? { status: st } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<WorkflowInstance>>(`/api/workflows/instances?${query}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchStatus]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const loadDefinitions = async () => {
    const res = await request.get<WorkflowDefinition[]>('/api/workflows/definitions/published');
    if (res.code === 0 && res.data) setDefinitions(res.data);
  };

  const handleSearch = () => {
    setSearchStatus(statusFilter);
    void fetchList(1, statusFilter);
  };

  const handleReset = () => {
    setStatusFilter('');
    setSearchStatus('');
    void fetchList(1, '');
  };

  const openDetail = (id: number) => {
    setSelectedId(id);
    setDetailVisible(true);
  };

  const openApply = async () => {
    await loadDefinitions();
    setApplyVisible(true);
  };

  const handleSubmitApply = async () => {
    if (!formApi.current) return;
    try {
      const values = await formApi.current.validate() as Record<string, unknown>;
      setSubmitting(true);
      const res = await request.post('/api/workflows/instances', {
        definitionId: values.definitionId,
        title: values.title,
        formData: {},
      });
      if (res.code === 0) {
        Toast.success('申请已提交');
        setApplyVisible(false);
        setSelectedDef(null);
        void fetchList();
      }
    } catch {
      // validation failed
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnProps<WorkflowInstance>[] = [
    {
      title: '申请标题',
      dataIndex: 'title',
      width: 200,
    },
    {
      title: '流程名称',
      dataIndex: 'definitionName',
      width: 160,
      render: (v: string | null) => v ?? '—',
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
      title: '操作',
      key: 'action',
      width: 100,
      fixed: 'right',
      render: (_: unknown, record: WorkflowInstance) => (
        <Space>
          <Button theme="borderless" size="small" icon={<Eye size={13} />} onClick={() => openDetail(record.id)}>
            详情
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        left={<>
          <Select
            placeholder="全部状态"
            value={statusFilter || undefined}
            onChange={v => setStatusFilter(typeof v === 'string' ? v : '')}
            showClear
            style={{ width: 140 }}
          >
            {Object.entries(INSTANCE_STATUS_MAP).map(([k, s]) => (
              <Select.Option key={k} value={k}>{s.text}</Select.Option>
            ))}
          </Select>
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        </>}
        right={
          <Button type="secondary" icon={<Plus size={14} />} onClick={() => void openApply()}>
            发起申请
          </Button>
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

      {/* 申请详情 */}
      <InstanceDetailDrawer
        instanceId={selectedId}
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        onRefresh={() => void fetchList()}
      />

      {/* 发起申请弹窗 */}
      <Modal
        title="发起申请"
        visible={applyVisible}
        onCancel={() => { setApplyVisible(false); setSelectedDef(null); }}
        onOk={() => void handleSubmitApply()}
        okButtonProps={{ loading: submitting }}
        style={{ width: 500 }}
      >
        <Form getFormApi={api => { formApi.current = api; }}>
          <Form.Select
            field="definitionId"
            label="选择流程"
            placeholder="请选择要发起的流程"
            rules={[{ required: true, message: '请选择流程' }]}
            optionList={definitions.map(d => ({ value: d.id, label: d.name }))}
            onChange={v => {
              const def = definitions.find(d => d.id === v);
              setSelectedDef(def ?? null);
            }}
          />
          <Form.Input
            field="title"
            label="申请标题"
            placeholder="请简要描述申请内容"
            rules={[{ required: true, message: '请填写申请标题' }]}
          />
          {selectedDef?.description && (
            <div style={{ padding: '8px 0', color: 'var(--semi-color-text-2)', fontSize: 13 }}>
              <FileInput size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {selectedDef.description}
            </div>
          )}
        </Form>
      </Modal>
    </div>
  );
}
