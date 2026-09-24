import { useDeferredValue, useState } from 'react';
import { Pagination, Select, Space } from '@douyinfe/semi-ui';
import { useQueries } from '@tanstack/react-query';
import { cmsContentContract } from '@zenith/shared/cms';
import { api, contractKey, useApiQuery } from '@/lib/contract-query';
import { COMPACT_PAGINATION_PROPS } from '@/hooks/usePagination';

const CONTENT_PAGE_SIZE = 30;

export default function CmsContentReferenceInput({ value, onChange, siteId, multiple = false }: Readonly<{
  value?: number | number[]; onChange?: (value: number | number[] | undefined) => void; siteId?: number; multiple?: boolean;
}>) {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const search = useDeferredValue(keyword);
  const list = useApiQuery(cmsContentContract.list, { query: { siteId: siteId ?? 0, page, pageSize: CONTENT_PAGE_SIZE, keyword: search } }, { enabled: Boolean(siteId) });
  const ids = Array.isArray(value) ? value : typeof value === 'number' ? [value] : [];
  const selected = useQueries({ queries: ids.map((id) => ({ queryKey: contractKey(cmsContentContract.detail, { params: { id } }), queryFn: () => api(cmsContentContract.detail, { params: { id } }), staleTime: 60_000 })) });
  const options = new Map((list.data?.list ?? []).map((item) => [item.id, { value: item.id, label: item.title }]));
  selected.forEach((query, index) => options.set(ids[index], { value: ids[index], label: query.data?.title ?? `内容 #${ids[index]}` }));
  return <Space vertical align="start" style={{ width: '100%' }}>
    <Select value={value} multiple={multiple} remote filter showClear disabled={!siteId} loading={list.isFetching}
      placeholder="搜索本站内容" optionList={[...options.values()]} style={{ width: '100%' }}
      onSearch={(next) => { setKeyword(next); setPage(1); }} onChange={(next) => onChange?.(next as number | number[] | undefined)} />
    <Pagination currentPage={page} pageSize={CONTENT_PAGE_SIZE} total={list.data?.total ?? 0}
      onPageChange={setPage} {...COMPACT_PAGINATION_PROPS} />
  </Space>;
}
