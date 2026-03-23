import React, { useState, useEffect } from 'react';
import { Table, Input, Button, Tag, Space, DatePicker, Modal, JsonViewer } from '@douyinfe/semi-ui';
import { Search, RotateCcw, Eye } from 'lucide-react';
import { request } from '../../../utils/request';
import { formatDateTime } from '../../../utils/date';
import type { OperationLog, PaginatedResponse } from '@zenith/shared';

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

interface SearchParams {
  username: string;
  module: string;
  description: string;
  timeRange: [Date, Date] | null;
}

const defaultParams: SearchParams = { username: '', module: '', description: '', timeRange: null };

export default function OperationLogsPage() {
  const [data, setData] = useState<OperationLog[]>([]);
  const [loading, setLoading] = useState(false);
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
          icon={<Eye size={14} />}
          onClick={() => setDetailLog(record)}
        >
          详情
        </Button>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="search-area">
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
                    key={detailLog.id}
                    value={(() => { try { return JSON.stringify(JSON.parse(detailLog.requestBody), null, 2); } catch { return detailLog.requestBody; } })()}
                    height={220}
                    width="100%"
                    options={{ readOnly: true, autoWrap: true, formatOptions: { tabSize: 2, insertSpaces: true } }}
                  />
                </DetailField>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
