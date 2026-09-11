import { listTableProps } from '@/components/list-page';
import { Space, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { RuleExecution, RuleExecutionSource, RuleRefKind } from '@zenith/shared/rules';
import { RULE_EXECUTION_SOURCE_LABELS, RULE_REF_KIND_LABELS, RULE_EXECUTION_SOURCES, RULE_REF_KINDS } from '@zenith/shared/rules';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { useListSearch } from '@/hooks/useListSearch';
import { ruleKeys, useRuleExecutions } from '@/hooks/queries/rules';
import { formatDateTimeRangeValuesForApi } from '@/utils/date';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
import { dateTimeColumn } from '@/utils/table-columns';
import { JsonBlock } from '@/components/JsonBlock';

const { Text } = Typography;

const SOURCE_COLORS: Record<RuleExecutionSource, 'blue' | 'purple' | 'cyan' | 'orange'> = {
  runtime: 'blue', manual: 'purple', test: 'cyan', open: 'orange',
};

const REF_KIND_COLORS: Record<RuleRefKind, 'indigo' | 'teal' | 'violet' | 'amber'> = {
  table: 'indigo', flow: 'teal', scorecard: 'violet', list: 'amber',
};

interface SearchParams {
  ruleKey?: string;
  refKind?: RuleRefKind;
  caller?: string;
  source?: RuleExecutionSource;
  /** 下拉以字符串承载，查询时再转布尔 */
  matched?: 'true' | 'false';
  range?: [Date, Date] | null;
}

const MATCHED_OPTIONS = [{ value: 'true', label: '命中' }, { value: 'false', label: '未命中' }] as const;

/** 规则中心 · 执行记录（决策表/决策流/评分卡/名单统一 trace / 审计） */
export default function RuleExecutionsPage() {
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: {}, listKey: ruleKeys.executions.all });

  const { range, matched, ...submittedFilters } = submittedParams;
  const [dateStart, dateEnd] = formatDateTimeRangeValuesForApi(range);
  const listQuery = useRuleExecutions({
    page, pageSize, ...submittedFilters,
    matched: matched === undefined ? undefined : matched === 'true',
    dateStart, dateEnd,
  });

  const columns: ColumnProps<RuleExecution>[] = [
    dateTimeColumn('时间', 'createdAt'),
    { title: '类型', dataIndex: 'refKind', width: 90, render: (k: RuleRefKind) => <Tag size="small" color={REF_KIND_COLORS[k]}>{RULE_REF_KIND_LABELS[k] ?? k}</Tag> },
    { title: '规则 Key', dataIndex: 'ruleKey', width: 170, render: (t: string) => <Text code>{t}</Text> },
    { title: '调用方名称', dataIndex: 'callerName', width: 170, render: (n: string | null) => (n ? <Text size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 150 }}>{n}</Text> : '-') },
    { title: '调用方', dataIndex: 'caller', width: 260, render: (c: string | null) => (c ? <Text type="tertiary" size="small" code ellipsis={{ showTooltip: true }} style={{ maxWidth: 240 }}>{c}</Text> : '-') },
    { title: '来源', dataIndex: 'source', width: 100, render: (s: RuleExecutionSource) => <Tag size="small" color={SOURCE_COLORS[s]}>{RULE_EXECUTION_SOURCE_LABELS[s] ?? s}</Tag> },
    { title: '结果', dataIndex: 'matched', width: 90, render: (m: boolean) => <Tag size="small" color={m ? 'green' : 'red'}>{m ? '命中' : '未命中'}</Tag> },
    { title: '版本', dataIndex: 'version', width: 70, render: (v: number | null) => (v != null ? <Text type="tertiary" size="small">v{v}</Text> : '-') },
    { title: '命中行', width: 120, render: (_: unknown, r: RuleExecution) => <Text type="tertiary" size="small">{r.matchedRowIds.join(', ') || '-'}</Text> },
    { title: '关联对象', dataIndex: 'bizRef', width: 200, render: (b: string | null) => (b ? <Text type="tertiary" size="small" code ellipsis={{ showTooltip: true }} style={{ maxWidth: 180 }}>{b}</Text> : '-') },
  ];

  /** 行内展开：命中策略上下文 + 输入 / 输出双栏对比 */
  const renderExpanded = (r?: RuleExecution) => (r ? (
    <div style={{ display: 'grid', gap: 12, padding: '4px 0' }}>
      <Space spacing={8} wrap>
        <Tag size="small" color={REF_KIND_COLORS[r.refKind]}>{RULE_REF_KIND_LABELS[r.refKind] ?? r.refKind}</Tag>
        {r.hitPolicy && <Tag size="small">{r.hitPolicy}</Tag>}
        <Text type="tertiary" size="small" code>{r.ruleKey}{r.refId ? ` (#${r.refId})` : ''}{r.version != null ? ` · v${r.version}` : ''}</Text>
        {r.caller && <Text type="tertiary" size="small">调用方 {r.callerName ?? r.caller}</Text>}
        {r.bizRef && <Text type="tertiary" size="small">关联 {r.bizRef}</Text>}
      </Space>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <Text strong size="small">输入</Text>
          <JsonBlock value={r.input} style={{ marginTop: 4 }} />
        </div>
        <div>
          <Text strong size="small">输出</Text>
          <JsonBlock value={r.outputs} style={{ marginTop: 4 }} />
        </div>
      </div>
    </div>
  ) : null);

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <KeywordInput placeholder="规则 Key" {...bindKeyword('ruleKey')} width={180} />
            <FilterSelect
              placeholder="全部类型"
              items={RULE_REF_KINDS.map((k) => ({ value: k, label: RULE_REF_KIND_LABELS[k] }))}
              {...bind('refKind')}
            />
            <KeywordInput placeholder="调用方" {...bindKeyword('caller')} width={150} />
            <FilterSelect
              placeholder="全部来源"
              items={RULE_EXECUTION_SOURCES.map((s) => ({ value: s, label: RULE_EXECUTION_SOURCE_LABELS[s] }))}
              {...bind('source')}
            />
            <FilterSelect
              placeholder="全部结果"
              items={MATCHED_OPTIONS}
              {...bind('matched')}
            />
            <DateRangeFilter {...bind('range')} />
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
          </>
        )}
      />
      <ConfigurableTable

        columns={columns}






        empty="暂无执行记录"

        expandedRowRender={renderExpanded}
        hideExpandedColumn={false}
        expandRowByClick
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />
    </div>
  );
}
