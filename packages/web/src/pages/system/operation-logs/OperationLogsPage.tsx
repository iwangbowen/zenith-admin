import { useState, useEffect, useCallback, useRef } from 'react';
import { Input, Button, DatePicker, Select, Tabs, TabPane, InputNumber, SplitButtonGroup, Dropdown, Modal, Toast } from '@douyinfe/semi-ui';
import { Search, RotateCcw, Download, ChevronDown, Trash2 } from 'lucide-react';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { OperationLogsTable } from '@/components/logs/OperationLogsTable';
import { usePagination } from '@/hooks/usePagination';
import { formatDateTimeForApi } from '@/utils/date';
import type { OperationLog, PaginatedResponse } from '@zenith/shared';
import OperationLogStatsPanel from './OperationLogStatsPanel';

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
  const [activeTab, setActiveTab] = useState<'list' | 'stats'>('list');
  const [data, setData] = useState<OperationLog[]>([]);
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
        ...(activeParams.module ? { module: activeParams.module } : {}),
        ...(activeParams.description ? { description: activeParams.description } : {}),
        ...(activeParams.ip ? { ip: activeParams.ip } : {}),
        ...(activeParams.method ? { method: activeParams.method } : {}),
        ...(activeParams.path ? { path: activeParams.path } : {}),
        ...(activeParams.status ? { status: activeParams.status } : {}),
        ...(activeParams.timeRange ? { startTime: formatDateTimeForApi(activeParams.timeRange[0]), endTime: formatDateTimeForApi(activeParams.timeRange[1]) } : {}),
        ...(activeParams.minDurationMs === null ? {} : { minDurationMs: String(activeParams.minDurationMs) }),
        ...(activeParams.maxDurationMs === null ? {} : { maxDurationMs: String(activeParams.maxDurationMs) }),
      }).toString();
      const res = await request.get<PaginatedResponse<OperationLog>>(`/api/operation-logs?${query}`);
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
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const buildExportQuery = () => {
    const p = searchParamsRef.current;
    return new URLSearchParams({
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
    }).toString();
  };

  const handleExportExcel = async () => {
    setExportLoading(true);
    try { await request.download(`/api/operation-logs/export?${buildExportQuery()}`, '操作日志.xlsx'); } finally { setExportLoading(false); }
  };

  const handleExportCsv = async () => {
    setExportCsvLoading(true);
    try { await request.download(`/api/operation-logs/export/csv?${buildExportQuery()}`, '操作日志.csv'); } finally { setExportCsvLoading(false); }
  };

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
      const res = await request.delete(`/api/operation-logs/clean?months=${clearMonths}`);
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
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'list' | 'stats')}
        type="line"
        style={{ marginBottom: 0 }}
      >
        <TabPane tab="日志列表" itemKey="list" />
        <TabPane tab="统计分析" itemKey="stats" />
      </Tabs>
      {activeTab === 'list' && (
        <>
          <SearchToolbar>
              <Input
                prefix={<Search size={14} />}
                placeholder="请输入操作人"
                value={searchParams.username}
                onChange={(v) => setSearchParams({ ...searchParams, username: v })}
                onEnterPress={handleSearch}
                style={{ width: 160 }}
                showClear
              />
              <Input
                prefix={<Search size={14} />}
                placeholder="请输入功能模块"
                value={searchParams.module}
                onChange={(v) => setSearchParams({ ...searchParams, module: v })}
                onEnterPress={handleSearch}
                style={{ width: 160 }}
                showClear
              />
              <Input
                prefix={<Search size={14} />}
                placeholder="请输入操作描述"
                value={searchParams.description}
                onChange={(v) => setSearchParams({ ...searchParams, description: v })}
                onEnterPress={handleSearch}
                style={{ width: 160 }}
                showClear
              />
              <Select
                placeholder="请求方法"
                value={searchParams.method || undefined}
                onChange={(v) => setSearchParams({ ...searchParams, method: v as string })}
                style={{ width: 130 }}
                showClear
              >
                <Select.Option value="GET">GET</Select.Option>
                <Select.Option value="POST">POST</Select.Option>
                <Select.Option value="PUT">PUT</Select.Option>
                <Select.Option value="PATCH">PATCH</Select.Option>
                <Select.Option value="DELETE">DELETE</Select.Option>
              </Select>
              <Input
                prefix={<Search size={14} />}
                placeholder="请输入请求路径"
                value={searchParams.path}
                onChange={(v) => setSearchParams({ ...searchParams, path: v })}
                onEnterPress={handleSearch}
                style={{ width: 180 }}
                showClear
              />
              <Input
                prefix={<Search size={14} />}
                placeholder="请输入 IP 地址"
                value={searchParams.ip}
                onChange={(v) => setSearchParams({ ...searchParams, ip: v })}
                onEnterPress={handleSearch}
                style={{ width: 160 }}
                showClear
              />
              <Select
                placeholder="操作状态"
                value={searchParams.status || undefined}
                onChange={(v) => setSearchParams({ ...searchParams, status: v as string })}
                style={{ width: 130 }}
                showClear
              >
                <Select.Option value="success">成功</Select.Option>
                <Select.Option value="fail">失败</Select.Option>
              </Select>
              <DatePicker
                type="dateTimeRange"
                placeholder={['开始时间', '结束时间']}
                value={searchParams.timeRange ?? undefined}
                onChange={(v) => setSearchParams({ ...searchParams, timeRange: v ? (v as [Date, Date]) : null })}
                style={{ width: 360 }}
              />
              <InputNumber
                placeholder="耗时 ≥ (ms)"
                value={searchParams.minDurationMs ?? undefined}
                onChange={(v) => setSearchParams({ ...searchParams, minDurationMs: v !== '' && v != null ? Number(v) : null })}
                min={0}
                style={{ width: 130 }}
                hideButtons
              />
              <InputNumber
                placeholder="耗时 ≤ (ms)"
                value={searchParams.maxDurationMs ?? undefined}
                onChange={(v) => setSearchParams({ ...searchParams, maxDurationMs: v !== '' && v != null ? Number(v) : null })}
                min={0}
                style={{ width: 130 }}
                hideButtons
              />
              <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
                查询
              </Button>
              <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>
                重置
              </Button>
              <SplitButtonGroup>
                <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={handleExportExcel}>导出</Button>
                <Dropdown
                  trigger="click"
                  position="bottomRight"
                  clickToHide
                  render={
                    <Dropdown.Menu>
                      <Dropdown.Item onClick={handleExportExcel}>导出 Excel</Dropdown.Item>
                      <Dropdown.Item onClick={handleExportCsv}>导出 CSV</Dropdown.Item>
                    </Dropdown.Menu>
                  }
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
          </SearchToolbar>

          <OperationLogsTable
            dataSource={data}
            loading={loading}
            onRefresh={() => void fetchData()}
            scroll={{ x: 1600 }}
            pagination={buildPagination(total, fetchData)}
          />
        </>
      )}
      {activeTab === 'stats' && (
        <div style={{ paddingTop: 16 }}>
          <OperationLogStatsPanel />
        </div>
      )}
      <Modal
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
      </Modal>
    </div>
  );
}
