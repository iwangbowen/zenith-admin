import { useState, useCallback, useEffect, useRef } from 'react';
import { Button, Form, Tag, Typography, Select, Space, Toast } from '@douyinfe/semi-ui';
import { RotateCcw, Search, ThumbsUp, ThumbsDown } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { AiFeedbackStatus, AiMessage } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import AppModal from '@/components/AppModal';
import { renderEllipsis } from '@/utils/table-columns';

const { Text } = Typography;

const FEEDBACK_OPTIONS = [
  { value: '', label: '全部' },
  { value: '1', label: '👍 点赞' },
  { value: '-1', label: '👎 点踩' },
];

const STATUS_FILTER_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待处理' },
  { value: 'resolved', label: '已处理' },
  { value: 'ignored', label: '已忽略' },
];

const HANDLE_STATUS_OPTIONS = [
  { value: 'resolved', label: '已处理' },
  { value: 'ignored', label: '已忽略' },
  { value: 'pending', label: '待处理' },
];

const REASON_LABELS: Record<string, string> = {
  inaccurate: '不准确',
  irrelevant: '不相关',
  harmful: '有害',
  other: '其他',
};

const STATUS_TAGS = {
  pending: { label: '待处理', color: 'orange' },
  resolved: { label: '已处理', color: 'green' },
  ignored: { label: '已忽略', color: 'grey' },
} as const;

interface FeedbackHandleFormValues {
  status: AiFeedbackStatus;
  remark?: string | null;
}

function renderReason(reason: AiMessage['feedbackReason']) {
  if (!reason) return '—';
  return <Tag color="grey" size="small">{REASON_LABELS[reason] ?? reason}</Tag>;
}

function renderStatus(status: AiMessage['feedbackStatus']) {
  if (!status) return '—';
  const config = STATUS_TAGS[status];
  return <Tag color={config.color} size="small">{config.label}</Tag>;
}

function normalizeRemark(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
}

