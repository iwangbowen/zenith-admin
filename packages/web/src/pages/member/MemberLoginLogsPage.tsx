import { Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { MemberLoginLog } from '@zenith/shared/member';
import { usePermission } from '@/hooks/usePermission';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import ExportButton from '@/components/ExportButton';
import { dateTimeColumn, renderEllipsis } from '../../utils/table-columns';
import { formatDateForApi } from '@/utils/date';
import { memberAdminKeys, useMemberLoginLogList } from '@/hooks/queries/member-admin';
import { useListSearch } from '@/hooks/useListSearch';
import { DateRangeFilter, KeywordInput, StatusSelect } from '@/components/search-filters';
import { memberCellColumn, useMemberKeywordDeepLink } from './member-admin-display';

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
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset, applySearch,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: memberAdminKeys.loginLogLists });
  useMemberKeywordDeepLink<SearchParams>({ applySearch, buildParams: (memberKeyword) => ({ keyword: memberKeyword, dateRange: null }) });
  const [dateStart, dateEnd] = submittedParams.dateRange ?? [];
  const listQuery = useMemberLoginLogList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    dateStart: dateStart ? formatDateForApi(dateStart) : undefined,
    dateEnd: dateEnd ? formatDateForApi(dateEnd) : undefined,
  });

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

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="会员昵称/手机号/用户名" value={draftParams.keyword} onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))} onSearch={handleSearch} />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusOptions}
      value={draftParams.status}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, status: value as 'success' | 'fail' | undefined }))}
    />
  );

  const renderDateRangeFilter = () => (
    <DateRangeFilter type="dateRange" value={draftParams.dateRange ?? undefined} onChange={(value) => setDraftParams((prev) => ({ ...prev, dateRange: value ? (value as [Date, Date]) : null }))} width={300} />
  );

  const buildExportQuery = () => {
    const [ds, de] = submittedParams.dateRange ?? [];
    return {
      ...(submittedParams.keyword ? { keyword: submittedParams.keyword } : {}),
      ...(submittedParams.status ? { status: submittedParams.status } : {}),
      ...(ds ? { dateStart: formatDateForApi(ds) } : {}),
      ...(de ? { dateEnd: formatDateForApi(de) } : {}),
    };
  };
  const renderExportButton = (variant?: 'flat') => hasPermission('member:loginlog:list') ? (
    <ExportButton entity="member.login-logs" query={buildExportQuery()} variant={variant} />
  ) : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={renderKeywordSearch()}
        filters={(
          <>
            {renderStatusFilter()}
            {renderDateRangeFilter()}
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={renderExportButton()}
        mobileActions={renderExportButton('flat')}
        filterTitle="登录日志筛选"
      />

      <ConfigurableTable<MemberLoginLog>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无登录日志' })}
      />
    </div>
  );
}
