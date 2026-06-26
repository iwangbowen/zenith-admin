import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Descriptions, Progress, Skeleton, Tabs, TabPane, Toast, Typography, Select, Tag, Table } from '@douyinfe/semi-ui';
import { LineChart, chartOptions, makeLineSpec, useChartPalette } from '@/components/charts';
import { RefreshCw, Cpu, HardDrive, Database, Server, MemoryStick, Layers, Activity, Network, Wifi, History, Thermometer, ListTree } from 'lucide-react';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { config } from '@/config';
import { TOKEN_KEY } from '@zenith/shared';
import './MonitorPage.css';

const { Text } = Typography;

interface EventLoopStats {
  meanMs: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number; stddevMs: number;
}
interface GcStats {
  totalCount: number;
  totalDurationMs: number;
  byKind: Record<string, { count: number; durationMs: number }>;
}
interface HeapSpace { name: string; size: number; used: number; available: number; }
interface ResourceUsage {
  userCPUMicros: number; systemCPUMicros: number; maxRssBytes: number;
  fsRead: number; fsWrite: number;
  voluntaryContextSwitches: number; involuntaryContextSwitches: number;
}
interface HttpStats {
  qps: number; currentQps: number; total: number; errors: number; errorRate: number;
  total4xx: number; total5xx: number;
  p50: number; p95: number; p99: number; max: number;
}
interface DbConnectionStates {
  active: number; idle: number; idleInTransaction: number; other: number;
}
interface DbSlowQuery { query: string; calls: number; meanMs: number; totalMs: number; }
interface DbInfo {
  name: string; size: number; activeConnections: number; totalConnections: number; tableCount: number;
  connectionStates?: DbConnectionStates;
  cacheHit?: { blksHit: number; blksRead: number; ratio: number };
  transactions?: { commit: number; rollback: number; deadlocks: number; tempBytes: number };
  slowQueries?: DbSlowQuery[] | null;
  slowQueriesAvailable?: boolean;
}
interface RedisSlowEntry { id: number; timestamp: number; durationMs: number; command: string; }
interface RedisInfo {
  version: string; uptimeSeconds: number; connectedClients: number;
  blockedClients?: number; rejectedConnections?: number;
  usedMemory: number; usedMemoryHuman: string; usedMemoryRss?: number;
  memFragmentationRatio?: number; maxMemory?: number; maxMemoryPolicy?: string;
  totalCommandsProcessed: number; keyspaceHits: number; keyspaceMisses: number;
  keyCount: number; role: string;
  rdbLastSaveTime?: number; rdbChangesSinceLastSave?: number; aofEnabled?: boolean;
  masterLinkStatus?: string | null;
  slowLog?: RedisSlowEntry[];
}

interface PerCoreCpu { index: number; usage: number; user: number; system: number; idle: number; }

interface NetIfaceStats {
  name: string; rxBytes: number; txBytes: number; rxBps: number; txBps: number;
  rxPackets: number; txPackets: number; rxErrors: number; txErrors: number;
}

interface DiskItem {
  filesystem: string; total: number; used: number; free: number; usagePercent: number; mount: string;
}

interface TopProcessItem { pid: number; name: string; cpu: number; memPercent: number; memBytes: number; }
interface TopProcesses { byCpu: TopProcessItem[]; byMemory: TopProcessItem[]; }
interface TemperatureSensor { label: string; celsius: number; }
interface TemperatureInfo { cpu: number | null; sensors: TemperatureSensor[]; }

interface LinuxMemDetail {
  memTotal: number; memFree: number; memAvailable: number;
  buffers: number; cached: number; shared: number;
  swapTotal: number; swapFree: number; swapCached: number; swapUsagePercent: number;
  dirty: number; writeback: number;
}

interface MonitorData {
  os: { platform: string; release: string; arch: string; hostname: string; uptimeSeconds: number; };
  cpu: { model: string; cores: number; speed: number; loadAvg: [number, number, number]; usage: number; perCore?: PerCoreCpu[] };
  memory: { total: number; used: number; free: number; usagePercent: number; detail?: LinuxMemDetail | null };
  disk: { total: number; used: number; free: number; usagePercent: number; mount?: string } | null;
  disks?: DiskItem[];
  diskIo?: { readBps: number; writeBps: number };
  network?: NetIfaceStats[];
  topProcesses?: TopProcesses | null;
  temperature?: TemperatureInfo | null;
  node: {
    version: string; uptime: number; pid: number;
    memoryUsage: { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers?: number };
    cpuUsagePercent?: number;
    eventLoop?: EventLoopStats;
    gc?: GcStats;
    heapSpaces?: HeapSpace[];
    resourceUsage?: ResourceUsage;
  };
  http?: HttpStats;
  database: DbInfo | null;
  redis: RedisInfo | null;
}

interface TimeseriesPoint {
  t: number; cpu: number; mem: number; procCpu: number; heap: number;
  loopLagMean: number; loopLagP99: number; qps: number; errorRate: number;
  netRxBps?: number; netTxBps?: number; diskReadBps?: number; diskWriteBps?: number;
}
interface TimeseriesData { intervalSec: number; capacity: number; points: TimeseriesPoint[]; }

interface HistoryPoint {
  t: string; cpu: number; memory: number; disk: number; swap: number; load1: number;
  procCpu: number; heap: number; loopLag: number; qps: number; errorRate: number;
  netRxBps: number; netTxBps: number; diskReadBps: number; diskWriteBps: number;
}
interface HistoryData { range: string; bucketSec: number; points: HistoryPoint[]; }

const HISTORY_RANGES: { label: string; value: string }[] = [
  { label: '近 1 小时', value: '1h' },
  { label: '近 6 小时', value: '6h' },
  { label: '近 24 小时', value: '24h' },
  { label: '近 7 天', value: '7d' },
  { label: '近 30 天', value: '30d' },
];

