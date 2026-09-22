import { Tabs, TabPane } from '@douyinfe/semi-ui';
import { ListSearchToolbar } from '@/components/list-page';
import ExportButton from '@/components/ExportButton';
import { OperationLogsTable } from '@/components/logs/OperationLogsTable';
import { ClearLogsButtons, ClearLogsModal } from '@/components/logs/ClearLogsControl';
import { useClearLogs } from '@/hooks/useClearLogs';
import { formatDateTimeRangeForApi, parseDateTimeParam } from '@/utils/date';
import OperationLogStatsPanel from './OperationLogStatsPanel';
import { operationLogKeys, useCleanOperationLogs, useOperationLogList } from '@/hooks/queries/operation-logs';
import { useListSearch } from '@/hooks/useListSearch';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { DateRangeFilter, FilterSelect, KeywordInput, NumberFilter, StatusSelect } from '@/components/search-filters';
import { enumValueOf } from '@zenith/shared/core';
import { OPERATION_LOG_RESULT_OPTIONS, OPERATION_LOG_RESULTS } from '@zenith/shared/platform';

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ value, label: value }));
/** 模拟登录筛选：与契约 `impersonated` 的 queryBool 文案一致（该页为映射模式，控件手写） */
const IMPERSONATED_OPTIONS = [
  { value: 'true', label: '仅模拟操作' },
  { value: 'false', label: '仅本人操作' },
];
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useFilterQuery } from '@/hooks/useFilterQuery';
interface SearchParams {
  username: string;
  module: string;
  description: string;
  method?: string;
  path: string;
  ip: string;
  status?: string;
  content: string;
  /** 'true' 仅模拟登录期间的操作 / 'false' 仅本人操作；未选为 undefined */
  impersonated?: string;
  timeRange: [Date, Date] | null;
  /** 耗时区间（ms）：未填为 undefined，与其它可选筛选字段一致 */
  minDurationMs?: number;
  maxDurationMs?: number;
}

const defaultParams: SearchParams = { username: '', module: '', description: '', method: undefined, path: '', ip: '', status: undefined, content: '', impersonated: undefined, timeRange: null, minDurationMs: undefined, maxDurationMs: undefined };

export default function OperationLogsPage() {
  const [activeTab, setActiveTab] = useUrlTabState(['list', 'stats'] as const, 'list');
  const {
    page, pageSize, setPage, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
    applySearch,
  } = useListSearch<SearchParams>({ defaults: defaultParams, listKey: operationLogKeys.all });
  // 首页操作分布饼图下钻（?module=&startTime=&endTime=，图表口径是今日）与其它入口的操作描述深链
  // （?description=）走同一套一次性消费；带模块的深链在同一次导航里切回列表页签，
  // 否则停在上次离开的「统计分析」看不到结果
  useListDeepLink(['description', 'module', 'startTime', 'endTime'], (params) => {
    const startTime = parseDateTimeParam(params.startTime);
    const endTime = parseDateTimeParam(params.endTime);
    applySearch({
      ...defaultParams,
      description: params.description ?? '',
      module: params.module ?? '',
      timeRange: startTime && endTime ? [startTime, endTime] : null,
    });
  }, { getNextParams: (params) => (params.module ? { tab: 'list' } : undefined) });
  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useFilterQuery({
    username: submittedParams.username,
    module: submittedParams.module,
    description: submittedParams.description,
    ip: submittedParams.ip,
    method: submittedParams.method,
    path: submittedParams.path,
    status: enumValueOf(OPERATION_LOG_RESULTS, submittedParams.status),
    content: submittedParams.content,
    impersonated: submittedParams.impersonated === 'true' ? true : submittedParams.impersonated === 'false' ? false : undefined,
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
    minDurationMs: submittedParams.minDurationMs,
    maxDurationMs: submittedParams.maxDurationMs,
  });
  const listQuery = useOperationLogList({ page, pageSize, ...filterQuery });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const cleanLogsMutation = useCleanOperationLogs();
  const clearLogsLoading = cleanLogsMutation.isPending;
  const clearLogs = useClearLogs({
    clean: (days) => cleanLogsMutation.mutateAsync({ query: { days } }),
    onCleared: () => setPage(1),
  });

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
                  items={OPERATION_LOG_RESULT_OPTIONS}
                  {...bind('status')}
                />
                <FilterSelect
                  placeholder="全部操作来源"
                  items={IMPERSONATED_OPTIONS}
                  {...bind('impersonated')}
                  width={140}
                />
                <DateRangeFilter {...bind('timeRange')} />
                <NumberFilter placeholder="耗时 ≥ (ms)" min={0} {...bind('minDurationMs')} />
                <NumberFilter placeholder="耗时 ≤ (ms)" min={0} {...bind('maxDurationMs')} />
              </>
            )}
            onSearch={handleSearch}
            onReset={handleReset}
            actions={(
              <>
                <ExportButton entity="system.operation-logs" query={filterQuery} />
                <ClearLogsButtons loading={clearLogsLoading} onClear={clearLogs.openClearModal} />
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
