import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Input, Button, DatePicker, Select, Tabs, TabPane, InputNumber } from '@douyinfe/semi-ui';
import { Search, RotateCcw } from 'lucide-react';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { OperationLogsTable } from '@/components/logs/OperationLogsTable';
import { ClearLogsButtons, ClearLogsMobileButtons, ClearLogsModal } from '@/components/logs/ClearLogsControl';
import { usePagination } from '@/hooks/usePagination';
import { useClearLogs } from '@/hooks/useClearLogs';
import { formatDateTimeForApi } from '@/utils/date';
import OperationLogStatsPanel from './OperationLogStatsPanel';
import { operationLogKeys, useCleanOperationLogs, useOperationLogList } from '@/hooks/queries/operation-logs';

interface SearchParams {
  username: string;
  module: string;
  description: string;
  method: string;
  path: string;
  ip: string;
  status: string;
  timeRange: [Date, Date] | null;
  minDurationMs: number | null;
  maxDurationMs: number | null;
}

const defaultParams: SearchParams = { username: '', module: '', description: '', method: '', path: '', ip: '', status: '', timeRange: null, minDurationMs: null, maxDurationMs: null };

export default function OperationLogsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'list' | 'stats'>('list');
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultParams);
  const listQuery = useOperationLogList({
    page,
    pageSize,
    username: submittedParams.username || undefined,
    module: submittedParams.module || undefined,
    description: submittedParams.description || undefined,
    ip: submittedParams.ip || undefined,
    method: submittedParams.method || undefined,
    path: submittedParams.path || undefined,
    status: submittedParams.status || undefined,
    startTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[0]) : undefined,
    endTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[1]) : undefined,
    minDurationMs: submittedParams.minDurationMs ?? undefined,
    maxDurationMs: submittedParams.maxDurationMs ?? undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const cleanLogsMutation = useCleanOperationLogs();
  const clearLogsLoading = cleanLogsMutation.isPending;
  const clearLogs = useClearLogs({
    clean: (months) => cleanLogsMutation.mutateAsync(months),
    onCleared: () => setPage(1),
  });

  const buildExportQuery = () => {
    const p = draftParams;
    return {
      ...(p.username ? { username: p.username } : {}),
      ...(p.module ? { module: p.module } : {}),
      ...(p.description ? { description: p.description } : {}),
      ...(p.ip ? { ip: p.ip } : {}),
      ...(p.method ? { method: p.method } : {}),
      ...(p.path ? { path: p.path } : {}),
      ...(p.status ? { status: p.status } : {}),
      ...(p.timeRange ? { startTime: formatDateTimeForApi(p.timeRange[0]), endTime: formatDateTimeForApi(p.timeRange[1]) } : {}),
      ...(p.minDurationMs === null ? {} : { minDurationMs: String(p.minDurationMs) }),
      ...(p.maxDurationMs === null ? {} : { maxDurationMs: String(p.maxDurationMs) }),
    };
  };

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: operationLogKeys.all });
  };

  const handleReset = () => {
    setPage(1);
    setDraftParams(defaultParams);
    setSubmittedParams(defaultParams);
    void queryClient.invalidateQueries({ queryKey: operationLogKeys.all });
  };

  const renderUsernameSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="请输入操作人"
      value={draftParams.username}
      onChange={(v) => setDraftParams({ ...draftParams, username: v })}
      onEnterPress={handleSearch}
      style={{ width: 160 }}
      showClear
    />
  );

  const renderModuleSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="请输入功能模块"
      value={draftParams.module}
      onChange={(v) => setDraftParams({ ...draftParams, module: v })}
      onEnterPress={handleSearch}
      style={{ width: 160 }}
      showClear
    />
  );

  const renderDescriptionSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="请输入操作描述"
      value={draftParams.description}
      onChange={(v) => setDraftParams({ ...draftParams, description: v })}
      onEnterPress={handleSearch}
      style={{ width: 160 }}
      showClear
    />
  );

  const renderMethodFilter = () => (
    <Select
      placeholder="请求方法"
      value={draftParams.method || undefined}
      onChange={(v) => setDraftParams({ ...draftParams, method: v as string })}
      style={{ width: 130 }}
      showClear
    >
      <Select.Option value="GET">GET</Select.Option>
      <Select.Option value="POST">POST</Select.Option>
      <Select.Option value="PUT">PUT</Select.Option>
      <Select.Option value="PATCH">PATCH</Select.Option>
      <Select.Option value="DELETE">DELETE</Select.Option>
    </Select>
  );

  const renderPathSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="请输入请求路径"
      value={draftParams.path}
      onChange={(v) => setDraftParams({ ...draftParams, path: v })}
      onEnterPress={handleSearch}
      style={{ width: 180 }}
      showClear
    />
  );

  const renderIpSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="请输入 IP 地址"
      value={draftParams.ip}
      onChange={(v) => setDraftParams({ ...draftParams, ip: v })}
      onEnterPress={handleSearch}
      style={{ width: 160 }}
      showClear
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="操作状态"
      value={draftParams.status || undefined}
      onChange={(v) => setDraftParams({ ...draftParams, status: v as string })}
      style={{ width: 130 }}
      showClear
    >
      <Select.Option value="success">成功</Select.Option>
      <Select.Option value="fail">失败</Select.Option>
    </Select>
  );

  const renderTimeRangeFilter = () => (
    <DatePicker
      type="dateTimeRange"
      placeholder={['开始时间', '结束时间']}
      value={draftParams.timeRange ?? undefined}
      onChange={(v) => setDraftParams({ ...draftParams, timeRange: v ? (v as [Date, Date]) : null })}
      style={{ width: 360 }}
    />
  );

  const renderDurationFilters = () => (
    <>
      <InputNumber
        placeholder="耗时 ≥ (ms)"
        value={draftParams.minDurationMs ?? undefined}
        onChange={(v) => setDraftParams({ ...draftParams, minDurationMs: v !== '' && v != null ? Number(v) : null })}
        min={0}
        style={{ width: 130 }}
        hideButtons
      />
      <InputNumber
        placeholder="耗时 ≤ (ms)"
        value={draftParams.maxDurationMs ?? undefined}
        onChange={(v) => setDraftParams({ ...draftParams, maxDurationMs: v !== '' && v != null ? Number(v) : null })}
        min={0}
        style={{ width: 130 }}
        hideButtons
      />
    </>
  );

  const renderExportButtons = () => <ExportButton entity="system.operation-logs" query={buildExportQuery()} />;

  const renderMobileExportActions = () => <ExportButton entity="system.operation-logs" query={buildExportQuery()} variant="flat" />;

  const renderClearButtons = () => <ClearLogsButtons loading={clearLogsLoading} onClear={clearLogs.openClearModal} />;

  const renderMobileClearActions = () => <ClearLogsMobileButtons loading={clearLogsLoading} onClear={clearLogs.openClearModal} />;

  return (
    <div className="page-container page-tabs-page">
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'list' | 'stats')}
        type="line"
        lazyRender
        keepDOM={false}
      >
        <TabPane tab="日志列表" itemKey="list">
          <SearchToolbar
            primary={(
              <>
                {renderUsernameSearch()}
                {renderModuleSearch()}
                {renderDescriptionSearch()}
                {renderMethodFilter()}
                {renderPathSearch()}
                {renderIpSearch()}
                {renderStatusFilter()}
                {renderTimeRangeFilter()}
                {renderDurationFilters()}
                <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
                <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
              </>
            )}
            actions={(
              <>
                {renderExportButtons()}
                {renderClearButtons()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderUsernameSearch()}
                <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
              </>
            )}
            mobileFilters={(
              <>
                {renderModuleSearch()}
                {renderDescriptionSearch()}
                {renderMethodFilter()}
                {renderPathSearch()}
                {renderIpSearch()}
                {renderStatusFilter()}
                {renderTimeRangeFilter()}
                {renderDurationFilters()}
              </>
            )}
            mobileActions={(
              <>
                {renderMobileExportActions()}
                {renderMobileClearActions()}
              </>
            )}
            filterTitle="操作日志筛选"
            actionTitle="日志操作"
            onFilterApply={handleSearch}
            onFilterReset={handleReset}
          />

          <OperationLogsTable
            dataSource={data}
            loading={listQuery.isFetching}
            onRefresh={() => void listQuery.refetch()}
            scroll={{ x: 1600 }}
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
