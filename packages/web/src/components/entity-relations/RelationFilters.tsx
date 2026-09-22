import { Button, Checkbox, Space } from '@douyinfe/semi-ui';
import type { EntityRelationSection } from '@zenith/shared/platform';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
import type { UseListSearchReturn } from '@/hooks/useListSearch';

export interface RelationSearchState {
  keyword: string;
  status: string | undefined;
  range: [Date, Date] | null;
  attentionOnly: boolean;
}

export default function RelationFilters({ section, search }: {
  readonly section: EntityRelationSection;
  readonly search: UseListSearchReturn<RelationSearchState>;
}) {
  const supported = section.filters;
  return <Space wrap spacing={8} style={{ padding: '4px 0 12px', width: '100%' }}>
    {supported?.keyword && <KeywordInput aria-label="关联记录关键词" placeholder="搜索关联记录" {...search.bindKeyword('keyword')} width={180} />}
    {Boolean(supported?.statusOptions?.length) && <FilterSelect aria-label="关联记录状态" placeholder="全部状态" items={supported!.statusOptions!} {...search.bind('status')} />}
    {supported?.dateRange && <DateRangeFilter {...search.bind('range')} />}
    {supported?.attentionOnly && <Checkbox checked={search.draftParams.attentionOnly} onChange={(event) => search.setField('attentionOnly')(Boolean(event.target.checked))}>仅看需处理</Checkbox>}
    <Button size="small" onClick={search.handleSearch}>查询</Button>
    <Button size="small" theme="borderless" onClick={search.handleReset}>重置</Button>
  </Space>;
}
