import { Tabs, TabPane, InputNumber } from '@douyinfe/semi-ui';
import { ListSearchToolbar } from '@/components/list-page';
import ExportButton from '@/components/ExportButton';
import { OperationLogsTable } from '@/components/logs/OperationLogsTable';
import { ClearLogsButtons, ClearLogsMobileButtons, ClearLogsModal } from '@/components/logs/ClearLogsControl';
import { useClearLogs } from '@/hooks/useClearLogs';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { compactQuery } from '@/lib/query';
import OperationLogStatsPanel from './OperationLogStatsPanel';
import { operationLogKeys, useCleanOperationLogs, useOperationLogList } from '@/hooks/queries/operation-logs';
import { useListSearch } from '@/hooks/useListSearch';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { enumValueOf } from '@zenith/shared/core';
import { OPERATION_LOG_RESULTS } from '@zenith/shared/platform';

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ value, label: value }));
const STATUS_OPTIONS = [{ value: 'success', label: '成功' }, { value: 'fail', label: '失败' }];

import { useUrlTabState } from '@/hooks/useUrlTabState';
interface SearchParams {
  username: string;
  module: string;
  description: string;
  method?: string;
  path: string;
  ip: string;
  status?: string;
  content: string;
  timeRange: [Date, Date] | null;
  minDurationMs: number | null;
  maxDurationMs: number | null;
}

const defaultParams: SearchParams = { username: '', module: '', description: '', method: undefined, path: '', ip: '', status: undefined, content: '', timeRange: null, minDurationMs: null, maxDurationMs: null };

export default function OperationLogsPage() {
  const [activeTab, setActiveTab] = useUrlTabState(['list', 'stats'] as const, 'list');
  const {
    page, pageSize, setPage, buildPagination,
    draftParams, setField, bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultParams, listKey: operationLogKeys.all });
  const listQuery = useOperationLogList({
    page,
    pageSize,
    username: submittedParams.username || undefined,
    module: submittedParams.module || undefined,
    description: submittedParams.description || undefined,
    ip: submittedParams.ip || undefined,
    method: submittedParams.method || undefined,
    path: submittedParams.path || undefined,
    status: enumValueOf(OPERATION_LOG_RESULTS, submittedParams.status),
    content: submittedParams.content || undefined,
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
    minDurationMs: submittedParams.minDurationMs ?? undefined,
    maxDurationMs: submittedParams.maxDurationMs ?? undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const cleanLogsMutation = useCleanOperationLogs();
  const clearLogsLoading = cleanLogsMutation.isPending;
  const clearLogs = useClearLogs({
    clean: (days) => cleanLogsMutation.mutateAsync({ query: { days } }),
    onCleared: () => setPage(1),
  });

  const buildExportQuery = () => {
    const p = draftParams;
    return compactQuery({
      username: p.username,
      module: p.module,
      description: p.description,
      ip: p.ip,
      method: p.method,
      path: p.path,
      status: p.status,
      content: p.content,
      ...formatDateTimeRangeForApi(p.timeRange),
      minDurationMs: p.minDurationMs?.toString(),
      maxDurationMs: p.maxDurationMs?.toString(),
    });
  };

  return (
    <div className="page-container page-tabs-page">
      <Tabs
        collapsible="auto"
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'list' | 'stats')}
        type="line"
        lazyRender
        keepDOM={false}
      >
        <TabPane tab="日志列表" itemKey="list">
          <ListSearchToolbar
            keyword={<KeywordInput placeholder="操作人用户名 / 昵称" {...bindKeyword('username')} width={160} />}
            filters={(
              <>
                <KeywordInput placeholder="请输入功能模块" {...bindKeyword('module')} width={160} />
                <KeywordInput placeholder="请输入操作描述" {...bindKeyword('description')} width={160} />
                <FilterSelect
                  placeholder="全部请求方法"
                  items={METHOD_OPTIONS}
                  {...bind('method')}
                  width={140}
                />
                <KeywordInput placeholder="请输入请求路径" {...bindKeyword('path')} width={180} />
                <KeywordInput placeholder="请输入 IP 地址" {...bindKeyword('ip')} width={160} />
                <KeywordInput placeholder="请求/变更内容包含…" {...bindKeyword('content')} width={180} />
                <StatusSelect
                  items={STATUS_OPTIONS}
                  {...bind('status')}
                />
                <DateRangeFilter {...bind('timeRange')} />
                <>
                  <InputNumber
                    placeholder="耗时 ≥ (ms)"
                    value={draftParams.minDurationMs ?? undefined}
                    onChange={(v) => setField('minDurationMs')(v !== '' && v != null ? Number(v) : null)}
                    min={0}
                    style={{ width: 130 }}
                    hideButtons
                  />
                  <InputNumber
                    placeholder="耗时 ≤ (ms)"
                    value={draftParams.maxDurationMs ?? undefined}
                    onChange={(v) => setField('maxDurationMs')(v !== '' && v != null ? Number(v) : null)}
                    min={0}
                    style={{ width: 130 }}
                    hideButtons
                  />
                </>
              </>
            )}
            onSearch={handleSearch}
            onReset={handleReset}
            actions={(
              <>
                <ExportButton entity="system.operation-logs" query={buildExportQuery()} />
                <ClearLogsButtons loading={clearLogsLoading} onClear={clearLogs.openClearModal} />
              </>
            )}
            mobileActions={(
              <>
                <ExportButton entity="system.operation-logs" query={buildExportQuery()} variant="flat" />
                <ClearLogsMobileButtons loading={clearLogsLoading} onClear={clearLogs.openClearModal} />
              </>
            )}
            filterTitle="操作日志筛选"
            actionTitle="日志操作"
          />

          <OperationLogsTable
            dataSource={data}
            loading={listQuery.isFetching}
            onRefresh={() => void listQuery.refetch()}
            pagination={buildPagination(total)}
          />
        </TabPane>
        <TabPane tab="统计分析" itemKey="stats">
          <OperationLogStatsPanel />
        </TabPane>
      </Tabs>
      <ClearLogsModal logName="操作日志" control={clearLogs} />
    </div>
  );
}
