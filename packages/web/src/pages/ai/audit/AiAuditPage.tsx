import { useState } from 'react';
import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { aiAuditContract } from '@zenith/shared/ai';
import type { AiFeedbackItem } from '@zenith/shared/ai';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { enumValueOf } from '@zenith/shared/core';
import { formatDateForApi } from '@/utils/date';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import AppModal from '@/components/AppModal';
import AiMessagesViewer from '../components/AiMessagesViewer';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { contractKey, useApiQuery } from '@/lib/contract-query';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';

const { Text } = Typography;

type AuditParams = NonNullable<QueryOf<typeof aiAuditContract.messages>>;

const AUDIT_ROLES = ['user', 'assistant'] as const;

const auditKeys = {
  lists: contractKey(aiAuditContract.messages),
};

function useAuditList(params: AuditParams) {
  return useApiQuery(aiAuditContract.messages, { query: params }, { placeholderData: keepPreviousData });
}

function useAuditContext(msgId: number | null) {
  return useApiQuery(aiAuditContract.messageContext, { params: { msgId: msgId ?? 0 } }, { enabled: msgId !== null });
}

const ROLE_OPTIONS = [
  { value: 'user', label: '用户提问' },
  { value: 'assistant', label: 'AI 回复' },
];

/** 对话内容合规审计：跨用户全量消息检索 */
export default function AiAuditPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<{ keyword: string; role?: string }>({ keyword: '' });
  const [draftRange, setDraftRange] = useState<[Date, Date] | null>(null);
  const [submitted, setSubmitted] = useState<{ keyword: string; role?: string; startDate: string; endDate: string }>({ keyword: '', startDate: '', endDate: '' });
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [contextMsgId, setContextMsgId] = useState<number | null>(null);
  const [traceMsg, setTraceMsg] = useState<AiFeedbackItem | null>(null);
  const listQuery = useAuditList({
    page,
    pageSize,
    keyword: submitted.keyword || undefined,
    role: enumValueOf(AUDIT_ROLES, submitted.role),
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
    setDraft({ keyword: '' });
    setDraftRange(null);
    setSubmitted({ keyword: '', startDate: '', endDate: '' });
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
      minWidth: 320,
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
    dateTimeColumn('时间', 'createdAt', { fixed: 'right' }),
    createOperationColumn<AiFeedbackItem>({
      width: 180,
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
    <KeywordInput placeholder="搜索消息内容" value={draft.keyword} onChange={(v) => setDraft((p) => ({ ...p, keyword: String(v ?? '') }))} onSearch={handleSearch} />
  );
  const renderRole = () => (
    <FilterSelect
      placeholder="全部角色"
      items={ROLE_OPTIONS}
      value={draft.role}
      onChange={(v) => setDraft((p) => ({ ...p, role: v }))}
    />
  );
  const renderRange = () => (
    <DateRangeFilter type="dateRange" value={draftRange ?? undefined} onChange={(value) => {
        if (Array.isArray(value) && value.length >= 2 && value[0] instanceof Date && value[1] instanceof Date) setDraftRange([value[0], value[1]]);
        else setDraftRange(null);
      }} />
  );
  const renderSearchBtn = () => <SearchButton onClick={handleSearch} />;
  const renderResetBtn = () => <ResetButton onClick={handleReset} />;

  return (
    <div className="page-container">
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
      <AppModal
        title={contextQuery.data?.conversationTitle ? `对话上下文 — ${contextQuery.data.conversationTitle}` : '对话上下文'}
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
          <AiMessagesViewer
            messages={contextQuery.data?.messages ?? []}
            targetMsgId={contextQuery.data?.targetMsgId}
            userMeta={contextQuery.data?.user}
          />
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
