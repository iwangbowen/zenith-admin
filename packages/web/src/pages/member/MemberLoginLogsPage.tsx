import { useMemo } from 'react';
import { Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { MemberLoginLog } from '@zenith/shared/member';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import ExportButton from '@/components/ExportButton';
import { dateTimeColumn, renderEllipsis } from '../../utils/table-columns';
import { formatDateRangeValuesForApi } from '@/utils/date';
import { memberAdminKeys, useMemberLoginLogList } from '@/hooks/queries/member-admin';
import { useListSearch } from '@/hooks/useListSearch';
import { DateRangeFilter, KeywordInput, StatusSelect } from '@/components/search-filters';
import { memberCellColumn, useMemberKeywordDeepLink } from './member-admin-display';
import { compactParams } from '@/lib/query';

interface SearchParams {
  keyword?: string;
  status?: 'success' | 'fail';
  dateRange: [Date, Date] | null;
}

const defaultSearch: SearchParams = { keyword: undefined, status: undefined, dateRange: null };

const statusOptions = [
  { value: 'success', label: '成功' },
  { value: 'fail', label: '失败' },
];

export default function MemberLoginLogsPage() {
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset, applySearch,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: memberAdminKeys.loginLogLists });
  useMemberKeywordDeepLink<SearchParams>({ applySearch, buildParams: (memberKeyword) => ({ keyword: memberKeyword, dateRange: null }) });
  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useMemo(() => {
    const [dateStart, dateEnd] = formatDateRangeValuesForApi(submittedParams.dateRange);
    return compactParams({
      keyword: submittedParams.keyword,
      status: submittedParams.status,
      dateStart,
      dateEnd,
    });
  }, [submittedParams]);
  const listQuery = useMemberLoginLogList({ page, pageSize, ...filterQuery });

  const columns: ColumnProps<MemberLoginLog>[] = [
    memberCellColumn<MemberLoginLog>({ width: 140, nameField: 'memberNickname', idField: 'memberId' }),
    { title: 'IP', dataIndex: 'ip', width: 140, render: (v: string | null) => v ?? '—' },
    { title: '地点', dataIndex: 'location', width: 140, render: (v: string | null) => renderEllipsis(v ?? '—') },
    { title: '浏览器', dataIndex: 'browser', width: 130, render: (v: string | null) => renderEllipsis(v ?? '—') },
    { title: '操作系统', dataIndex: 'os', width: 130, render: (v: string | null) => renderEllipsis(v ?? '—') },
    { title: '说明', dataIndex: 'message', render: (v: string | null) => renderEllipsis(v ?? '—') },
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: 'success' | 'fail') => <Tag color={v === 'success' ? 'green' : 'red'}>{v === 'success' ? '成功' : '失败'}</Tag> },
    dateTimeColumn('登录时间', 'createdAt', { fixed: 'right' }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="会员昵称/手机号/用户名" {...bindKeyword('keyword')} />}
        filters={(
          <>
            <StatusSelect
              items={statusOptions}
              {...bind('status', (value) => value as 'success' | 'fail' | undefined)}
            />
            <DateRangeFilter type="dateRange" {...bind('dateRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={<ExportButton entity="member.login-logs" query={filterQuery} permission="member:loginlog:list" />}
        filterTitle="登录日志筛选"
      />

      <ConfigurableTable<MemberLoginLog>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无登录日志' })}
      />
    </div>
  );
}
