import { useMemo, useState } from 'react';
import { compactParams } from '@/lib/query';
import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { aiAuditContract } from '@zenith/shared/ai';
import type { AiFeedbackItem } from '@zenith/shared/ai';
import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { enumValueOf } from '@zenith/shared/core';
import { formatDateForApi } from '@/utils/date';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { useListSearch } from '@/hooks/useListSearch';
import AppModal from '@/components/AppModal';
import AiConversationContextModal from '../components/AiConversationContextModal';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { contractKey, useApiQuery } from '@/lib/contract-query';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
import { AiMessageSnippet, AiUserCell } from '../ai-display';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';

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

interface AuditSearch { keyword: string; role?: string; range: [Date, Date] | null }

/** 对话内容合规审计：跨用户全量消息检索 */
export default function AiAuditPage() {
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams: submitted,
    handleSearch, handleReset,
  } = useListSearch<AuditSearch>({ defaults: { keyword: '', range: null }, listKey: auditKeys.lists });
  const [contextMsgId, setContextMsgId] = useState<number | null>(null);
  const [traceMsg, setTraceMsg] = useState<AiFeedbackItem | null>(null);
  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    keyword: submitted.keyword,
    role: enumValueOf(AUDIT_ROLES, submitted.role),
    startDate: submitted.range?.[0] ? formatDateForApi(submitted.range[0]) : undefined,
    endDate: submitted.range?.[1] ? formatDateForApi(submitted.range[1]) : undefined,
  }), [submitted]);
  const listQuery = useAuditList({ page, pageSize, ...filterQuery });
  const contextQuery = useAuditContext(contextMsgId);

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
      render: (_: unknown, record) => <AiUserCell username={record.username} nickname={record.nickname} />,
    },
    {
      title: '消息内容',
      dataIndex: 'content',
      minWidth: 320,
      render: (v: string) => <AiMessageSnippet text={v} />,
    },
    {
      title: '对话',
      dataIndex: 'conversationTitle',
      width: 160,
      render: renderEllipsis,
    },
    { title: '模型', dataIndex: 'model', width: 130, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
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

  return (
    <div className="page-container">
      <ListSearchToolbar
        filters={(
          <>
            <KeywordInput placeholder="搜索消息内容" {...bindKeyword('keyword')} />
            <FilterSelect
              placeholder="全部角色"
              items={ROLE_OPTIONS}
              {...bind('role')}
            />
            <DateRangeFilter type="dateRange" {...bind('range')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="审计筛选"
      />
      <ConfigurableTable<AiFeedbackItem>
        columns={columns}
        {...listTableProps(listQuery, {
          // showTotal / showSizeChanger 由 ConfigurableTable 按桌面 / 移动端决定，这里只覆盖页大小候选
          pagination: (total) => ({ ...buildPagination(total), pageSizeOpts: [10, 20, 50] }),
        })}
      />
      <AiConversationContextModal
        visible={contextMsgId !== null}
        loading={contextQuery.isFetching}
        context={contextQuery.data}
        onClose={() => setContextMsgId(null)}
      />
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
              总耗时 {traceMsg.durationMs ?? EMPTY_PLACEHOLDER} ms · 首字延迟 {traceMsg.ttftMs ?? EMPTY_PLACEHOLDER} ms · Token {traceMsg.tokensInput}+{traceMsg.tokensOutput}
            </Text>
          )}
        </div>
      </AppModal>
    </div>
  );
}
