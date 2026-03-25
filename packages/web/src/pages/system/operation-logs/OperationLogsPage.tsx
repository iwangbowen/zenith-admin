import React, { useState, useEffect } from 'react';
import { Table, Input, Button, Tag, Space, DatePicker, Modal, JsonViewer, Select, Tabs, TabPane } from '@douyinfe/semi-ui';
import { Search, RotateCcw, Download } from 'lucide-react';
import { request } from '../../../utils/request';
import { formatDateTime } from '../../../utils/date';
import type { OperationLog, PaginatedResponse } from '@zenith/shared';
import './OperationLogsPage.css';
import OperationLogStatsPanel from './OperationLogStatsPanel';

const detailLabelStyle: React.CSSProperties = { color: 'var(--semi-color-text-2)', fontSize: 12, marginBottom: 2 };
const detailValueStyle: React.CSSProperties = { fontSize: 13, wordBreak: 'break-all' };
const detailItemStyle: React.CSSProperties = { padding: '8px 0', borderBottom: '1px solid var(--semi-color-border)' };

function DetailField({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div style={detailItemStyle}>
      <div style={detailLabelStyle}>{label}</div>
      <div style={detailValueStyle}>{children}</div>
    </div>
  );
}

function DataDiff({ beforeData, afterData }: Readonly<{ beforeData: string | null; afterData: string | null }>) {
  const parseSafe = (s: string | null): Record<string, unknown> | null => {
    if (!s) return null;
    try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
  };
  const before = parseSafe(beforeData);
  const after = parseSafe(afterData);

  if (!before && !after) {
    return <span style={{ color: 'var(--semi-color-text-2)' }}>无变更数据</span>;
  }

  const allKeys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  const changedKeys = allKeys.filter((k) => {
    const bv = JSON.stringify(before?.[k]);
    const av = JSON.stringify(after?.[k]);
    return bv !== av;
  });

  if (changedKeys.length === 0 && before && after) {
    return <span style={{ color: 'var(--semi-color-text-2)' }}>数据未发生变化</span>;
  }

  const displayKeys = changedKeys.length > 0 ? changedKeys : allKeys;
  const fmtVal = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === 'object') return JSON.stringify(v);
    // v is a primitive (string, number, boolean, bigint, symbol) here
    return `${v as string | number | boolean}`;
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ background: 'var(--semi-color-fill-0)' }}>
          <th style={{ padding: '4px 8px', textAlign: 'left', width: '30%' }}>字段</th>
          <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--semi-color-danger)' }}>变更前</th>
          <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--semi-color-success)' }}>变更后</th>
        </tr>
      </thead>
      <tbody>
        {displayKeys.map((k) => {
          const bv = before?.[k];
          const av = after?.[k];
          const changed = JSON.stringify(bv) !== JSON.stringify(av);
          return (
            <tr key={k} style={{ background: changed ? 'var(--semi-color-warning-light-default)' : undefined }}>
              <td style={{ padding: '3px 8px', fontWeight: 500 }}>{k}</td>
              <td style={{ padding: '3px 8px', color: changed ? 'var(--semi-color-danger)' : undefined }}>
                {fmtVal(bv) == null ? <span style={{ opacity: 0.4 }}>—</span> : fmtVal(bv)}
              </td>
              <td style={{ padding: '3px 8px', color: changed ? 'var(--semi-color-success)' : undefined }}>
                {fmtVal(av) == null ? <span style={{ opacity: 0.4 }}>—</span> : fmtVal(av)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface SearchParams {
  username: string;
  module: string;
  description: string;
  method: string;
  path: string;
  status: string;
  timeRange: [Date, Date] | null;
}

const defaultParams: SearchParams = { username: '', module: '', description: '', method: '', path: '', status: '', timeRange: null };

export default function OperationLogsPage() {
  const [activeTab, setActiveTab] = useState<'list' | 'stats'>('list');
  const [data, setData] = useState<OperationLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultParams);
  const [detailLog, setDetailLog] = useState<OperationLog | null>(null);

  const fetchData = async (p = page, ps = pageSize, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.username ? { username: params.username } : {}),
        ...(params.module ? { module: params.module } : {}),
        ...(params.description ? { description: params.description } : {}),
        ...(params.method ? { method: params.method } : {}),
        ...(params.path ? { path: params.path } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.timeRange ? { startTime: params.timeRange[0].toISOString(), endTime: params.timeRange[1].toISOString() } : {}),
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
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSearch = () => {
    setPage(1);
    fetchData(1, pageSize);
  };

  const handleReset = () => {
    setSearchParams(defaultParams);
    setPage(1);
    fetchData(1, pageSize, defaultParams);
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '操作人', dataIndex: 'username', width: 110, render: (v: string | null) => v ?? '-' },
    { title: '功能模块', dataIndex: 'module', width: 120, render: (v: string | null) => v ?? '-' },
    { title: '操作描述', dataIndex: 'description', width: 140 },
    { title: '请求方法', dataIndex: 'method', width: 90, render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '请求路径', dataIndex: 'path', width: 180, ellipsis: true },
    { title: 'IP 地址', dataIndex: 'ip', width: 130, render: (v: string | null) => v ?? '-' },
    { title: '操作系统', dataIndex: 'os', width: 130, render: (v: string | null) => v ?? '-' },
    { title: '浏览器', dataIndex: 'browser', width: 150, render: (v: string | null) => v ?? '-' },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 90,
      render: (v: number | null) => v === null ? '-' : `${v} ms`,
    },
    {
      title: '状态',
      dataIndex: 'responseCode',
      width: 90,
      render: (v: number | null) => {
        const success = v != null && v >= 200 && v < 400;
        return <Tag color={success ? 'green' : 'red'}>{success ? '成功' : '失败'}</Tag>;
      },
    },
    {
      title: '操作时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '操作',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, record: OperationLog) => (
        <Button
          theme="borderless"
          type="primary"
          size="small"
          onClick={() => setDetailLog(record)}
        >
          详情
        </Button>
      ),
    },
  ];

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
          <div className="search-area">
        <div className="responsive-toolbar">
          <div className="responsive-toolbar__left">
            <Space wrap>
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
              <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
                查询
              </Button>
              <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>
                重置
              </Button>
            </Space>
          </div>
          <div className="responsive-toolbar__right">
            <Space>
              <Button icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/operation-logs/export', '操作日志.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
            </Space>
          </div>
        </div>
      </div>

      <div>
        <Table
          bordered
          columns={columns}
          dataSource={data}
          loading={loading}
          scroll={{ x: 1600 }}
          pagination={{
            currentPage: page,
            pageSize,
            total,
            onPageChange: (c) => { void fetchData(c, pageSize); },
            onPageSizeChange: (s) => { void fetchData(1, s); },
          }}
        />
      </div>
        </>
      )}
      {activeTab === 'stats' && (
        <div style={{ paddingTop: 16 }}>
          <OperationLogStatsPanel />
        </div>
      )}

      <Modal
        title="操作日志详情"
        visible={detailLog !== null}
        onCancel={() => setDetailLog(null)}
        footer={null}
        width={680}
        style={{ top: 40 }}
      >
        {detailLog && (() => {
          const resCode = detailLog.responseCode;
          const resOk = resCode != null && resCode >= 200 && resCode < 400;
          const duration = detailLog.durationMs == null ? '-' : `${detailLog.durationMs} ms`;
          return (
            <div style={{ padding: '4px 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0 16px' }}>
                <div style={detailItemStyle}>
                  <div style={detailLabelStyle}>ID</div>
                  <div style={detailValueStyle}>{detailLog.id}</div>
                </div>
                <div style={detailItemStyle}>
                  <div style={detailLabelStyle}>操作人</div>
                  <div style={detailValueStyle}>{detailLog.username ?? '-'}</div>
                </div>
                <div style={detailItemStyle}>
                  <div style={detailLabelStyle}>功能模块</div>
                  <div style={detailValueStyle}>{detailLog.module ?? '-'}</div>
                </div>
                <div style={detailItemStyle}>
                  <div style={detailLabelStyle}>操作描述</div>
                  <div style={detailValueStyle}>{detailLog.description}</div>
                </div>
                <div style={detailItemStyle}>
                  <div style={detailLabelStyle}>请求方法</div>
                  <div style={detailValueStyle}><Tag color="blue" size="small">{detailLog.method}</Tag></div>
                </div>
                <div style={detailItemStyle}>
                  <div style={detailLabelStyle}>响应状态</div>
                  <div style={detailValueStyle}><Tag color={resOk ? 'green' : 'red'} size="small">{resCode ?? '-'}</Tag></div>
                </div>
                <div style={detailItemStyle}>
                  <div style={detailLabelStyle}>耗时</div>
                  <div style={detailValueStyle}>{duration}</div>
                </div>
                <div style={detailItemStyle}>
                  <div style={detailLabelStyle}>操作时间</div>
                  <div style={detailValueStyle}>{formatDateTime(detailLog.createdAt)}</div>
                </div>
                <div style={detailItemStyle}>
                  <div style={detailLabelStyle}>IP 地址</div>
                  <div style={detailValueStyle}>{detailLog.ip ?? '-'}</div>
                </div>
                <div style={detailItemStyle}>
                  <div style={detailLabelStyle}>操作系统</div>
                  <div style={detailValueStyle}>{detailLog.os ?? '-'}</div>
                </div>
                <div style={{ ...detailItemStyle, gridColumn: 'span 2' }}>
                  <div style={detailLabelStyle}>浏览器</div>
                  <div style={detailValueStyle}>{detailLog.browser ?? '-'}</div>
                </div>
              </div>
              <DetailField label="请求路径">{detailLog.path}</DetailField>
              {detailLog.userAgent && (
                <DetailField label="User-Agent">{detailLog.userAgent}</DetailField>
              )}
              {detailLog.requestBody && (
                <DetailField label="请求体">
                  <JsonViewer
                    className="operation-log-json-viewer"
                    key={detailLog.id}
                    value={(() => { try { return JSON.stringify(JSON.parse(detailLog.requestBody), null, 2); } catch { return detailLog.requestBody; } })()}
                    height={220}
                    width="100%"
                    options={{ readOnly: true, autoWrap: true, formatOptions: { tabSize: 2, insertSpaces: true } }}
                  />
                </DetailField>
              )}
              {(detailLog.beforeData ?? detailLog.afterData) && (
                <DetailField label="数据变更">
                  <DataDiff beforeData={detailLog.beforeData} afterData={detailLog.afterData} />
                </DetailField>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
