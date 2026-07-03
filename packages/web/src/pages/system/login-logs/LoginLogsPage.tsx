import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Input, Button, Select, DatePicker, Tabs, TabPane, SplitButtonGroup, Dropdown, Toast } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import { Search, RotateCcw, ChevronDown, Trash2 } from 'lucide-react';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { LoginLogsTable } from '@/components/logs/LoginLogsTable';
import { usePagination } from '@/hooks/usePagination';
import { formatDateTimeForApi } from '@/utils/date';
import LoginLogStatsPanel from './LoginLogStatsPanel';
import { loginLogKeys, useCleanLoginLogs, useLoginLogList } from '@/hooks/queries/login-logs';

export default function LoginLogsPage() {
  const queryClient = useQueryClient();
  interface SearchParams {
    username: string;
    eventType: string;
    status: string;
    timeRange: [Date, Date] | null;
  }

  const defaultParams: SearchParams = { username: '', eventType: '', status: '', timeRange: null };
  const [clearModalVisible, setClearModalVisible] = useState(false);
  const [clearMonths, setClearMonths] = useState(0);
  const [clearPassword, setClearPassword] = useState('');
  const [clearPasswordError, setClearPasswordError] = useState('');
  const [clearVerifying, setClearVerifying] = useState(false);
  const { page, pageSize, setPage, buildPagination } = usePagination();

  const [draftParams, setDraftParams] = useState<SearchParams>(defaultParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultParams);
  const listQuery = useLoginLogList({
    page,
    pageSize,
    username: submittedParams.username || undefined,
    eventType: submittedParams.eventType || undefined,
    status: submittedParams.status || undefined,
    startTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[0]) : undefined,
    endTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[1]) : undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const cleanLogsMutation = useCleanLoginLogs();
  const clearLogsLoading = cleanLogsMutation.isPending;

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: loginLogKeys.all });
  };

  const handleReset = () => {
    setPage(1);
    setDraftParams(defaultParams);
    setSubmittedParams(defaultParams);
    void queryClient.invalidateQueries({ queryKey: loginLogKeys.all });
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
      placeholder="请输入用户名"
      value={draftParams.username}
      onChange={(v) => setDraftParams({ ...draftParams, username: v })}
      onEnterPress={handleSearch}
      style={{ width: 180 }}
      showClear
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="请选择状态"
      value={draftParams.status || undefined}
      onChange={(v) => setDraftParams({ ...draftParams, status: v as string })}
      style={{ width: 150 }}
    >
      <Select.Option value="">全部</Select.Option>
      <Select.Option value="success">成功</Select.Option>
      <Select.Option value="fail">失败</Select.Option>
    </Select>
  );

  const renderEventTypeFilter = () => (
    <Select
      placeholder="请选择事件"
      value={draftParams.eventType || undefined}
      onChange={(v) => setDraftParams({ ...draftParams, eventType: v as string })}
      style={{ width: 150 }}
    >
      <Select.Option value="">全部事件</Select.Option>
      <Select.Option value="login">登录</Select.Option>
      <Select.Option value="logout">退出登录</Select.Option>
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

  const buildExportQuery = () => ({
    ...(draftParams.username ? { username: draftParams.username } : {}),
    ...(draftParams.eventType ? { eventType: draftParams.eventType } : {}),
    ...(draftParams.status ? { status: draftParams.status } : {}),
    ...(draftParams.timeRange
      ? {
          startTime: formatDateTimeForApi(draftParams.timeRange[0]),
          endTime: formatDateTimeForApi(draftParams.timeRange[1]),
        }
      : {}),
  });

  const renderExportButtons = () => <ExportButton entity="system.login-logs" query={buildExportQuery()} />;

  const renderMobileExportActions = () => <ExportButton entity="system.login-logs" query={buildExportQuery()} variant="flat" />;

  const renderClearButtons = () => (
    <SplitButtonGroup>
      <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={clearLogsLoading} onClick={() => handleClearLogs(12)}>清除日志</Button>
      <Dropdown
        trigger="click"
        position="bottomRight"
        clickToHide
        render={(
          <Dropdown.Menu>
            {([12, 6, 3, 1] as const).map((m) => (
              <Dropdown.Item key={m} onClick={() => handleClearLogs(m)}>清除{clearLogsLabels[m]}前的日志</Dropdown.Item>
            ))}
            <Dropdown.Divider />
            <Dropdown.Item type="danger" onClick={() => handleClearLogs(0)}>清除全部日志</Dropdown.Item>
          </Dropdown.Menu>
        )}
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
      <Tabs type="line">
        <TabPane tab="日志列表" itemKey="list">
          <SearchToolbar
            primary={(
              <>
                {renderUsernameSearch()}
                {renderEventTypeFilter()}
                {renderStatusFilter()}
                {renderTimeRangeFilter()}
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
                {renderEventTypeFilter()}
                {renderStatusFilter()}
                {renderTimeRangeFilter()}
              </>
            )}
            mobileActions={(
              <>
                {renderMobileExportActions()}
                {renderMobileClearActions()}
              </>
            )}
            filterTitle="登录日志筛选"
            actionTitle="日志操作"
            onFilterApply={handleSearch}
            onFilterReset={handleReset}
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
      <AppModal
        title={`清除${clearMonths === 0 ? '全部' : clearLogsLabels[clearMonths] + '前的'}登录日志`}
        visible={clearModalVisible}
        onCancel={() => setClearModalVisible(false)}
        okText="确认清除"
        okButtonProps={{ type: 'danger', loading: clearVerifying }}
        onOk={handleConfirmClear}
        maskClosable={false}
      >
        <p style={{ marginBottom: 12 }}>
          此操作将永久删除{clearMonths === 0 ? '所有' : clearLogsLabels[clearMonths] + '前的'}登录日志，不可恢复。
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