export default function AiFeedbackPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [feedbackFilter, setFeedbackFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { page, pageSize, setPage, setPageSize } = usePagination();
  const [data, setData] = useState<{ list: AiMessage[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [handlingMessage, setHandlingMessage] = useState<AiMessage | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async (p = page, ps = pageSize, fb = feedbackFilter, status = statusFilter) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (fb) qs.set('feedback', fb);
      if (status) qs.set('status', status);
      const res = await request.get<{ list: AiMessage[]; total: number; page: number; pageSize: number }>(
        `/api/ai/conversations/admin/feedback?${qs.toString()}`
      );
      if (res.code === 0 && res.data) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, feedbackFilter, statusFilter]);

  // Initial load
  useEffect(() => { void fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => { setPage(1); void fetchData(1, pageSize, feedbackFilter, statusFilter); };
  const handleReset = () => { setFeedbackFilter(''); setStatusFilter(''); setPage(1); void fetchData(1, pageSize, '', ''); };

  function openHandleModal(record: AiMessage) {
    setHandlingMessage(record);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setHandlingMessage(null);
  }

  async function handleModalOk() {
    if (!handlingMessage) return;
    let values: FeedbackHandleFormValues;
    try {
      values = (await formApi.current?.validate()) as FeedbackHandleFormValues;
    } catch {
      throw new Error('validation');
    }

    setSubmitting(true);
    try {
      const res = await request.put<null>(`/api/ai/conversations/admin/feedback/${handlingMessage.id}`, {
        status: values.status,
        remark: normalizeRemark(values.remark),
      });
      if (res.code === 0) {
        Toast.success('处理成功');
        closeModal();
        void fetchData();
      } else {
        throw new Error(res.message || '处理失败');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const formInitValues: FeedbackHandleFormValues = {
    status: handlingMessage?.feedbackStatus ?? 'resolved',
    remark: handlingMessage?.feedbackRemark ?? '',
  };

  const columns: ColumnProps<AiMessage>[] = [
    {
      title: '反馈',
      dataIndex: 'feedback',
      width: 80,
      align: 'center',
      fixed: 'left',
      render: (v: number) => v === 1
        ? <Tag color="green" size="small"><ThumbsUp size={11} style={{ verticalAlign: -2, marginRight: 3 }} />点赞</Tag>
        : <Tag color="red" size="small"><ThumbsDown size={11} style={{ verticalAlign: -2, marginRight: 3 }} />点踩</Tag>,
    },
    {
      title: 'AI 回复内容',
      dataIndex: 'content',
      render: (v: string) => (
        <Text ellipsis={{ showTooltip: { opts: { style: { maxWidth: 600 } } } }} style={{ fontSize: 13 }}>
          {v}
        </Text>
      ),
    },
    { title: '对话 ID', dataIndex: 'conversationId', width: 90, align: 'center' },
    { title: '消息 ID', dataIndex: 'id', width: 90, align: 'center' },
    {
      title: '原因',
      dataIndex: 'feedbackReason',
      width: 90,
      render: (v: AiMessage['feedbackReason']) => renderReason(v),
    },
    {
      title: '模型',
      dataIndex: 'model',
      width: 120,
      render: (v: AiMessage['model']) => v || '—',
    },
    {
      title: '处理备注',
      dataIndex: 'feedbackRemark',
      width: 160,
      render: renderEllipsis,
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(v)}</span>,
    },
    {
      title: '处理状态',
      dataIndex: 'feedbackStatus',
      width: 90,
      fixed: 'right',
      render: (v: AiMessage['feedbackStatus']) => renderStatus(v),
    },
    {
      title: '操作',
      dataIndex: 'operation',
      width: 90,
      fixed: 'right',
      render: (_: unknown, record) => (
        hasPermission('ai:feedback:handle') ? (
          <Space>
            <Button theme="borderless" size="small" onClick={() => openHandleModal(record)}>
              处理
            </Button>
          </Space>
        ) : null
      ),
    },
  ];

  const renderFeedbackFilter = () => (
    <Select
      value={feedbackFilter}
      onChange={(v) => setFeedbackFilter(String(v))}
      optionList={FEEDBACK_OPTIONS}
      style={{ width: 120 }}
      placeholder="反馈类型"
    />
  );

  const renderStatusFilter = () => (
    <Select
      value={statusFilter}
      onChange={(v) => setStatusFilter(String(v))}
      optionList={STATUS_FILTER_OPTIONS}
      style={{ width: 120 }}
      placeholder="处理状态"
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  );

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
      <SearchToolbar
        primary={(
          <>
            {renderFeedbackFilter()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        mobilePrimary={renderSearchButton()}
        mobileFilters={(
          <>
            {renderFeedbackFilter()}
            {renderStatusFilter()}
          </>
        )}
        filterTitle="反馈筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      <div style={{ flex: 1, minHeight: 0, marginTop: 12 }}>
        <ConfigurableTable<AiMessage>
          bordered
          rowKey="id"
          columns={columns}
          dataSource={data?.list ?? []}
          loading={loading}
          onRefresh={() => void fetchData()}
          refreshLoading={loading}
          pagination={{
            total: data?.total ?? 0,
            currentPage: page,
            pageSize,
            pageSizeOpts: [10, 20, 50],
            showSizeChanger: true,
            showTotal: true,
            onPageChange: (p) => { setPage(p); void fetchData(p, pageSize, feedbackFilter, statusFilter); },
            onPageSizeChange: (ps) => { setPageSize(ps); setPage(1); void fetchData(1, ps, feedbackFilter, statusFilter); },
          }}
        />
      </div>
      <AppModal
        title="处理反馈"
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: submitting }}
        width={500}
        closeOnEsc
      >
        <Form
          key={handlingMessage?.id ?? 'feedback-handle'}
          getFormApi={(api) => {
            formApi.current = api;
          }}
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Select
            field="status"
            label="处理状态"
            optionList={HANDLE_STATUS_OPTIONS}
            style={{ width: '100%' }}
            rules={[{ required: true, message: '请选择处理状态' }]}
          />
          <Form.TextArea
            field="remark"
            label="备注"
            rows={4}
            maxLength={500}
            style={{ width: '100%' }}
            placeholder="请输入处理备注（可选）"
          />
        </Form>
      </AppModal>
    </div>
  );
}
