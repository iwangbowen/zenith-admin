import { useState } from 'react';
import { Button, DatePicker, Input, Select, Tag, Typography } from '@douyinfe/semi-ui';
import { RotateCcw, Search } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { AiFeedbackItem, PaginatedResponse } from '@zenith/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatDateForApi } from '@/utils/date';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import AppModal from '@/components/AppModal';
import { renderEllipsis } from '@/utils/table-columns';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';
import type { AiFeedbackContext } from '@/hooks/queries/ai-feedback';

const { Text } = Typography;

interface AuditParams {
  page: number;
  pageSize: number;
  keyword?: string;
  role?: string;
  startDate?: string;
  endDate?: string;
}

const auditKeys = {
  lists: ['ai-audit', 'list'] as const,
  list: (params: AuditParams) => ['ai-audit', 'list', params] as const,
  context: (msgId: number | null) => ['ai-audit', 'context', msgId] as const,
};

function useAuditList(params: AuditParams) {
  return useQuery({
    queryKey: auditKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<AiFeedbackItem>>(`/api/ai/audit/messages${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

function useAuditContext(msgId: number | null) {
  return useQuery({
    queryKey: auditKeys.context(msgId),
    queryFn: () => request.get<AiFeedbackContext>(`/api/ai/audit/messages/${msgId}/context`).then(unwrap),
    enabled: msgId !== null,
  });
}

const ROLE_OPTIONS = [
  { value: '', label: '全部角色' },
  { value: 'user', label: '用户提问' },
  { value: 'assistant', label: 'AI 回复' },
];

/** 对话内容合规审计：跨用户全量消息检索 */
export default function AiAuditPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ keyword: '', role: '' });
  const [draftRange, setDraftRange] = useState<[Date, Date] | null>(null);
  const [submitted, setSubmitted] = useState({ keyword: '', role: '', startDate: '', endDate: '' });
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [contextMsgId, setContextMsgId] = useState<number | null>(null);
  const [traceMsg, setTraceMsg] = useState<AiFeedbackItem | null>(null);
  const listQuery = useAuditList({
    page,
    pageSize,
    keyword: submitted.keyword || undefined,
    role: submitted.role || undefined,
    startDate: submitted.startDate || undefined,
    endDate: submitted.endDate || undefined,
  });
  const data = listQuery.data ?? null;
  const contextQuery = useAuditContext(contextMsgId);

  const handleSearch = () => {
    setPage(1);
    setSubmitted({
      ...draft,
      startDate: draftRange?.[0] ? formatDateForApi(draftRange[0]) : '',
      endDate: draftRange?.[1] ? formatDateForApi(draftRange[1]) : '',
    });
    void queryClient.invalidateQueries({ queryKey: auditKeys.lists });
  };
  const handleReset = () => {
    setDraft({ keyword: '', role: '' });
    setDraftRange(null);
    setSubmitted({ keyword: '', role: '', startDate: '', endDate: '' });
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: auditKeys.lists });
  };

  const columns: ColumnProps<AiFeedbackItem>[] = [
    {
      title: '角色',
      dataIndex: 'role',
      width: 90,
      align: 'center',
      fixed: 'left',
      render: (v: string) => v === 'user'
        ? <Tag color="blue" size="small">用户</Tag>
        : <Tag color="green" size="small">AI</Tag>,
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
      title: '消息内容',
      dataIndex: 'content',
      width: 320,
      render: (v: string) => (
        <Text ellipsis={{ showTooltip: { opts: { style: { maxWidth: 600 } } } }} style={{ fontSize: 13 }}>{v}</Text>
      ),
    },
    {
      title: '对话',
      dataIndex: 'conversationTitle',
      width: 160,
      render: (v: string | null) => v ? renderEllipsis(v) : '—',
    },
    { title: '模型', dataIndex: 'model', width: 130, render: (v: string | null) => v || '—' },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 180,
      fixed: 'right',
      render: (v: string) => <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(v)}</span>,
    },
    createOperationColumn<AiFeedbackItem>({
      width: 130,
      desktopInlineKeys: ['context', 'trace'],
      actions: (record) => [
        { key: 'context', label: '上下文', onClick: () => setContextMsgId(record.id) },
        {
          key: 'trace',
          label: 'Trace',
          hidden: record.role !== 'assistant' || !record.trace?.length,
          onClick: () => setTraceMsg(record),
        },
      ],
    }),
  ];

  const renderKeyword = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索消息内容"
      value={draft.keyword}
      onChange={(v) => setDraft((p) => ({ ...p, keyword: String(v ?? '') }))}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 220 }}
    />
  );
  const renderRole = () => (
    <Select value={draft.role} onChange={(v) => setDraft((p) => ({ ...p, role: String(v ?? '') }))} optionList={ROLE_OPTIONS} style={{ width: 120 }} />
  );
  const renderRange = () => (
    <DatePicker
      type="dateRange"
      placeholder={['开始日期', '结束日期']}
      value={draftRange ?? undefined}
      onChange={(value) => {
        if (Array.isArray(value) && value.length >= 2 && value[0] instanceof Date && value[1] instanceof Date) setDraftRange([value[0], value[1]]);
        else setDraftRange(null);
      }}
      style={{ width: 260 }}
    />
  );
  const renderSearchBtn = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetBtn = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
      <SearchToolbar
        primary={(
          <>
            {renderKeyword()}
            {renderRole()}
            {renderRange()}
            {renderSearchBtn()}
            {renderResetBtn()}
          </>
        )}
        mobilePrimary={renderSearchBtn()}
        mobileFilters={(
          <>
            {renderKeyword()}
            {renderRole()}
            {renderRange()}
          </>
        )}
        filterTitle="审计筛选"
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
                      border: isTarget ? '1.5px solid var(--semi-color-warning)' : '1px solid transparent',
                    }}
                  >
                    <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 2 }}>
                      {isUser ? '用户' : `AI${m.model ? ` · ${m.model}` : ''}`} · {formatDateTime(m.createdAt)}
                      {isTarget && <Tag color="orange" size="small" style={{ marginLeft: 6 }}>目标消息</Tag>}
                    </Text>
                    {m.content}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AppModal>
      <AppModal
        title="生成调用链 Trace"
        visible={traceMsg !== null}
        onCancel={() => setTraceMsg(null)}
        footer={null}
        width={560}
        closeOnEsc
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(traceMsg?.trace ?? []).map((step, i) => {
            const colors: Record<string, string> = {
              retrieval: 'var(--semi-color-info)',
              tool_call: 'var(--semi-color-warning)',
              llm_round: 'var(--semi-color-primary)',
              failover: 'var(--semi-color-danger)',
            };
            return (
              <div key={`${step.type}-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: colors[step.type] ?? 'var(--semi-color-text-3)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <Text strong style={{ fontSize: 13 }}>{step.label}</Text>
                    <Text type="tertiary" style={{ fontSize: 12, flexShrink: 0 }}>{step.durationMs} ms</Text>
                  </div>
                  {step.meta && (
                    <Text type="tertiary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                      {Object.entries(step.meta).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')}
                    </Text>
                  )}
                </div>
              </div>
            );
          })}
          {traceMsg && (
            <Text type="tertiary" style={{ fontSize: 12, marginTop: 4 }}>
              总耗时 {traceMsg.durationMs ?? '—'} ms · 首字延迟 {traceMsg.ttftMs ?? '—'} ms · Token {traceMsg.tokensInput}+{traceMsg.tokensOutput}
            </Text>
          )}
        </div>
      </AppModal>
    </div>
  );
}
