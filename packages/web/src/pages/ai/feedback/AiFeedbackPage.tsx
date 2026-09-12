import { useMemo, useState, useRef } from 'react';
import { compactParams } from '@/lib/query';
import { Button, Form, Tag, Toast } from '@douyinfe/semi-ui';
import { Download, ThumbsUp, ThumbsDown } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { AiFeedbackItem, AiFeedbackStatus, AiMessage } from '@zenith/shared/ai';
import { AI_FEEDBACK_STATUSES } from '@zenith/shared/ai';
import { enumValueOf } from '@zenith/shared/core';
import { formatDateForApi } from '@/utils/date';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { useListSearch } from '@/hooks/useListSearch';
import { useDictItems } from '@/hooks/useDictItems';
import { usePermission } from '@/hooks/usePermission';
import AppModal from '@/components/AppModal';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { aiFeedbackKeys, downloadAiFeedbackCsv, useAiFeedbackContext, useAiFeedbackList, useHandleAiFeedback } from '@/hooks/queries/ai-feedback';
import { DateRangeFilter, FilterSelect } from '@/components/search-filters';
import { abortSubmit } from '@/lib/abort-submit';
import AiConversationContextModal from '../components/AiConversationContextModal';
import { AiMessageSnippet, AiUserCell } from '../ai-display';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';

const FEEDBACK_OPTIONS = [
  { value: '1', label: '👍 点赞' },
  { value: '-1', label: '👎 点踩' },
];

/** 反馈类型查询值（与 FEEDBACK_OPTIONS 的 value 一致） */
const FEEDBACK_FILTER_VALUES = ['1', '-1'] as const;

const STATUS_FILTER_OPTIONS = [
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
  if (!reason) return EMPTY_PLACEHOLDER;
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
  if (!status) return EMPTY_PLACEHOLDER;
  const config = STATUS_TAGS[status];
  return <Tag color={config.color} size="small">{config.label}</Tag>;
}

function normalizeRemark(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
}

interface SearchParams { feedback?: string; status?: string; model?: string; timeRange: [Date, Date] | null }
const defaultSearchParams: SearchParams = { feedback: undefined, status: undefined, model: undefined, timeRange: null };

export default function AiFeedbackPage() {
  const { hasPermission } = usePermission();
  const { getLabel: getReasonLabel } = useDictItems('ai_dislike_reason');
  // useEditModal 例外：反馈处理动作表单（标记处理结果 / 备注），非实体新增 / 编辑
  const formApi = useRef<FormApi | null>(null);
  const {
    page, pageSize, buildPagination,
    bind, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: aiFeedbackKeys.lists });
  const [modalVisible, setModalVisible] = useState(false);
  const [handlingMessage, setHandlingMessage] = useState<AiFeedbackItem | null>(null);
  const [contextMsgId, setContextMsgId] = useState<number | null>(null);
  // 筛选值来自 Select 字符串，收窄为契约枚举后再进入查询
  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    feedback: enumValueOf(FEEDBACK_FILTER_VALUES, submittedParams.feedback),
    status: enumValueOf(AI_FEEDBACK_STATUSES, submittedParams.status),
    model: submittedParams.model,
    startDate: submittedParams.timeRange ? formatDateForApi(submittedParams.timeRange[0]) : undefined,
    endDate: submittedParams.timeRange ? formatDateForApi(submittedParams.timeRange[1]) : undefined,
  }), [submittedParams]);
  const listQuery = useAiFeedbackList({ page, pageSize, ...filterQuery });
  const data = listQuery.data ?? null;
  const handleMutation = useHandleAiFeedback();
  const contextQuery = useAiFeedbackContext(contextMsgId);

  // 模型筛选选项：从当前页数据聚合（含历史模型）
  const modelOptions = Array.from(new Set((data?.list ?? []).map((m) => m.model).filter((m): m is string => !!m)))
    .map((m) => ({ value: m, label: m }));

  const handleExport = () => {
    void downloadAiFeedbackCsv(filterQuery);
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
      abortSubmit('validation');
    }

    await handleMutation.mutateAsync({
      params: { msgId: handlingMessage.id },
      body: {
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
      render: (_: unknown, record) => <AiUserCell username={record.username} nickname={record.nickname} />,
    },
    {
      title: '用户提问',
      dataIndex: 'question',
      width: 220,
      render: (v: string | null) => <AiMessageSnippet text={v} maxWidth={480} />,
    },
    {
      title: 'AI 回复内容',
      dataIndex: 'content',
      minWidth: 260,
      render: (v: string) => <AiMessageSnippet text={v} />,
    },
    {
      title: '对话',
      dataIndex: 'conversationTitle',
      width: 140,
      render: renderEllipsis,
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
      render: (v: AiMessage['model']) => v || EMPTY_PLACEHOLDER,
    },
    {
      title: '处理备注',
      dataIndex: 'feedbackRemark',
      width: 160,
      render: renderEllipsis,
    },
    dateTimeColumn('时间', 'createdAt'),
    {
      title: '处理状态',
      dataIndex: 'feedbackStatus',
      width: 90,
      fixed: 'right',
      render: (v: AiMessage['feedbackStatus']) => renderStatus(v),
    },
    createOperationColumn<AiFeedbackItem>({
      width: 170,
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

  const renderExportButton = () => (
    <Button type="primary" icon={<Download size={14} />} onClick={handleExport}>导出</Button>
  );

  return (
    <div className="page-container">
      <ListSearchToolbar
        filters={(
          <>
            <FilterSelect
              placeholder="全部反馈类型"
              items={FEEDBACK_OPTIONS}
              {...bind('feedback', (v) => String(v))}
              width={140}
            />
            <FilterSelect
              placeholder="全部处理状态"
              items={STATUS_FILTER_OPTIONS}
              {...bind('status', (v) => String(v))}
              width={140}
            />
            <FilterSelect
              placeholder="全部模型"
              items={modelOptions}
              {...bind('model')}
              width={160}
              filter
            />
            <DateRangeFilter type="dateRange" {...bind('timeRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={renderExportButton()}
        mobileActions={renderExportButton()}
        filterTitle="反馈筛选"
      />
      <ConfigurableTable<AiFeedbackItem>
        columns={columns}
        {...listTableProps(listQuery, {
          // showTotal / showSizeChanger 由 ConfigurableTable 按桌面 / 移动端决定，这里只覆盖页大小候选
          pagination: (total) => ({ ...buildPagination(total), pageSizeOpts: [10, 20, 50] }),
        })}
      />
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
      <AiConversationContextModal
        visible={contextMsgId !== null}
        loading={contextQuery.isFetching}
        context={contextQuery.data}
        onClose={() => setContextMsgId(null)}
        targetLabel="被反馈"
        targetColor="red"
      />
    </div>
  );
}
