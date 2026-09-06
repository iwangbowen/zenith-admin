import { Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { WikiDoc } from '@zenith/shared/wiki';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { KeywordInput } from '@/components/search-filters';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { usePurgeWikiDoc, useRestoreWikiDoc, useWikiDocRecycleList, wikiDocRecycleKeys } from '@/hooks/queries/wiki-docs';

interface SearchParams {
  keyword: string;
}

const defaultSearchParams: SearchParams = { keyword: '' };

export default function WikiRecyclePage() {
  const { hasPermission } = usePermission();

  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: wikiDocRecycleKeys.all });

  const listQuery = useWikiDocRecycleList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
  });

  const restoreMutation = useRestoreWikiDoc();
  const purgeMutation = usePurgeWikiDoc();

  const columns: ColumnProps<WikiDoc>[] = [
    { title: '标题', dataIndex: 'title', minWidth: 240, render: renderEllipsis },
    { title: '所属空间', dataIndex: 'spaceName', width: 140, render: renderEllipsis },
    { title: '作者', dataIndex: 'authorName', width: 120, render: (v: string | null) => v ?? '—' },
    dateTimeColumn('删除时间', 'deletedAt'),
    createOperationColumn<WikiDoc>({
      width: 180,
      desktopInlineKeys: ['restore', 'purge'],
      actions: (record) => [
        ...(hasPermission('wiki:recycle:restore') ? [{
          key: 'restore', label: '还原',
          onClick: () => restoreMutation.mutate({ params: { id: record.id } }, { onSuccess: () => Toast.success('已还原') }),
        }] : []),
        deleteAction({
          key: 'purge',
          label: '彻底删除',
          hidden: !hasPermission('wiki:recycle:purge'),
          title: `彻底删除「${record.title}」？`,
          content: '彻底删除后文档及其版本、评论、收藏将全部清除，不可恢复！',
          run: () => purgeMutation.mutateAsync({ params: { id: record.id } }),
          successMessage: '已彻底删除',
        }),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput
      placeholder="搜索标题..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      onSearch={handleSearch}
    />
  );

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={renderKeywordSearch()}
        onSearch={handleSearch}
        onReset={handleReset}
      />

      <ConfigurableTable<WikiDoc>
        columns={columns}
        empty="回收站是空的"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />
    </div>
  );
}
