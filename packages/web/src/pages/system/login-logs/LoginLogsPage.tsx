import { useState, useEffect, useCallback, useRef } from 'react';
import { Input, Button, Select, DatePicker, Tabs, TabPane, SplitButtonGroup, Dropdown, Toast } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import { Search, RotateCcw, Download, ChevronDown, Trash2 } from 'lucide-react';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { LoginLogsTable } from '@/components/logs/LoginLogsTable';
import { usePagination } from '@/hooks/usePagination';
import { formatDateTimeForApi } from '@/utils/date';
import type { LoginLog, PaginatedResponse } from '@zenith/shared';
import LoginLogStatsPanel from './LoginLogStatsPanel';

export default function LoginLogsPage() {
  interface SearchParams {
    username: string;
    status: string;
    timeRange: [Date, Date] | null;
  }

  const defaultParams: SearchParams = { username: '', status: '', timeRange: null };
  const [data, setData] = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportCsvLoading, setExportCsvLoading] = useState(false);
  const [clearLogsLoading, setClearLogsLoading] = useState(false);
  const [clearModalVisible, setClearModalVisible] = useState(false);
  const [clearMonths, setClearMonths] = useState(0);
  const [clearPassword, setClearPassword] = useState('');
  const [clearPasswordError, setClearPasswordError] = useState('');
  const [clearVerifying, setClearVerifying] = useState(false);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();

  const [searchParams, setSearchParams] = useState<SearchParams>(defaultParams);
  const searchParamsRef = useRef<SearchParams>(defaultParams);
  searchParamsRef.current = searchParams;

  const fetchData = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const activeParams = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(activeParams.username ? { username: activeParams.username } : {}),
        ...(activeParams.status ? { status: activeParams.status } : {}),
      });
      if (activeParams.timeRange) {
        query.set('startTime', formatDateTimeForApi(activeParams.timeRange[0]));
        query.set('endTime', formatDateTimeForApi(activeParams.timeRange[1]));
      }
      const res = await request.get<PaginatedResponse<LoginLog>>(`/api/login-logs?${query.toString()}`);
      setData(res.data.list);
      setTotal(res.data.total);
      setPage(res.data.page);
      setPageSize(res.data.pageSize);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = () => {
    setPage(1);
    fetchData(1, pageSize);
  };

  const handleReset = () => {
    setSearchParams(defaultParams);
    setPage(1);
    fetchData(1, pageSize, defaultParams);
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
    setClearLogsLoading(true);
    try {
      const res = await request.delete(`/api/login-logs/clean?months=${clearMonths}`);
      if (res.code === 0) {
        Toast.success(res.message || '清除成功');
        setPage(1);
        void fetchData(1, pageSize);
      }
    } finally {
      setClearLogsLoading(false);
    }
  };

  return (
    <div className="page-container">
      <Tabs type="line">
        <TabPane tab="日志列表" itemKey="list">
          <SearchToolbar>
          <Input
            prefix={<Search size={14} />}
            placeholder="请输入用户名"
            value={searchParams.username}
            onChange={(v) => setSearchParams({ ...searchParams, username: v })}
            onEnterPress={handleSearch}
            style={{ width: 180 }}
            showClear
          />
          <Select
            placeholder="请选择状态"
            value={searchParams.status || undefined}
            onChange={(v) => setSearchParams({ ...searchParams, status: v as string })}
            style={{ width: 150 }}
          >
            <Select.Option value="">全部</Select.Option>
            <Select.Option value="success">成功</Select.Option>
            <Select.Option value="fail">失败</Select.Option>
          </Select>
          <DatePicker
            type="dateTimeRange"
            placeholder={["开始时间", "结束时间"]}
            value={searchParams.timeRange ?? undefined}
            onChange={(v) => setSearchParams({ ...searchParams, timeRange: v ? (v as [Date, Date]) : null })}
            style={{ width: 360 }}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
            查询
          </Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>
            重置
          </Button>
          <SplitButtonGroup>
            <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/login-logs/export', '登录日志.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
            <Dropdown
              trigger="click"
              position="bottomRight"
              clickToHide
              render={(
                <Dropdown.Menu>
                  <Dropdown.Item onClick={async () => { setExportLoading(true); try { await request.download('/api/login-logs/export', '登录日志.xlsx'); } finally { setExportLoading(false); } }}>导出 Excel</Dropdown.Item>
                  <Dropdown.Item onClick={async () => { setExportCsvLoading(true); try { await request.download('/api/login-logs/export/csv', '登录日志.csv'); } finally { setExportCsvLoading(false); } }}>导出 CSV</Dropdown.Item>
                </Dropdown.Menu>
              )}
            >
              <Button type="primary" icon={<ChevronDown size={14} />} loading={exportCsvLoading} />
            </Dropdown>
          </SplitButtonGroup>
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
      </SearchToolbar>

          <LoginLogsTable
            dataSource={data}
            loading={loading}
            onRefresh={() => void fetchData()}
            pagination={buildPagination(total, fetchData)}
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
