import { useState, useRef } from 'react';
import { Button, DatePicker, Form, Select, Tag, Typography, Toast } from '@douyinfe/semi-ui';
import { Download, RotateCcw, Search, ThumbsUp, ThumbsDown } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { AiFeedbackItem, AiFeedbackStatus, AiMessage } from '@zenith/shared';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatDateForApi } from '@/utils/date';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { useDictItems } from '@/hooks/useDictItems';
import { usePermission } from '@/hooks/usePermission';
import AppModal from '@/components/AppModal';
import { renderEllipsis } from '@/utils/table-columns';
import { aiFeedbackKeys, downloadAiFeedbackCsv, useAiFeedbackContext, useAiFeedbackList, useHandleAiFeedback } from '@/hooks/queries/ai-feedback';

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

function renderReason(reason: AiMessage['feedbackReason'], getLabel: (value: string) => string) {
  if (!reason) return '—';
  return <Tag color="grey" size="small">{getLabel(reason)}</Tag>;
}

const STATUS_TAGS = {
  pending: { label: '待处理', color: 'orange' },
  resolved: { label: '已处理', color: 'green' },
  ignored: { label: '已忽略', color: 'grey' },
} as const;

interface FeedbackHandleFormValues {
  status: AiFeedbackStatus;
  remark?: string | null;
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
  const queryClient = useQueryClient();
  const { getLabel: getReasonLabel } = useDictItems('ai_dislike_reason');
  const formApi = useRef<FormApi | null>(null);
  const [draftParams, setDraftParams] = useState({ feedback: '', status: '', model: '' });
  const [draftRange, setDraftRange] = useState<[Date, Date] | null>(null);
  const [submittedParams, setSubmittedParams] = useState({ feedback: '', status: '', model: '', startDate: '', endDate: '' });
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [modalVisible, setModalVisible] = useState(false);
  const [handlingMessage, setHandlingMessage] = useState<AiFeedbackItem | null>(null);
  const [contextMsgId, setContextMsgId] = useState<number | null>(null);
  const listQuery = useAiFeedbackList({
    page,
    pageSize,
    feedback: submittedParams.feedback || undefined,
    status: submittedParams.status || undefined,
    model: submittedParams.model || undefined,
    startDate: submittedParams.startDate || undefined,
    endDate: submittedParams.endDate || undefined,
  });
  const data = listQuery.data ?? null;
  const handleMutation = useHandleAiFeedback();
  const contextQuery = useAiFeedbackContext(contextMsgId);

  // 模型筛选选项：从当前页数据聚合（含历史模型）
  const modelOptions = [
    { value: '', label: '全部模型' },
    ...Array.from(new Set((data?.list ?? []).map((m) => m.model).filter((m): m is string => !!m)))
      .map((m) => ({ value: m, label: m })),
  ];

