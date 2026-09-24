import { useDeferredValue, useState } from 'react';
import { Banner, Button, Select, Space } from '@douyinfe/semi-ui';
import { useCmsFormList } from '@/hooks/queries/cms-forms';
import { usePagination } from '@/hooks/usePagination';

export default function CmsChannelFormField({ siteId, value, onChange, disabled = false }: Readonly<{
  siteId?: number; value?: string; onChange?: (value: string | undefined) => void; disabled?: boolean;
}>) {
  const [keyword, setKeyword] = useState('');
  const search = useDeferredValue(keyword);
  const paging = usePagination({ pageSize: 30, resetKey: [siteId, search] });
  const forms = useCmsFormList({ siteId: siteId ?? 0, page: paging.page, pageSize: paging.pageSize, keyword: search }, !!siteId && !disabled);
  const options = (forms.data?.list ?? []).map((form) => ({ value: form.code, label: `${form.name}（${form.code}）${form.status === 'disabled' ? ' · 已停用' : ''}`, disabled: form.status === 'disabled' }));
  if (value && !options.some((option) => option.value === value)) options.unshift({ value, label: `${value}（当前绑定）`, disabled: false });
  return <Space vertical align="start" spacing={8} style={{ width: '100%' }}>
    <Select value={value} onChange={(next) => onChange?.(typeof next === 'string' && next ? next : undefined)} filter remote showClear disabled={disabled || !siteId} loading={forms.isFetching}
      onSearch={setKeyword} optionList={options} placeholder="选择本站已启用表单，清空后不展示表单" style={{ width: '100%' }} />
    {(forms.data?.total ?? 0) > paging.pageSize || paging.page > 1 ? <Space><Button size="small" disabled={paging.page === 1} onClick={() => paging.setPage(paging.page - 1)}>上一页</Button><span>{paging.page}</span><Button size="small" disabled={paging.page * paging.pageSize >= (forms.data?.total ?? 0)} onClick={() => paging.setPage(paging.page + 1)}>下一页</Button></Space> : null}
    {forms.isError ? <Banner type="warning" description="表单列表加载失败，可刷新重试；当前绑定保持不变。" /> : null}
  </Space>;
}
