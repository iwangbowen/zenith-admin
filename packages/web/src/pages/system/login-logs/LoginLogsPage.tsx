import { Tabs, TabPane } from '@douyinfe/semi-ui';
import { ListSearchToolbar } from '@/components/list-page';
import ExportButton from '@/components/ExportButton';
import { LoginLogsTable } from '@/components/logs/LoginLogsTable';
import { ClearLogsButtons, ClearLogsMobileButtons, ClearLogsModal } from '@/components/logs/ClearLogsControl';
import { useClearLogs } from '@/hooks/useClearLogs';
import { formatDateTimeRangeForApi } from '@/utils/date';
import LoginLogStatsPanel from './LoginLogStatsPanel';
import { loginLogKeys, useCleanLoginLogs, useLoginLogList } from '@/hooks/queries/login-logs';
import { enumValueOf } from '@zenith/shared/core';
import { LOGIN_EVENT_TYPES, LOGIN_STATUSES } from '@zenith/shared/identity';
import { useListSearch } from '@/hooks/useListSearch';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';

const STATUS_OPTIONS = [{ value: 'success', label: '成功' }, { value: 'fail', label: '失败' }];
const EVENT_TYPE_OPTIONS = [{ value: 'login', label: '登录' }, { value: 'logout', label: '退出登录' }];

import { useUrlTabState } from '@/hooks/useUrlTabState';
import { compactQuery } from '@/lib/query';
export default function LoginLogsPage() {
  const [activeTab, setActiveTab] = useUrlTabState(['list', 'stats'] as const, 'list');
  interface SearchParams {
    username: string;
    eventType?: string;
    status?: string;
    timeRange: [Date, Date] | null;
  }

  const defaultParams: SearchParams = { username: '', eventType: undefined, status: undefined, timeRange: null };

  const {
    page, pageSize, setPage, buildPagination,
    draftParams, bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultParams, listKey: loginLogKeys.lists });
  const listQuery = useLoginLogList({
    page,
    pageSize,
    username: submittedParams.username || undefined,
    eventType: enumValueOf(LOGIN_EVENT_TYPES, submittedParams.eventType),
    status: enumValueOf(LOGIN_STATUSES, submittedParams.status),
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const cleanLogsMutation = useCleanLoginLogs();
  const clearLogsLoading = cleanLogsMutation.isPending;
  const clearLogs = useClearLogs({
    clean: (days) => cleanLogsMutation.mutateAsync({ query: { days } }),
    onCleared: () => setPage(1),
  });

  const buildExportQuery = () => compactQuery({
    username: draftParams.username,
    eventType: draftParams.eventType,
    status: draftParams.status,
    ...formatDateTimeRangeForApi(draftParams.timeRange),
  });

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" type="line" lazyRender activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)}>
        <TabPane tab="日志列表" itemKey="list">
          <ListSearchToolbar
            keyword={<KeywordInput placeholder="用户名 / 昵称" {...bindKeyword('username')} width={180} />}
            filters={(
              <>
                <FilterSelect
                  placeholder="全部事件"
                  items={EVENT_TYPE_OPTIONS}
                  {...bind('eventType')}
                />
                <StatusSelect
                  items={STATUS_OPTIONS}
                  {...bind('status')}
                />
                <DateRangeFilter {...bind('timeRange')} />
              </>
            )}
            onSearch={handleSearch}
            onReset={handleReset}
            actions={(
              <>
                <ExportButton entity="system.login-logs" query={buildExportQuery()} />
                <ClearLogsButtons loading={clearLogsLoading} onClear={clearLogs.openClearModal} />
              </>
            )}
            mobileActions={(
              <>
                <ExportButton entity="system.login-logs" query={buildExportQuery()} variant="flat" />
                <ClearLogsMobileButtons loading={clearLogsLoading} onClear={clearLogs.openClearModal} />
              </>
            )}
            filterTitle="登录日志筛选"
            actionTitle="日志操作"
          />

          <LoginLogsTable
            dataSource={data}
            loading={listQuery.isFetching}
            onRefresh={() => void listQuery.refetch()}
            pagination={buildPagination(total)}
          />
        </TabPane>
        <TabPane tab="统计分析" itemKey="stats">
          <LoginLogStatsPanel />
        </TabPane>
      </Tabs>
      <ClearLogsModal logName="登录日志" control={clearLogs} />
    </div>
  );
}
