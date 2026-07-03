import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Input, Button, DatePicker, Select, Tabs, TabPane, InputNumber, SplitButtonGroup, Dropdown, Toast } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import { Search, RotateCcw, ChevronDown, Trash2 } from 'lucide-react';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { OperationLogsTable } from '@/components/logs/OperationLogsTable';
import { usePagination } from '@/hooks/usePagination';
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
  const [clearModalVisible, setClearModalVisible] = useState(false);
  const [clearMonths, setClearMonths] = useState(0);
  const [clearPassword, setClearPassword] = useState('');
  const [clearPasswordError, setClearPasswordError] = useState('');
  const [clearVerifying, setClearVerifying] = useState(false);
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

  const clearLogsLabels: Record<number, string> = { 0: '全部', 1: '一个月', 3: '三个月', 6: '六个月', 12: '一年' };

  const handleClearLogs = (months: number) => {
    setClearMonths(months);
    setClearPassword('');
    setClearPasswordError('');
    setClearModalVisible(true);
  };

  const handleConfirmClear = async () => {
    if (!clearPassword) { setClearPasswordError('请输入密码'); return; }
    setClearVerifying(true);
    try {
      const verifyRes = await request.post('/api/auth/verify-password', { password: clearPassword }, { skipAuth: true });
      if (verifyRes.code !== 0) { setClearPasswordError('密码错误，请重试'); return; }
    } catch {
      setClearPasswordError('密码错误，请重试'); return;
    } finally {
      setClearVerifying(false);
    }
    setClearModalVisible(false);
    await cleanLogsMutation.mutateAsync(clearMonths);
    Toast.success('清除成功');
    setPage(1);
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

  const renderClearButtons = () => (
    <SplitButtonGroup>
      <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={clearLogsLoading} onClick={() => handleClearLogs(12)}>清除日志</Button>
      <Dropdown
        trigger="click"
        position="bottomRight"
        clickToHide
        render={
          <Dropdown.Menu>
            {([12, 6, 3, 1] as const).map((m) => (
              <Dropdown.Item key={m} onClick={() => handleClearLogs(m)}>清除{clearLogsLabels[m]}前的日志</Dropdown.Item>
            ))}
            <Dropdown.Divider />
            <Dropdown.Item type="danger" onClick={() => handleClearLogs(0)}>清除全部日志</Dropdown.Item>
          </Dropdown.Menu>
        }
      >
        <Button type="danger" theme="light" icon={<ChevronDown size={14} />} />
      </Dropdown>
    </SplitButtonGroup>
  );

  const renderMobileClearActions = () => (
    <>
      {([12, 6, 3, 1] as const).map((m) => (
        <Button key={m} type="danger" theme="light" icon={<Trash2 size={14} />} loading={clearLogsLoading} onClick={() => handleClearLogs(m)}>
          清除{clearLogsLabels[m]}前的日志
        </Button>
      ))}
      <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={clearLogsLoading} onClick={() => handleClearLogs(0)}>
        清除全部日志
      </Button>
    </>
  );

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
      <AppModal
        title={`清除${clearMonths === 0 ? '全部' : clearLogsLabels[clearMonths] + '前的'}操作日志`}
        visible={clearModalVisible}
        onCancel={() => setClearModalVisible(false)}
        okText="确认清除"
        okButtonProps={{ type: 'danger', loading: clearVerifying }}
        onOk={handleConfirmClear}
        maskClosable={false}
      >
        <p style={{ marginBottom: 12 }}>
          此操作将永久删除{clearMonths === 0 ? '所有' : clearLogsLabels[clearMonths] + '前的'}操作日志，不可恢复。
          <br />请输入您的管理员密码以确认：
        </p>
        <Input
          type="password"
          placeholder="请输入密码"
          value={clearPassword}
          onChange={(v) => { setClearPassword(v); setClearPasswordError(''); }}
          onEnterPress={handleConfirmClear}
          validateStatus={clearPasswordError ? 'error' : undefined}
        />
        {clearPasswordError && <p style={{ color: 'var(--semi-color-danger)', marginTop: 4, fontSize: 12 }}>{clearPasswordError}</p>}
      </AppModal>
    </div>
  );
}