  const buildSubmitted = () => ({
    ...draftParams,
    startDate: draftRange?.[0] ? formatDateForApi(draftRange[0]) : '',
    endDate: draftRange?.[1] ? formatDateForApi(draftRange[1]) : '',
  });

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(buildSubmitted());
    void queryClient.invalidateQueries({ queryKey: aiFeedbackKeys.lists });
  };
  const handleReset = () => {
    setDraftParams({ feedback: '', status: '', model: '' });
    setDraftRange(null);
    setSubmittedParams({ feedback: '', status: '', model: '', startDate: '', endDate: '' });
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: aiFeedbackKeys.lists });
  };

  const handleExport = () => {
    const p = buildSubmitted();
    void downloadAiFeedbackCsv({
      feedback: p.feedback || undefined,
      status: p.status || undefined,
      model: p.model || undefined,
      startDate: p.startDate || undefined,
      endDate: p.endDate || undefined,
    });
  };

  function openHandleModal(record: AiFeedbackItem) {
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

    await handleMutation.mutateAsync({
      id: handlingMessage.id,
      values: {
        status: values.status,
        remark: normalizeRemark(values.remark),
      },
    });
    Toast.success('处理成功');
    closeModal();
  }

  const formInitValues: FeedbackHandleFormValues = {
    status: handlingMessage?.feedbackStatus ?? 'resolved',
    remark: handlingMessage?.feedbackRemark ?? '',
  };

  const columns: ColumnProps<AiFeedbackItem>[] = [
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
      title: '用户',
      dataIndex: 'username',
      width: 120,
      render: (_: unknown, record) => record.username ? (
        <div>
          <Text style={{ fontSize: 13 }}>{record.nickname || record.username}</Text>
          <Text type="tertiary" size="small" style={{ display: 'block' }}>{record.username}</Text>
        </div>
      ) : '—',
    },
    {
      title: '用户提问',
      dataIndex: 'question',
      width: 220,
      render: (v: string | null) => v ? (
        <Text ellipsis={{ showTooltip: { opts: { style: { maxWidth: 480 } } } }} style={{ fontSize: 13 }}>{v}</Text>
      ) : '—',
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
    {
      title: '对话',
      dataIndex: 'conversationTitle',
      width: 140,
      render: (v: string | null) => v ? renderEllipsis(v) : '—',
    },
    {
      title: '原因',
      dataIndex: 'feedbackReason',
      width: 90,
      render: (v: AiMessage['feedbackReason']) => renderReason(v, getReasonLabel),
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
    createOperationColumn<AiFeedbackItem>({
      width: 140,
      desktopInlineKeys: ['context', 'handle'],
      actions: (record) => [
        {
          key: 'context',
          label: '上下文',
          onClick: () => setContextMsgId(record.id),
        },
        {
          key: 'handle',
          label: '处理',
          hidden: !hasPermission('ai:feedback:handle'),
          onClick: () => openHandleModal(record),
        },
      ],
    }),
  ];

  const renderFeedbackFilter = () => (
    <Select
    value={draftParams.feedback}
    onChange={(v) => setDraftParams((prev) => ({ ...prev, feedback: String(v) }))}
      optionList={FEEDBACK_OPTIONS}
      style={{ width: 120 }}
      placeholder="反馈类型"
    />
  );

  const renderStatusFilter = () => (
    <Select
    value={draftParams.status}
    onChange={(v) => setDraftParams((prev) => ({ ...prev, status: String(v) }))}
      optionList={STATUS_FILTER_OPTIONS}
      style={{ width: 120 }}
      placeholder="处理状态"
    />
  );

  const renderModelFilter = () => (
    <Select
      value={draftParams.model}
      onChange={(v) => setDraftParams((prev) => ({ ...prev, model: String(v ?? '') }))}
      optionList={modelOptions}
      style={{ width: 160 }}
      placeholder="模型"
      showClear
      filter
    />
  );

  const renderDateRangeFilter = () => (
    <DatePicker
      type="dateRange"
      placeholder={['开始日期', '结束日期']}
      value={draftRange ?? undefined}
      onChange={(value) => {
        if (Array.isArray(value) && value.length >= 2 && value[0] instanceof Date && value[1] instanceof Date) {
          setDraftRange([value[0], value[1]]);
        } else {
          setDraftRange(null);
        }
      }}
      style={{ width: 260 }}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  );

  const renderExportButton = () => (
    <Button type="primary" icon={<Download size={14} />} onClick={handleExport}>导出</Button>
  );

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
      <SearchToolbar
        primary={(
          <>
            {renderFeedbackFilter()}
            {renderStatusFilter()}
            {renderModelFilter()}
            {renderDateRangeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        actions={renderExportButton()}
        mobilePrimary={renderSearchButton()}
        mobileFilters={(
          <>
            {renderFeedbackFilter()}
            {renderStatusFilter()}
            {renderModelFilter()}
            {renderDateRangeFilter()}
          </>
        )}
        mobileActions={renderExportButton()}
        filterTitle="反馈筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      <div style={{ flex: 1, minHeight: 0, marginTop: 12 }}>
        <ConfigurableTable<AiFeedbackItem>
          bordered
          rowKey="id"
          columns={columns}
          dataSource={data?.list ?? []}
          loading={listQuery.isFetching}
          onRefresh={() => void listQuery.refetch()}
          refreshLoading={listQuery.isFetching}
          pagination={{
            ...buildPagination(data?.total ?? 0),
            pageSizeOpts: [10, 20, 50],
            showSizeChanger: true,
            showTotal: true,
          }}
        />
      </div>
      <AppModal
        title="处理反馈"
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: handleMutation.isPending }}
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
      <AppModal
        title={`对话上下文${contextQuery.data?.conversationTitle ? ` — ${contextQuery.data.conversationTitle}` : ''}`}
        visible={contextMsgId !== null}
        onCancel={() => setContextMsgId(null)}
        footer={null}
        width={640}
        closeOnEsc
      >
        {contextQuery.isFetching ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Text type="tertiary">加载中…</Text>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
            {(contextQuery.data?.messages ?? []).map((m) => {
              const isTarget = m.id === contextQuery.data?.targetMsgId;
              const isUser = m.role === 'user';
              return (
                <div key={m.id} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                  <div
                    style={{
                      maxWidth: '85%',
                      padding: '8px 12px',
                      borderRadius: 'var(--semi-border-radius-large)',
                      fontSize: 13,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      background: isUser ? 'var(--semi-color-primary-light-default)' : 'var(--semi-color-fill-0)',
                      border: isTarget ? '1.5px solid var(--semi-color-danger)' : '1px solid transparent',
                    }}
                  >
                    <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 2 }}>
                      {isUser ? '用户' : `AI${m.model ? ` · ${m.model}` : ''}`} · {formatDateTime(m.createdAt)}
                      {isTarget && <Tag color="red" size="small" style={{ marginLeft: 6 }}>被反馈</Tag>}
                    </Text>
                    {m.content}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AppModal>
    </div>
  );
}
