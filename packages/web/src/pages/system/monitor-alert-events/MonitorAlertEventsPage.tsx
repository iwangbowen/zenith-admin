import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Select, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw, Search } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import type { MonitorAlertEvent, MonitorMetric, PaginatedResponse } from '@zenith/shared';

const METRIC_LABELS: Record<MonitorMetric, string> = {
  cpu: 'CPU 使用率', memory: '内存使用率', disk: '磁盘使用率', swap: 'Swap 使用率',
  load1: '系统负载(1m)', procCpu: '进程 CPU', heap: '堆内存使用率', loopLag: '事件循环延迟',
  qps: '请求 QPS', errorRate: 'HTTP 错误率', netRxBps: '网络下行', netTxBps: '网络上行',
  diskReadBps: '磁盘读取', diskWriteBps: '磁盘写入',
  workflowHealth: '流程引擎健康分', workflowBacklog: '流程引擎队列积压',
};
const METRIC_OPTIONS = (Object.keys(METRIC_LABELS) as MonitorMetric[]).map((v) => ({ value: v, label: METRIC_LABELS[v] }));
const PERCENT_METRICS = new Set<MonitorMetric>(['cpu', 'memory', 'disk', 'swap', 'heap', 'procCpu', 'errorRate']);
const BYTES_METRICS = new Set<MonitorMetric>(['netRxBps', 'netTxBps', 'diskReadBps', 'diskWriteBps']);
const OP_SYMBOL: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };
const LEVEL_CONFIG: Record<string, { label: string; color: 'blue' | 'amber' | 'red' }> = {
  info: { label: '提示', color: 'blue' }, warning: { label: '警告', color: 'amber' }, critical: { label: '严重', color: 'red' },
};

function fmt(metric: MonitorMetric, value: number): string {
  if (BYTES_METRICS.has(metric)) {
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let v = value; let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${Math.round(v * 10) / 10} ${units[i]}`;
  }
  if (PERCENT_METRICS.has(metric)) return `${value}%`;
  if (metric === 'loopLag') return `${value} ms`;
  return `${value}`;
}

interface Filters { metric?: string; level?: string; status?: string; }

export default function MonitorAlertEventsPage() {
  const [data, setData] = useState<PaginatedResponse<MonitorAlertEvent> | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>({});
  const filtersRef = useRef<Filters>({});
  filtersRef.current = filters;
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();

  const fetchEvents = useCallback(async (p = page, ps = pageSize, f?: Filters) => {
    const active = f ?? filtersRef.current;
    setLoading(true);
    try {
      const q: Record<string, string> = { page: String(p), pageSize: String(ps) };
      if (active.metric) q.metric = active.metric;
      if (active.level) q.level = active.level;
      if (active.status) q.status = active.status;
      const res = await request.get<PaginatedResponse<MonitorAlertEvent>>(`/api/monitor-alerts/events?${new URLSearchParams(q).toString()}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
        setPageSize(res.data.pageSize);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    void fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleReset() {
    setFilters({});
    setPage(1);
    void fetchEvents(1, pageSize, {});
  }

  const columns: ColumnProps<MonitorAlertEvent>[] = [
    { title: '触发时间', dataIndex: 'triggeredAt', width: 165, fixed: 'left', render: (t: string) => formatDateTime(t) },
    { title: '规则', dataIndex: 'ruleName', width: 160, render: renderEllipsis },
    {
      title: '触发条件', dataIndex: 'metric', width: 210,
      render: (_: unknown, r: MonitorAlertEvent) => (
        <span>
          <Tag size="small" type="ghost">{METRIC_LABELS[r.metric] ?? r.metric}</Tag>
          {' '}{OP_SYMBOL[r.operator] ?? r.operator} {fmt(r.metric, r.threshold)}
        </span>
      ),
    },
    { title: '实际值', dataIndex: 'value', width: 110, render: (v: number, r: MonitorAlertEvent) => <b>{fmt(r.metric, v)}</b> },
    { title: '级别', dataIndex: 'level', width: 80, render: (v: string) => <Tag color={LEVEL_CONFIG[v]?.color ?? 'grey'} size="small">{LEVEL_CONFIG[v]?.label ?? v}</Tag> },
    { title: '描述', dataIndex: 'message', width: 280, render: renderEllipsis },
    { title: '恢复时间', dataIndex: 'resolvedAt', width: 165, render: (t: string | null) => t ? formatDateTime(t) : <span style={{ color: 'var(--semi-color-text-2)' }}>—</span> },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (s: string) => s === 'firing' ? <Tag color="red" size="small">告警中</Tag> : <Tag color="green" size="small">已恢复</Tag>,
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Select
              placeholder="全部指标"
              value={filters.metric}
              onChange={(v) => setFilters((p) => ({ ...p, metric: v as string }))}
              showClear
              style={{ width: 150 }}
              optionList={METRIC_OPTIONS}
            />
            <Select
              placeholder="全部级别"
              value={filters.level}
              onChange={(v) => setFilters((p) => ({ ...p, level: v as string }))}
              showClear
              style={{ width: 120 }}
              optionList={Object.entries(LEVEL_CONFIG).map(([v, c]) => ({ value: v, label: c.label }))}
            />
            <Select
              placeholder="全部状态"
              value={filters.status}
              onChange={(v) => setFilters((p) => ({ ...p, status: v as string }))}
              showClear
              style={{ width: 120 }}
              optionList={[{ value: 'firing', label: '告警中' }, { value: 'resolved', label: '已恢复' }]}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); void fetchEvents(1, pageSize); }}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
        mobilePrimary={(
          <>
            <Select
              placeholder="全部指标"
              value={filters.metric}
              onChange={(v) => setFilters((p) => ({ ...p, metric: v as string }))}
              showClear
              style={{ width: 150 }}
              optionList={METRIC_OPTIONS}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); void fetchEvents(1, pageSize); }}>查询</Button>
          </>
        )}
        mobileFilters={(
          <>
            <Select
              placeholder="全部级别"
              value={filters.level}
              onChange={(v) => setFilters((p) => ({ ...p, level: v as string }))}
              showClear
              style={{ width: 120 }}
              optionList={Object.entries(LEVEL_CONFIG).map(([v, c]) => ({ value: v, label: c.label }))}
            />
            <Select
              placeholder="全部状态"
              value={filters.status}
              onChange={(v) => setFilters((p) => ({ ...p, status: v as string }))}
              showClear
              style={{ width: 120 }}
              optionList={[{ value: 'firing', label: '告警中' }, { value: 'resolved', label: '已恢复' }]}
            />
          </>
        )}
        filterTitle="告警事件筛选"
        onFilterApply={() => { setPage(1); void fetchEvents(1, pageSize); }}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={loading}
        rowKey="id"
        size="small"
        empty="暂无告警记录"
        onRefresh={() => void fetchEvents()}
        refreshLoading={loading}
        pagination={buildPagination(data?.total ?? 0, fetchEvents)}
      />
    </div>
  );
}