interface WsConnection {
  tokenId: string;
  userId: number;
  username: string | null;
  nickname: string | null;
  connectedAt: number;
  lastActivityAt: number;
  sent: number;
  recv: number;
}
interface WsDisconnect {
  tokenId: string;
  userId: number;
  username: string | null;
  nickname: string | null;
  at: number;
  reason: string;
  duration: number;
  sent: number;
  recv: number;
}
interface WsMetrics {
  currentConnections: number;
  currentUsers: number;
  totalConnects: number;
  totalDisconnects: number;
  totalSent: number;
  totalRecv: number;
  connections: WsConnection[];
  recentDisconnects: WsDisconnect[];
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const numberFormatter = new Intl.NumberFormat('zh-CN');
function formatNumber(value: number): string { return numberFormatter.format(value); }

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}时`);
  if (m > 0) parts.push(`${m}分`);
  parts.push(`${s}秒`);
  return parts.join(' ');
}

function formatDuration(ms: number): string {
  return formatUptime(Math.max(0, Math.floor(ms / 1000)));
}

function getProgressClass(percent: number): string {
  if (percent >= 90) return 'monitor-progress-danger';
  if (percent >= 70) return 'monitor-progress-warning';
  return '';
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const SKELETON_ROW_KEYS = ['r0','r1','r2','r3','r4','r5','r6','r7','r8','r9','r10','r11'] as const;

const REFRESH_OPTIONS = [
  { label: '实时推送 (SSE)', value: -1 },
  { label: '5 秒', value: 5000 },
  { label: '10 秒', value: 10000 },
  { label: '30 秒', value: 30000 },
  { label: '60 秒', value: 60000 },
  { label: '暂停', value: 0 },
];

function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return '0 B/s';
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  if (bps < 1024 * 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
  return `${(bps / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
}

const SSE_STATUS_META: Record<'idle' | 'connecting' | 'open' | 'error', { color: 'grey' | 'blue' | 'green' | 'red'; text: string }> = {
  idle: { color: 'grey', text: '未连接' },
  connecting: { color: 'blue', text: '连接中…' },
  open: { color: 'green', text: '实时推送中' },
  error: { color: 'red', text: '连接异常' },
};

export default function MonitorPage() {
  const palette = useChartPalette();
  const [data, setData] = useState<MonitorData | null>(null);
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);
  const [wsMetrics, setWsMetrics] = useState<WsMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<number>(30000);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [historyRange, setHistoryRange] = useState<string>('1h');
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  /** SSE 连接状态，仅在 SSE 模式下展示 */
  const [sseStatus, setSseStatus] = useState<'idle' | 'connecting' | 'open' | 'error'>('idle');
  const sseAbortRef = useRef<AbortController | null>(null);

  const intervalRef = useRef<number>(refreshInterval);
  intervalRef.current = refreshInterval;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, tsRes, wsRes] = await Promise.all([
        request.get<MonitorData>('/api/monitor', { silent: true }),
        request.get<TimeseriesData>('/api/monitor/timeseries', { silent: true }),
        request.get<WsMetrics>('/api/monitor/ws', { silent: true }),
      ]);
      if (statusRes.code === 0 && statusRes.data) {
        setData(statusRes.data);
        setLastUpdated(new Date());
      } else {
        Toast.error('获取监控数据失败');
      }
      if (tsRes.code === 0 && tsRes.data) {
        setSeries(tsRes.data.points);
      }
      if (wsRes.code === 0 && wsRes.data) {
        setWsMetrics(wsRes.data);
      }
    } catch {
      Toast.error('网络请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 首次进入页面拉一次（总览 + 时序）
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /**
   * 轮询模式：refreshInterval > 0 时生效
   * SSE 模式（值=-1）与“暂停”（值=0）跳过
   */
  useEffect(() => {
    if (refreshInterval <= 0) return;
    const timer = globalThis.setInterval(fetchData, refreshInterval);
    return () => globalThis.clearInterval(timer);
  }, [fetchData, refreshInterval]);

  /**
   * SSE 订阅模式：refreshInterval === -1 时生效
   * 首帧 `metrics` 为完整 snapshot；后续 `metrics:diff` 为差量 patch（约定：null 表示删除该键）。
   * 数组使用整段替换；对象使用递归合并。
   */
  useEffect(() => {
    if (refreshInterval !== -1) {
      setSseStatus('idle');
      return;
    }
    setSseStatus('connecting');
    const ctrl = new AbortController();
    sseAbortRef.current = ctrl;
    let buffer = '';

    /** 将 patch 深合并到 base，返回合并结果（不修改入参 base） */
    const mergePatch = (base: unknown, patch: unknown): unknown => {
      if (patch === null) return undefined; // 删除标记
      if (patch === undefined) return base;
      if (Array.isArray(patch)) return patch; // 数组整段替换
      if (typeof patch !== 'object' || typeof base !== 'object' || base === null || Array.isArray(base)) {
        return patch;
      }
      const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
      for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
        if (v === null) {
          delete out[k];
        } else {
          out[k] = mergePatch(out[k], v);
        }
      }
      return out;
    };

    (async () => {
      try {
        const token = localStorage.getItem(TOKEN_KEY);
        const res = await fetch(`${config.apiBaseUrl}/api/monitor/stream`, {
          headers: { Authorization: `Bearer ${token ?? ''}` },
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          Toast.error('实时推送连接失败');
          setSseStatus('error');
          return;
        }
        setSseStatus('open');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            let currentEvent = '';
            let dataLine = '';
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLine += line.slice(5).trimStart();
            }
            if (!dataLine) continue;
            try {
              const payload: unknown = JSON.parse(dataLine);
              if (currentEvent === 'metrics') {
                setData(payload as MonitorData);
                setLastUpdated(new Date());
                setLoading(false);
              } else if (currentEvent === 'metrics:diff') {
                setData((prev) => (prev ? (mergePatch(prev, payload) as MonitorData) : prev));
                setLastUpdated(new Date());
              }
            } catch { /* ignore parse error */ }
          }
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return;
        Toast.error('实时推送连接中断');
        setSseStatus('error');
      }
    })();
    return () => { ctrl.abort(); };
  }, [refreshInterval]);

  const chartData = useMemo(
    () => series.map((p) => ({ ...p, time: formatTimestamp(p.t) })),
    [series],
  );

  const fetchHistory = useCallback(async (range: string) => {
    setHistoryLoading(true);
    try {
      const res = await request.get<HistoryData>(`/api/monitor/history?range=${range}`, { silent: true });
      if (res.code === 0 && res.data) setHistory(res.data.points);
    } catch {
      // 静默
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // 进入「历史趋势」标签或切换时间范围时拉取历史数据
  useEffect(() => {
    if (activeTab === 'history') fetchHistory(historyRange);
  }, [activeTab, historyRange, fetchHistory]);

  const historyChartData = useMemo(
    () => history.map((p) => ({ ...p, time: p.t.length > 10 ? p.t.slice(5, 16) : p.t })),
    [history],
  );

  function renderSkeleton() {
    return (
      <Skeleton active loading placeholder={
        <div>
          <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
            {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
              <Skeleton.Button key={k} style={{ width: 64, height: 32, borderRadius: 4 }} />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            {SKELETON_ROW_KEYS.map((k) => (
              <div key={k} style={{ padding: '10px 12px 10px 0', borderBottom: '1px solid var(--color-border)' }}>
                <Skeleton.Title style={{ width: '40%', height: 12, margin: '0 0 8px' }} />
                <Skeleton.Title style={{ width: '70%', height: 14, margin: 0 }} />
              </div>
            ))}
          </div>
        </div>
      } />
    );
  }

  function renderTrendChart(title: string, lines: { dataKey: keyof TimeseriesPoint; label: string; color: string }[], unit?: string) {
    const trendSpec = makeLineSpec({
      data: chartData,
      xField: 'time',
      series: lines.map((line) => ({ field: String(line.dataKey), name: line.label, color: line.color })),
      palette,
      axis: { yLabel: (value) => (unit ? `${value}${unit}` : String(value)) },
    });

    return (
      <div className="monitor-chart-card">
        <div className="monitor-chart-card__header">
          <span className="monitor-chart-card__title"><Activity size={14} />{title}</span>
          <Text type="tertiary" size="small">最近 1 小时（10 秒/点）</Text>
        </div>
        <div style={{ width: '100%', height: 220 }}>
          <LineChart {...trendSpec} options={chartOptions} height={220} />
        </div>
      </div>
    );
  }

  function renderHistoryChart(title: string, lines: { dataKey: keyof HistoryPoint; label: string; color: string }[], opts?: { unit?: string; bytes?: boolean }) {
    const axis = opts?.bytes
      ? { yLabel: (value: number) => formatBytes(value) }
      : opts?.unit
        ? { yLabel: (value: number) => `${value}${opts.unit}` }
        : undefined;
    const tooltip = opts?.bytes ? { value: (value: number) => `${formatBytes(Number(value))}/s` } : undefined;
    const historySpec = makeLineSpec({
      data: historyChartData,
      xField: 'time',
      series: lines.map((line) => ({ field: String(line.dataKey), name: line.label, color: line.color })),
      palette,
      ...(axis ? { axis } : {}),
      ...(tooltip ? { tooltip } : {}),
    });

    return (
      <div className="monitor-chart-card">
        <div className="monitor-chart-card__header">
          <span className="monitor-chart-card__title"><Activity size={14} />{title}</span>
        </div>
        <div style={{ width: '100%', height: 240 }}>
          <LineChart {...historySpec} options={chartOptions} height={240} />
        </div>
      </div>
    );
  }

  function renderHistoryTab() {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <Text type="tertiary" size="small">
            持久化历史趋势（每分钟采样落库），可用于容量规划与回溯分析
          </Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Select
              value={historyRange}
              onChange={(v) => setHistoryRange(v as string)}
              optionList={HISTORY_RANGES}
              style={{ width: 130 }}
              size="small"
            />
            <Button size="small" icon={<RefreshCw size={14} />} onClick={() => fetchHistory(historyRange)} loading={historyLoading}>刷新</Button>
          </div>
        </div>
        {history.length === 0 ? (
          <div style={{ padding: '48px 0', textAlign: 'center' }}>
            <Text type="tertiary">{historyLoading ? '加载中…' : '暂无历史数据（采样任务每分钟落库，请稍后再试）'}</Text>
          </div>
        ) : (
          <div className="monitor-history-grid">
            {renderHistoryChart('CPU / 内存 / 磁盘 / Swap 使用率', [
              { dataKey: 'cpu', label: 'CPU', color: '#3b82f6' },
              { dataKey: 'memory', label: '内存', color: '#22c55e' },
              { dataKey: 'disk', label: '磁盘', color: '#f59e0b' },
              { dataKey: 'swap', label: 'Swap', color: '#a855f7' },
            ], { unit: '%' })}
            {renderHistoryChart('系统负载 / 进程 CPU / 堆内存', [
              { dataKey: 'load1', label: '负载(1m)', color: '#ef4444' },
              { dataKey: 'procCpu', label: '进程CPU%', color: '#06b6d4' },
              { dataKey: 'heap', label: '堆内存%', color: '#8b5cf6' },
            ])}
            {renderHistoryChart('网络吞吐', [
              { dataKey: 'netRxBps', label: '下行', color: '#3b82f6' },
              { dataKey: 'netTxBps', label: '上行', color: '#f97316' },
            ], { bytes: true })}
            {renderHistoryChart('磁盘 IO', [
              { dataKey: 'diskReadBps', label: '读取', color: '#22c55e' },
              { dataKey: 'diskWriteBps', label: '写入', color: '#ef4444' },
            ], { bytes: true })}
            {renderHistoryChart('请求 QPS / 错误率', [
              { dataKey: 'qps', label: 'QPS', color: '#3b82f6' },
              { dataKey: 'errorRate', label: '错误率%', color: '#ef4444' },
            ])}
            {renderHistoryChart('事件循环延迟', [
              { dataKey: 'loopLag', label: '延迟(ms)', color: '#a855f7' },
            ], { unit: 'ms' })}
          </div>
        )}
      </div>
    );
  }

  function renderTopProcesses(tp?: TopProcesses | null) {
    if (!tp) return <Text type="tertiary">暂无进程数据</Text>;
    const cpuCols = [
      { title: '进程', dataIndex: 'name', render: (v: string, r: TopProcessItem) => <span><Text strong>{v}</Text> <Text type="tertiary" size="small">#{r.pid}</Text></span> },
      { title: 'CPU%', dataIndex: 'cpu', width: 90, align: 'right' as const, render: (v: number) => `${v}%` },
    ];
    const memCols = [
      { title: '进程', dataIndex: 'name', render: (v: string, r: TopProcessItem) => <span><Text strong>{v}</Text> <Text type="tertiary" size="small">#{r.pid}</Text></span> },
      { title: '内存', dataIndex: 'memBytes', width: 130, align: 'right' as const, render: (v: number, r: TopProcessItem) => `${formatBytes(v)} (${r.memPercent}%)` },
    ];
    return (
      <div className="monitor-topproc-grid">
        <div>
          <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 6 }}>CPU 占用 Top 5</Text>
          <Table size="small" pagination={false} dataSource={tp.byCpu} columns={cpuCols} rowKey="pid" />
        </div>
        <div>
          <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 6 }}>内存占用 Top 5</Text>
          <Table size="small" pagination={false} dataSource={tp.byMemory} columns={memCols} rowKey="pid" />
        </div>
      </div>
    );
  }

  function renderHttpTab(http?: HttpStats) {
    if (!http) return <Text type="tertiary">暂无 HTTP 统计</Text>;
    return (
      <>
        <Descriptions
          data={[
            { key: '瞬时 QPS（最近 1s）', value: formatNumber(http.currentQps) },
            { key: '平均 QPS（最近 60s）', value: http.qps.toFixed(2) },
            { key: '60s 内总请求', value: formatNumber(http.total) },
            { key: '60s 内错误数', value: formatNumber(http.errors) },
            { key: '错误率', value: `${http.errorRate}%` },
            { key: '累计 4xx / 5xx', value: `${formatNumber(http.total4xx)} / ${formatNumber(http.total5xx)}` },
            { key: 'P50 延迟', value: `${http.p50} ms` },
            { key: 'P95 延迟', value: `${http.p95} ms` },
            { key: 'P99 延迟', value: `${http.p99} ms` },
            { key: '峰值延迟', value: `${http.max} ms` },
          ]}
          column={2}
          layout="horizontal"
          align="left"
        />
        {renderTrendChart('QPS / 错误率', [
          { dataKey: 'qps', label: 'QPS', color: '#1677ff' },
          { dataKey: 'errorRate', label: '错误率(%)', color: '#ff4d4f' },
        ])}
      </>
    );
  }

  function renderSlowQueries(qs?: DbSlowQuery[] | null, available?: boolean) {
    if (!available || !qs) {
      return <Text type="tertiary" size="small">慢查询统计需启用 PostgreSQL <code>pg_stat_statements</code> 扩展</Text>;
    }
    if (qs.length === 0) return <Text type="tertiary" size="small">暂无慢查询样本</Text>;
    return (
      <table className="monitor-slow-table">
        <thead>
          <tr><th>SQL</th><th>调用次数</th><th>平均耗时</th><th>累计耗时</th></tr>
        </thead>
        <tbody>
          {qs.map((q, i) => (
            <tr key={`${q.query.slice(0, 32)}-${i}`}>
              <td className="monitor-slow-query">{q.query}</td>
              <td>{formatNumber(q.calls)}</td>
              <td>{q.meanMs.toFixed(2)} ms</td>
              <td>{q.totalMs.toFixed(2)} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderRedisSlowLog(items?: RedisSlowEntry[]) {
    if (!items || items.length === 0) return <Text type="tertiary" size="small">暂无慢日志</Text>;
    return (
      <table className="monitor-slow-table">
        <thead>
          <tr><th>时间</th><th>耗时</th><th>命令</th></tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>{formatDateTime(new Date(e.timestamp * 1000))}</td>
              <td>{e.durationMs.toFixed(2)} ms</td>
              <td className="monitor-slow-query">{e.command}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderDiskTab(d: MonitorData) {
    const io = d.diskIo ? (
      <div className="monitor-diskio-row">
        <div className="monitor-diskio-item"><Text type="tertiary" size="small">磁盘读取</Text><Text strong>{formatBytes(d.diskIo.readBps)}/s</Text></div>
        <div className="monitor-diskio-item"><Text type="tertiary" size="small">磁盘写入</Text><Text strong>{formatBytes(d.diskIo.writeBps)}/s</Text></div>
      </div>
    ) : null;
    if (d.disks && d.disks.length > 0) {
      return (
        <>
        {io}
        <table className="monitor-slow-table monitor-disk-table">
          <thead>
            <tr>
              <th>文件系统</th><th>挂载点</th><th>总容量</th><th>已用</th><th>可用</th><th>使用率</th>
            </tr>
          </thead>
          <tbody>
            {d.disks.map((it) => (
              <tr key={`${it.filesystem}-${it.mount}`}>
                <td className="monitor-disk-fs">{it.filesystem}</td>
                <td>{it.mount}</td>
                <td>{formatBytes(it.total)}</td>
                <td>{formatBytes(it.used)}</td>
                <td>{formatBytes(it.free)}</td>
                <td style={{ minWidth: 140 }}>
                  <div className={getProgressClass(it.usagePercent)}>
                    <Progress percent={it.usagePercent} showInfo />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      );
    }
    if (d.disk) {
      return (
        <>
        {io}
        <Descriptions
          data={[
            { key: '挂载点', value: d.disk.mount ?? '/' },
            { key: '总容量', value: formatBytes(d.disk.total) },
            { key: '已使用', value: formatBytes(d.disk.used) },
            { key: '可用空间', value: formatBytes(d.disk.free) },
            { key: '使用率', value: `${d.disk.usagePercent}%` },
          ]}
          column={2}
          layout="horizontal"
          align="left"
        />
        </>
      );
    }
    return <Text type="tertiary">磁盘信息不可用</Text>;
  }

  function renderContent() {
    if (loading && !data) return renderSkeleton();
    if (!data) {
      return <div className="monitor-loading"><Text type="tertiary">暂无数据</Text></div>;
    }
    const heapPercent = data.node.memoryUsage.heapTotal > 0
      ? Math.round((data.node.memoryUsage.heapUsed / data.node.memoryUsage.heapTotal) * 100)
      : 0;

    return (
      <Tabs type="line" activeKey={activeTab} onChange={setActiveTab}>
          {/* ===== 总览 ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Server size={14} />总览</span>} itemKey="overview">
            <div className="monitor-overview-grid">
              <div className="monitor-overview-metric">
                <div className="monitor-overview-metric__header"><Cpu size={15} /><Text strong>CPU</Text></div>
                <div className={`monitor-overview-metric__value ${getProgressClass(data.cpu.usage)}`}>{data.cpu.usage}%</div>
                <div className={getProgressClass(data.cpu.usage)}><Progress percent={data.cpu.usage} showInfo={false} /></div>
                <div className="monitor-overview-metric__info">
                  <Text type="tertiary" size="small">{data.cpu.cores} 核 · {data.cpu.speed} MHz</Text>
                  <Text type="tertiary" size="small">负载 {data.cpu.loadAvg.map((v) => v.toFixed(2)).join(' / ')}</Text>
                </div>
              </div>
              <div className="monitor-overview-metric">
                <div className="monitor-overview-metric__header"><MemoryStick size={15} /><Text strong>内存</Text></div>
                <div className={`monitor-overview-metric__value ${getProgressClass(data.memory.usagePercent)}`}>{data.memory.usagePercent}%</div>
                <div className={getProgressClass(data.memory.usagePercent)}><Progress percent={data.memory.usagePercent} showInfo={false} /></div>
                <div className="monitor-overview-metric__info">
                  <Text type="tertiary" size="small">已用 {formatBytes(data.memory.used)}</Text>
                  <Text type="tertiary" size="small">共 {formatBytes(data.memory.total)}</Text>
                </div>
              </div>
              <div className="monitor-overview-metric">
                <div className="monitor-overview-metric__header"><HardDrive size={15} /><Text strong>磁盘</Text></div>
                {data.disk ? (<>
                  <div className={`monitor-overview-metric__value ${getProgressClass(data.disk.usagePercent)}`}>{data.disk.usagePercent}%</div>
                  <div className={getProgressClass(data.disk.usagePercent)}><Progress percent={data.disk.usagePercent} showInfo={false} /></div>
                  <div className="monitor-overview-metric__info">
                    <Text type="tertiary" size="small">已用 {formatBytes(data.disk.used)}</Text>
                    <Text type="tertiary" size="small">共 {formatBytes(data.disk.total)}</Text>
                  </div>
                </>) : <Text type="tertiary" size="small">不可用</Text>}
              </div>
              <div className="monitor-overview-metric">
                <div className="monitor-overview-metric__header"><Server size={15} /><Text strong>Node 堆内存</Text></div>
                <div className={`monitor-overview-metric__value ${getProgressClass(heapPercent)}`}>{heapPercent}%</div>
                <div className={getProgressClass(heapPercent)}><Progress percent={heapPercent} showInfo={false} /></div>
                <div className="monitor-overview-metric__info">
                  <Text type="tertiary" size="small">已用 {formatBytes(data.node.memoryUsage.heapUsed)}</Text>
                  <Text type="tertiary" size="small">共 {formatBytes(data.node.memoryUsage.heapTotal)}</Text>
                </div>
              </div>
            </div>

            {chartData.length > 1 && renderTrendChart('CPU / 内存 / 堆内存', [
              { dataKey: 'cpu', label: '系统CPU(%)', color: '#1677ff' },
              { dataKey: 'mem', label: '内存(%)', color: '#52c41a' },
              { dataKey: 'heap', label: 'Node堆(%)', color: '#722ed1' },
              { dataKey: 'procCpu', label: '进程CPU(%)', color: '#fa8c16' },
            ], '%')}

            {chartData.length > 1 && renderTrendChart('Event Loop 延迟', [
              { dataKey: 'loopLagMean', label: '均值(ms)', color: '#13c2c2' },
              { dataKey: 'loopLagP99', label: 'P99(ms)', color: '#eb2f96' },
            ], 'ms')}

            <div className="monitor-overview-sys">
              <Descriptions
                data={[
                  { key: '主机名', value: data.os.hostname },
                  { key: 'Node 版本', value: data.node.version },
                  { key: '操作系统', value: `${data.os.platform} ${data.os.release} (${data.os.arch})`, span: 2 },
                  { key: '系统运行时长', value: formatUptime(data.os.uptimeSeconds) },
                  { key: '进程运行时长', value: formatUptime(data.node.uptime) },
                  { key: '进程 PID', value: String(data.node.pid), span: 2 },
                ]}
                column={2}
                layout="horizontal"
                align="left"
              />
            </div>

            {data.topProcesses && (<>
              <div className="monitor-section-title"><ListTree size={14} style={{ marginRight: 4, verticalAlign: '-2px' }} />资源占用 Top 进程</div>
              {renderTopProcesses(data.topProcesses)}
            </>)}
          </TabPane>

          {/* ===== 历史趋势 ===== */}
          <TabPane tab={<span className="monitor-tab-label"><History size={14} />历史趋势</span>} itemKey="history">
            {renderHistoryTab()}
          </TabPane>

          {/* ===== CPU ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Cpu size={14} />CPU</span>} itemKey="cpu">
            <Descriptions
              data={[
                { key: '处理器型号', value: data.cpu.model, span: 2 },
                { key: '核心数量', value: `${data.cpu.cores} 核` },
                { key: '主频', value: `${data.cpu.speed} MHz` },
                { key: '系统 CPU 使用率', value: `${data.cpu.usage}%` },
                { key: '进程 CPU 使用率', value: data.node.cpuUsagePercent === undefined ? '—' : `${data.node.cpuUsagePercent}%（单核满载=100%）` },
                { key: '系统负载 (1/5/15min)', value: data.cpu.loadAvg.map((v) => v.toFixed(2)).join(' / '), span: 2 },
              ]}
              column={2}
              layout="horizontal"
              align="left"
            />

            {data.cpu.perCore && data.cpu.perCore.length > 0 && (<>
              <div className="monitor-section-title">每核使用率</div>
              <div className="monitor-percore-grid">
                {data.cpu.perCore.map((core) => (
                  <div key={core.index} className="monitor-percore-item">
                    <div className="monitor-percore-item__head">
                      <Text strong size="small">CPU{core.index}</Text>
                      <Text type="tertiary" size="small">{core.usage}%</Text>
                    </div>
                    <div className={getProgressClass(core.usage)}>
                      <Progress percent={core.usage} showInfo={false} stroke="var(--semi-color-primary)" />
                    </div>
                    <div className="monitor-percore-item__legend">
                      <span><i style={{ background: 'var(--semi-color-primary)' }} />user {core.user}%</span>
                      <span><i style={{ background: 'var(--semi-color-warning)' }} />sys {core.system}%</span>
                      <span><i style={{ background: 'var(--semi-color-text-3)' }} />idle {core.idle}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </>)}

            {data.temperature && (data.temperature.cpu !== null || data.temperature.sensors.length > 0) && (<>
              <div className="monitor-section-title"><Thermometer size={14} style={{ marginRight: 4, verticalAlign: '-2px' }} />温度传感器</div>
              <Descriptions
                data={[
                  ...(data.temperature.cpu !== null ? [{ key: 'CPU 温度', value: `${data.temperature.cpu} °C` }] : []),
                  ...data.temperature.sensors.slice(0, 7).map((s) => ({ key: s.label, value: `${s.celsius} °C` })),
                ]}
                column={2}
                layout="horizontal"
                align="left"
              />
            </>)}

            {chartData.length > 1 && renderTrendChart('CPU 使用率趋势', [
              { dataKey: 'cpu', label: '系统 CPU(%)', color: '#1677ff' },
              { dataKey: 'procCpu', label: '进程 CPU(%)', color: '#fa8c16' },
            ], '%')}
          </TabPane>

          {/* ===== 内存 ===== */}
          <TabPane tab={<span className="monitor-tab-label"><MemoryStick size={14} />内存</span>} itemKey="mem">
            <Descriptions
              data={[
                { key: '总内存', value: formatBytes(data.memory.total) },
                { key: '已使用', value: formatBytes(data.memory.used) },
                { key: '可用内存', value: formatBytes(data.memory.free) },
                { key: '使用率', value: `${data.memory.usagePercent}%` },
              ]}
              column={2}
              layout="horizontal"
              align="left"
            />

            {data.memory.detail && (<>
              <div className="monitor-section-title">Linux 内存明细</div>
              <Descriptions
                data={[
                  { key: 'MemAvailable', value: formatBytes(data.memory.detail.memAvailable) },
                  { key: 'Buffers', value: formatBytes(data.memory.detail.buffers) },
                  { key: 'Cached', value: formatBytes(data.memory.detail.cached) },
                  { key: 'Shared', value: formatBytes(data.memory.detail.shared) },
                  { key: 'Dirty', value: formatBytes(data.memory.detail.dirty) },
                  { key: 'Writeback', value: formatBytes(data.memory.detail.writeback) },
                ]}
                column={2}
                layout="horizontal"
                align="left"
              />
              <div className="monitor-section-title">Swap</div>
              {data.memory.detail.swapTotal > 0 ? (
                <Descriptions
                  data={[
                    { key: '总容量', value: formatBytes(data.memory.detail.swapTotal) },
                    { key: '已使用', value: formatBytes(data.memory.detail.swapTotal - data.memory.detail.swapFree) },
                    { key: '可用', value: formatBytes(data.memory.detail.swapFree) },
                    { key: '使用率', value: `${data.memory.detail.swapUsagePercent}%` },
                    { key: 'SwapCached', value: formatBytes(data.memory.detail.swapCached) },
                  ]}
                  column={2}
                  layout="horizontal"
                  align="left"
                />
              ) : <Text type="tertiary" size="small">未启用 Swap</Text>}
            </>)}

            {chartData.length > 1 && renderTrendChart('内存使用率趋势', [
              { dataKey: 'mem', label: '系统内存(%)', color: '#52c41a' },
              { dataKey: 'heap', label: 'Node 堆(%)', color: '#722ed1' },
            ], '%')}
          </TabPane>

          {/* ===== 磁盘 ===== */}
          <TabPane tab={<span className="monitor-tab-label"><HardDrive size={14} />磁盘</span>} itemKey="disk">
            {renderDiskTab(data)}
          </TabPane>

          {/* ===== 网络 ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Wifi size={14} />网络</span>} itemKey="net">
            {data.network && data.network.length > 0 ? (<>
              <table className="monitor-slow-table">
                <thead>
                  <tr>
                    <th>接口</th><th>下行</th><th>上行</th>
                    <th>已接收</th><th>已发送</th>
                    <th>包 (rx/tx)</th><th>错误 (rx/tx)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.network.map((n) => (
                    <tr key={n.name}>
                      <td><Text strong>{n.name}</Text></td>
                      <td>{formatBitrate(n.rxBps)}</td>
                      <td>{formatBitrate(n.txBps)}</td>
                      <td>{formatBytes(n.rxBytes)}</td>
                      <td>{formatBytes(n.txBytes)}</td>
                      <td>{formatNumber(n.rxPackets)} / {formatNumber(n.txPackets)}</td>
                      <td>{formatNumber(n.rxErrors)} / {formatNumber(n.txErrors)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {chartData.length > 1 && renderTrendChart('网络吞吐（汇总）', [
                { dataKey: 'netRxBps', label: '下行 (B/s)', color: '#1677ff' },
                { dataKey: 'netTxBps', label: '上行 (B/s)', color: '#fa8c16' },
              ])}
            </>) : <Text type="tertiary">仅 Linux 平台提供详细网络指标</Text>}
          </TabPane>

          {/* ===== Node.js ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Server size={14} />Node.js</span>} itemKey="node">
            <Descriptions
              data={[
                { key: '进程 PID', value: String(data.node.pid) },
                { key: 'Node 版本', value: data.node.version },
                { key: '进程运行时长', value: formatUptime(data.node.uptime) },
                { key: '堆内存使用率', value: `${heapPercent}%` },
                { key: 'RSS 内存', value: formatBytes(data.node.memoryUsage.rss) },
                { key: '堆内存总量', value: formatBytes(data.node.memoryUsage.heapTotal) },
                { key: '堆内存已用', value: formatBytes(data.node.memoryUsage.heapUsed) },
                { key: 'external', value: formatBytes(data.node.memoryUsage.external) },
                { key: '进程 CPU%', value: data.node.cpuUsagePercent === undefined ? '—' : `${data.node.cpuUsagePercent}%` },
              ]}
              column={2}
              layout="horizontal"
              align="left"
            />

            {data.node.eventLoop && (<>
              <div className="monitor-section-title">Event Loop 延迟</div>
              <Descriptions
                data={[
                  { key: '均值', value: `${data.node.eventLoop.meanMs} ms` },
                  { key: 'P50', value: `${data.node.eventLoop.p50Ms} ms` },
                  { key: 'P95', value: `${data.node.eventLoop.p95Ms} ms` },
                  { key: 'P99', value: `${data.node.eventLoop.p99Ms} ms` },
                  { key: '最大值', value: `${data.node.eventLoop.maxMs} ms` },
                  { key: '标准差', value: `${data.node.eventLoop.stddevMs} ms` },
                ]}
                column={2}
                layout="horizontal"
                align="left"
              />
            </>)}

            {data.node.gc && (<>
              <div className="monitor-section-title">垃圾回收（GC）</div>
              <Descriptions
                data={[
                  { key: '累计次数', value: formatNumber(data.node.gc.totalCount) },
                  { key: '累计耗时', value: `${data.node.gc.totalDurationMs.toFixed(2)} ms` },
                  ...Object.entries(data.node.gc.byKind).map(([kind, v]) => ({
                    key: kind,
                    value: `${formatNumber(v.count)} 次 / ${v.durationMs.toFixed(2)} ms`,
                  })),
                ]}
                column={2}
                layout="horizontal"
                align="left"
              />
            </>)}

            {data.node.heapSpaces && data.node.heapSpaces.length > 0 && (<>
              <div className="monitor-section-title">V8 堆空间</div>
              <table className="monitor-slow-table">
                <thead><tr><th>空间</th><th>已用</th><th>容量</th><th>可用</th></tr></thead>
                <tbody>
                  {data.node.heapSpaces.map((s) => (
                    <tr key={s.name}>
                      <td>{s.name}</td>
                      <td>{formatBytes(s.used)}</td>
                      <td>{formatBytes(s.size)}</td>
                      <td>{formatBytes(s.available)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>)}

            {data.node.resourceUsage && (<>
              <div className="monitor-section-title">资源使用</div>
              <Descriptions
                data={[
                  { key: '用户态 CPU 时间', value: `${(data.node.resourceUsage.userCPUMicros / 1000).toFixed(0)} ms` },
                  { key: '内核态 CPU 时间', value: `${(data.node.resourceUsage.systemCPUMicros / 1000).toFixed(0)} ms` },
                  { key: '峰值 RSS', value: formatBytes(data.node.resourceUsage.maxRssBytes) },
                  { key: '文件读 / 写', value: `${formatNumber(data.node.resourceUsage.fsRead)} / ${formatNumber(data.node.resourceUsage.fsWrite)}` },
                  { key: '主动上下文切换', value: formatNumber(data.node.resourceUsage.voluntaryContextSwitches) },
                  { key: '被动上下文切换', value: formatNumber(data.node.resourceUsage.involuntaryContextSwitches) },
                ]}
                column={2}
                layout="horizontal"
                align="left"
              />
            </>)}
          </TabPane>

          {/* ===== HTTP ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Network size={14} />HTTP</span>} itemKey="http">
            {renderHttpTab(data.http)}
          </TabPane>

          {/* ===== 数据库 ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Database size={14} />数据库</span>} itemKey="db">
            {data.database ? (<>
              <Descriptions
                data={[
                  { key: '数据库名称', value: data.database.name },
                  { key: '数据库大小', value: formatBytes(data.database.size) },
                  { key: '数据表数量', value: `${data.database.tableCount} 张` },
                  { key: '总连接数', value: String(data.database.totalConnections) },
                  ...(data.database.connectionStates ? [
                    { key: '活跃连接 (active)', value: String(data.database.connectionStates.active) },
                    { key: '空闲连接 (idle)', value: String(data.database.connectionStates.idle) },
                    { key: '事务中空闲', value: String(data.database.connectionStates.idleInTransaction) },
                    { key: '其他状态', value: String(data.database.connectionStates.other) },
                  ] : []),
                  ...(data.database.cacheHit ? [
                    { key: '缓存命中率', value: `${data.database.cacheHit.ratio}% (${formatNumber(data.database.cacheHit.blksHit)} / ${formatNumber(data.database.cacheHit.blksHit + data.database.cacheHit.blksRead)})`, span: 2 },
                  ] : []),
                  ...(data.database.transactions ? [
                    { key: '提交事务', value: formatNumber(data.database.transactions.commit) },
                    { key: '回滚事务', value: formatNumber(data.database.transactions.rollback) },
                    { key: '死锁次数', value: formatNumber(data.database.transactions.deadlocks) },
                    { key: '临时文件字节', value: formatBytes(data.database.transactions.tempBytes) },
                  ] : []),
                ]}
                column={2}
                layout="horizontal"
                align="left"
              />
              <div className="monitor-section-title">慢查询 Top 5</div>
              {renderSlowQueries(data.database.slowQueries, data.database.slowQueriesAvailable)}
            </>) : <Text type="tertiary">数据库信息不可用</Text>}
          </TabPane>

          {/* ===== Redis ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Layers size={14} />Redis</span>} itemKey="redis">
            {data.redis ? (() => {
              const r = data.redis!;
              const hitTotal = r.keyspaceHits + r.keyspaceMisses;
              const hitRate = hitTotal > 0 ? `${((r.keyspaceHits / hitTotal) * 100).toFixed(1)}%` : 'N/A';
              return (
                <>
                  {/* 基本信息 */}
                  <div className="monitor-section-title">基本信息</div>
                  <Descriptions
                    data={[
                      { key: '版本', value: r.version },
                      { key: '角色', value: r.role },
                      { key: '运行时长', value: formatUptime(r.uptimeSeconds), span: 2 },
                    ]}
                    column={2}
                    layout="horizontal"
                    align="left"
                  />

                  {/* 内存 */}
                  <div className="monitor-section-title">内存</div>
                  <Descriptions
                    data={[
                      { key: '已用内存', value: r.usedMemoryHuman },
                      ...(r.usedMemoryRss === undefined ? [] : [{ key: 'RSS 内存', value: formatBytes(r.usedMemoryRss) }]),
                      ...(r.memFragmentationRatio === undefined ? [] : [{ key: '碎片率', value: r.memFragmentationRatio.toFixed(2) }]),
                      ...(r.maxMemory === undefined ? [] : [{ key: '最大内存', value: r.maxMemory > 0 ? formatBytes(r.maxMemory) : '不限' }]),
                      ...(r.maxMemoryPolicy ? [{ key: '淘汰策略', value: r.maxMemoryPolicy }] : []),
                    ]}
                    column={2}
                    layout="horizontal"
                    align="left"
                  />

                  {/* 客户端 */}
                  <div className="monitor-section-title">客户端</div>
                  <Descriptions
                    data={[
                      { key: '已连接客户端', value: String(r.connectedClients) },
                      ...(r.blockedClients === undefined ? [] : [{ key: '阻塞客户端', value: String(r.blockedClients) }]),
                      ...(r.rejectedConnections === undefined ? [] : [{ key: '拒绝连接数', value: formatNumber(r.rejectedConnections) }]),
                    ]}
                    column={2}
                    layout="horizontal"
                    align="left"
                  />

                  {/* 命令统计 */}
                  <div className="monitor-section-title">命令统计</div>
                  <Descriptions
                    data={[
                      { key: 'Key 总数', value: String(r.keyCount) },
                      { key: '命令总执行数', value: formatNumber(r.totalCommandsProcessed) },
                      { key: '命中率', value: hitRate },
                    ]}
                    column={2}
                    layout="horizontal"
                    align="left"
                  />

                  {/* 持久化 */}
                  {(r.aofEnabled !== undefined ||
                    (r.rdbLastSaveTime !== undefined && r.rdbLastSaveTime > 0) ||
                    r.rdbChangesSinceLastSave !== undefined ||
                    r.masterLinkStatus) && (
                    <>
                      <div className="monitor-section-title">持久化</div>
                      <Descriptions
                        data={[
                          ...(r.aofEnabled === undefined ? [] : [{ key: 'AOF', value: r.aofEnabled ? '已启用' : '未启用' }]),
                          ...(r.rdbLastSaveTime !== undefined && r.rdbLastSaveTime > 0
                            ? [{ key: 'RDB 最近保存', value: formatDateTime(new Date(r.rdbLastSaveTime * 1000)) }]
                            : []),
                          ...(r.rdbChangesSinceLastSave === undefined ? [] : [{ key: '距上次保存变更', value: formatNumber(r.rdbChangesSinceLastSave) }]),
                          ...(r.masterLinkStatus ? [{ key: '主从链路', value: r.masterLinkStatus }] : []),
                        ]}
                        column={2}
                        layout="horizontal"
                        align="left"
                      />
                    </>
                  )}

                  <div className="monitor-section-title">慢日志（最近 10 条）</div>
                  {renderRedisSlowLog(r.slowLog)}
                </>
              );
            })() : <Text type="tertiary">Redis 信息不可用</Text>}
          </TabPane>

          <TabPane tab={<span className="monitor-tab-label"><Activity size={14} />WebSocket</span>} itemKey="ws">
            {wsMetrics ? (<>
              <Descriptions
                data={[
                  { key: '当前连接数', value: formatNumber(wsMetrics.currentConnections) },
                  { key: '在线用户数', value: formatNumber(wsMetrics.currentUsers) },
                  { key: '累计连接', value: formatNumber(wsMetrics.totalConnects) },
                  { key: '累计断开', value: formatNumber(wsMetrics.totalDisconnects) },
                  { key: '累计发送消息', value: formatNumber(wsMetrics.totalSent) },
                  { key: '累计接收消息', value: formatNumber(wsMetrics.totalRecv) },
                ]}
                column={2}
                layout="horizontal"
                align="left"
              />
              <div className="monitor-section-title">当前在线连接（{wsMetrics.connections.length}）</div>
              <Table
                size="small"
                bordered
                dataSource={wsMetrics.connections}
                rowKey="tokenId"
                pagination={wsMetrics.connections.length > 10 ? { pageSize: 10 } : false}
                empty={<Text type="tertiary">暂无在线连接</Text>}
                columns={[
                  {
                    title: '用户',
                    dataIndex: 'userId',
                    render: (_: unknown, r: WsConnection) => (
                      <span>{r.nickname || r.username || '-'} <Text type="tertiary" size="small">#{r.userId}</Text></span>
                    ),
                  },
                  { title: 'Token', dataIndex: 'tokenId', render: (v: string) => <Text type="tertiary" size="small">{v.slice(0, 8)}…</Text> },
                  { title: '建立时间', dataIndex: 'connectedAt', render: (v: number) => formatDateTime(new Date(v)) },
                  { title: '最近活动', dataIndex: 'lastActivityAt', render: (v: number) => formatDateTime(new Date(v)) },
                  { title: '已持续', dataIndex: 'connectedAt', key: 'duration', render: (v: number) => formatDuration(Date.now() - v) },
                  { title: '发送', dataIndex: 'sent', align: 'right' as const, render: (v: number) => formatNumber(v) },
                  { title: '接收', dataIndex: 'recv', align: 'right' as const, render: (v: number) => formatNumber(v) },
                ]}
              />
              <div className="monitor-section-title">最近断开（最多 50 条）</div>
              <Table
                size="small"
                bordered
                dataSource={wsMetrics.recentDisconnects}
                rowKey={(r) => (r ? `${r.tokenId}-${r.at}` : '')}
                pagination={wsMetrics.recentDisconnects.length > 10 ? { pageSize: 10 } : false}
                empty={<Text type="tertiary">暂无断开记录</Text>}
                columns={[
                  {
                    title: '用户',
                    dataIndex: 'userId',
                    render: (_: unknown, r: WsDisconnect) => (
                      <span>{r.nickname || r.username || '-'} <Text type="tertiary" size="small">#{r.userId}</Text></span>
                    ),
                  },
                  { title: '断开时间', dataIndex: 'at', render: (v: number) => formatDateTime(new Date(v)) },
                  { title: '原因', dataIndex: 'reason', render: (v: string) => <Tag size="small">{v || '-'}</Tag> },
                  { title: '持续时长', dataIndex: 'duration', render: (v: number) => formatDuration(v) },
                  { title: '发送', dataIndex: 'sent', align: 'right' as const, render: (v: number) => formatNumber(v) },
                  { title: '接收', dataIndex: 'recv', align: 'right' as const, render: (v: number) => formatNumber(v) },
                ]}
              />
            </>) : <Text type="tertiary">WebSocket 监控数据不可用</Text>}
          </TabPane>
      </Tabs>
    );
  }

  return (
    <div className="monitor-page">
      <div className="responsive-toolbar monitor-header">
        <div className="monitor-header__actions">
          {refreshInterval === -1 && (
            <Tag
              size="small"
              color={SSE_STATUS_META[sseStatus].color}
              className="monitor-sse-tag"
            >
              <span className={`monitor-sse-dot monitor-sse-dot--${sseStatus}`} />
              {SSE_STATUS_META[sseStatus].text}
            </Tag>
          )}
          {lastUpdated && (
            <Text type="tertiary" size="small">最后更新：{formatDateTime(lastUpdated)}</Text>
          )}
          <Select
            value={refreshInterval}
            onChange={(v) => setRefreshInterval(Number(v))}
            optionList={REFRESH_OPTIONS}
            style={{ width: 110 }}
            size="small"
          />
          <Button
            icon={<RefreshCw size={14} />}
            onClick={fetchData}
            loading={loading}
            theme="light"
          >
            刷新
          </Button>
        </div>
      </div>
      {renderContent()}
    </div>
  );
}
