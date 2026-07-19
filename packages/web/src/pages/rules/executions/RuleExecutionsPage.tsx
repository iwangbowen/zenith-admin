import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Input, Select, SideSheet, Space, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw, Search } from 'lucide-react';
import type { RuleDecisionExecution } from '@zenith/shared';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { ruleKeys, useRuleExecutions } from '@/hooks/queries/rules';
import { formatDateTimeForApi } from '@/utils/date';

const { Text } = Typography;

const SOURCE_META: Record<string, { text: string; color: 'blue' | 'purple' | 'cyan' }> = {
  runtime: { text: '运行时', color: 'blue' },
  manual: { text: '手动', color: 'purple' },
  test: { text: '测试', color: 'cyan' },
};

interface Filters {
  ruleKey?: string;
  source?: 'runtime' | 'manual' | 'test';
  matched?: boolean;
  dateStart?: string;
  dateEnd?: string;
}

/** 规则中心 · 决策执行记录（跨表 trace / 审计） */
export default function RuleExecutionsPage() {
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draft, setDraft] = useState<Filters>({});
  const [submitted, setSubmitted] = useState<Filters>({});
  const [detail, setDetail] = useState<RuleDecisionExecution | null>(null);

  const listQuery = useRuleExecutions({ page, pageSize, ...submitted });
  const data = listQuery.data ?? null;

  const handleSearch = () => {
    setPage(1);
    setSubmitted(draft);
    void queryClient.invalidateQueries({ queryKey: ruleKeys.decisionTables.all });
  };
  const handleReset = () => {
    setDraft({});
    setSubmitted({});
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: ruleKeys.decisionTables.all });
  };

  const columns: ColumnProps<RuleDecisionExecution>[] = [
    { title: '时间', dataIndex: 'createdAt', width: 170 },
    { title: '决策表 Key', dataIndex: 'ruleKey', width: 170, render: (t: string) => <Text code>{t}</Text> },
    { title: '来源', dataIndex: 'source', width: 90, render: (s: string) => <Tag size="small" color={SOURCE_META[s]?.color}>{SOURCE_META[s]?.text ?? s}</Tag> },
    { title: '结果', dataIndex: 'matched', width: 90, render: (m: boolean) => <Tag size="small" color={m ? 'green' : 'red'}>{m ? '命中' : '未命中'}</Tag> },
    { title: '命中行', width: 130, render: (_: unknown, r: RuleDecisionExecution) => <Text type="tertiary" size="small">{r.matchedRowIds.join(', ') || '-'}</Text> },
    { title: '流程实例', width: 130, render: (_: unknown, r: RuleDecisionExecution) => (r.instanceId ? <Text type="tertiary" size="small">#{r.instanceId}{r.nodeKey ? ` · ${r.nodeKey}` : ''}</Text> : '-') },
    { title: '输出', render: (_: unknown, r: RuleDecisionExecution) => <Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 320 }}>{JSON.stringify(r.outputs)}</Text> },
    createOperationColumn<RuleDecisionExecution>({
      desktopInlineKeys: ['detail'],
      actions: (r) => [{ key: 'detail', label: '详情', onClick: () => setDetail(r) }],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="决策表 Key" value={draft.ruleKey ?? ''} onChange={(v) => setDraft((p) => ({ ...p, ruleKey: v || undefined }))} onEnterPress={handleSearch} showClear style={{ width: 200 }} />
            <Select placeholder="来源" value={draft.source} onChange={(v) => setDraft((p) => ({ ...p, source: v as Filters['source'] }))} optionList={[{ value: 'runtime', label: '运行时' }, { value: 'manual', label: '手动' }, { value: 'test', label: '测试' }]} showClear style={{ width: 120 }} />
            <Select placeholder="结果" value={draft.matched === undefined ? undefined : String(draft.matched)} onChange={(v) => setDraft((p) => ({ ...p, matched: v === undefined ? undefined : v === 'true' }))} optionList={[{ value: 'true', label: '命中' }, { value: 'false', label: '未命中' }]} showClear style={{ width: 110 }} />
            <DatePicker
              type="dateTimeRange"
              value={draft.dateStart && draft.dateEnd ? [draft.dateStart, draft.dateEnd] : undefined}
              onChange={(dates) => {
                const range = dates as Date[] | undefined;
                setDraft((p) => ({
                  ...p,
                  dateStart: range?.[0] ? formatDateTimeForApi(range[0]) : undefined,
                  dateEnd: range?.[1] ? formatDateTimeForApi(range[1]) : undefined,
                }));
              }}
              style={{ width: 360 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
      />
      <ConfigurableTable bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} rowKey="id" size="small" empty="暂无执行记录" pagination={buildPagination(data?.total ?? 0)} />

      <SideSheet title={`执行详情 #${detail?.id ?? ''}`} visible={!!detail} onCancel={() => setDetail(null)} width={560}>
        {detail && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Space spacing={8} wrap>
              <Tag color={detail.matched ? 'green' : 'red'}>{detail.matched ? '命中' : '未命中'}</Tag>
              <Tag size="small" color={SOURCE_META[detail.source]?.color}>{SOURCE_META[detail.source]?.text ?? detail.source}</Tag>
              <Tag size="small">{detail.hitPolicy}</Tag>
              <Text type="tertiary" size="small">{detail.createdAt}</Text>
            </Space>
            <div>
              <Text strong size="small">决策表</Text>
              <Text style={{ display: 'block', marginTop: 4 }} code>{detail.ruleKey}{detail.tableId ? ` (#${detail.tableId})` : ''}</Text>
            </div>
            {detail.instanceId && (
              <div>
                <Text strong size="small">流程上下文</Text>
                <Text style={{ display: 'block', marginTop: 4 }} type="tertiary" size="small">实例 #{detail.instanceId}{detail.nodeKey ? ` · 节点 ${detail.nodeKey}` : ''}</Text>
              </div>
            )}
            <div>
              <Text strong size="small">命中行</Text>
              <Text style={{ display: 'block', marginTop: 4 }} type="tertiary" size="small">{detail.matchedRowIds.join(', ') || '-'}</Text>
            </div>
            <div>
              <Text strong size="small">输入</Text>
              <pre style={{ margin: '4px 0 0', padding: 8, background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)', whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(detail.input, null, 2)}</pre>
            </div>
            <div>
              <Text strong size="small">输出</Text>
              <pre style={{ margin: '4px 0 0', padding: 8, background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)', whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(detail.outputs, null, 2)}</pre>
            </div>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
