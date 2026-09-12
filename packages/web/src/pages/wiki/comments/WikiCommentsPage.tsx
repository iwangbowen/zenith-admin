import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { WikiComment } from '@zenith/shared/wiki';
import { WIKI_COMMENT_STATUSES, WIKI_COMMENT_STATUS_LABELS, WIKI_COMMENT_STATUS_OPTIONS } from '@zenith/shared/wiki';
import { enumValueOf } from '@zenith/shared/core';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { DateRangeFilter, KeywordInput, StatusSelect } from '@/components/search-filters';
import { createdAtColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { compactParams } from '@/lib/query';
import { useListSearch } from '@/hooks/useListSearch';
import { formatDateTimeRangeForApi } from '@/utils/date';
import {
  useRemoveWikiComment, useUpdateWikiCommentStatus, useWikiCommentList, wikiCommentKeys,
} from '@/hooks/queries/wiki-comments';

interface SearchParams {
  keyword: string;
  status?: string;
  timeRange: [Date, Date] | null;
}

const defaultSearchParams: SearchParams = { keyword: '', status: undefined, timeRange: null };

export default function WikiCommentsPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();

  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: wikiCommentKeys.lists });

  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    status: enumValueOf(WIKI_COMMENT_STATUSES, submittedParams.status),
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  }), [submittedParams]);

  const listQuery = useWikiCommentList({ page, pageSize, ...filterQuery });

  const statusMutation = useUpdateWikiCommentStatus();
  const removeMutation = useRemoveWikiComment();

  const columns: ColumnProps<WikiComment>[] = [
    { title: '评论内容', dataIndex: 'content', minWidth: 280, render: renderEllipsis },
    {
      title: '所属文档', dataIndex: 'docTitle', width: 200,
      render: (v: string | null, record: WikiComment) => v ? (
        <Typography.Text link ellipsis={{ showTooltip: true }} onClick={() => navigate(`/wiki/docs?docId=${record.docId}`)}>
          {v}
        </Typography.Text>
      ) : EMPTY_PLACEHOLDER,
    },
    { title: '评论人', dataIndex: 'authorName', width: 120, render: (v: string | null) => v ?? '已注销用户' },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: WikiComment['status']) => (
        <Tag color={v === 'visible' ? 'green' : 'grey'}>{WIKI_COMMENT_STATUS_LABELS[v]}</Tag>
      ),
    },
    createOperationColumn<WikiComment>({
      width: 150,
      desktopInlineKeys: ['toggle', 'delete'],
      actions: (record) => [
        ...(hasPermission('wiki:comment:audit') ? [{
          key: 'toggle',
          label: record.status === 'visible' ? '隐藏' : '恢复',
          onClick: () => statusMutation.mutate(
            { params: { id: record.id }, body: { status: record.status === 'visible' ? 'hidden' : 'visible' } },
            { onSuccess: () => Toast.success(record.status === 'visible' ? '已隐藏' : '已恢复') },
          ),
        }] : []),
        deleteAction({
          hidden: !hasPermission('wiki:comment:delete'),
          title: '确定要删除这条评论吗？',
          content: '删除后其下回复一并删除，不可恢复',
          run: () => removeMutation.mutateAsync({ params: { id: record.id }, docId: record.docId }),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <KeywordInput
            placeholder="搜索评论内容..."
            {...bindKeyword('keyword')}
          />
        )}
        filters={<>
          <StatusSelect
            items={WIKI_COMMENT_STATUS_OPTIONS}

            {...bind('status')}
          />
          <DateRangeFilter
            {...bind('timeRange')}
          />
        </>}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="筛选条件"
      />

      <ConfigurableTable<WikiComment>
        columns={columns}
        empty="暂无评论"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />
    </div>
  );
}
