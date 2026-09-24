import { useDeferredValue, useRef, useState } from 'react';
import { Pagination, Select, Space } from '@douyinfe/semi-ui';
import { useCmsPageList } from '@/hooks/queries/cms-pages';
import { useCmsWidgetList } from '@/hooks/queries/cms-widgets';
import { COMPACT_PAGINATION_PROPS, usePagination } from '@/hooks/usePagination';

export default function CmsConfigurationPicker({ kind, siteId, value, onChange }: Readonly<{
  kind: 'page' | 'widget'; siteId?: number; value: number[]; onChange: (value: number[]) => void;
}>) {
  const [keyword, setKeyword] = useState('');
  const search = useDeferredValue(keyword);
  const pagination = usePagination({ pageSize: 30, resetKey: [siteId, search] });
  const pages = useCmsPageList({ siteId: kind === 'page' ? siteId : undefined, page: pagination.page, pageSize: pagination.pageSize, keyword: search });
  const widgets = useCmsWidgetList({ siteId: kind === 'widget' ? siteId : undefined, page: pagination.page, pageSize: pagination.pageSize, keyword: search });
  const query = kind === 'page' ? pages : widgets;
  const labels = useRef(new Map<number, string>());
  const options = new Map((query.data?.list ?? []).map((item) => { labels.current.set(item.id, item.name); return [item.id, { value: item.id, label: item.name }] as const; }));
  for (const id of value) if (!options.has(id)) options.set(id, { value: id, label: labels.current.get(id) ?? `#${id}` });
  return <Space vertical align="start" style={{ width: '100%' }}>
    <Select multiple filter remote showClear value={value} onChange={(next) => onChange(Array.isArray(next) ? next.map(Number) : [])} onSearch={setKeyword} optionList={[...options.values()]} loading={query.isFetching} placeholder={kind === 'page' ? '搜索并选择页面' : '搜索并选择页面部件'} style={{ width: '100%' }} />
    <Pagination currentPage={pagination.page} pageSize={pagination.pageSize} total={query.data?.total ?? 0}
      onPageChange={pagination.setPage} {...COMPACT_PAGINATION_PROPS} />
  </Space>;
}
