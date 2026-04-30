import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Progress, Skeleton, Tag, Tabs, TabPane, Toast, Typography, Select } from '@douyinfe/semi-ui';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { RefreshCw, Cpu, HardDrive, Database, Server, MemoryStick, Layers, Activity, Network } from 'lucide-react';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
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

interface MonitorData {
  os: { platform: string; release: string; arch: string; hostname: string; uptimeSeconds: number; };
  cpu: { model: string; cores: number; speed: number; loadAvg: [number, number, number]; usage: number; };
  memory: { total: number; used: number; free: number; usagePercent: number; };
  disk: { total: number; used: number; free: number; usagePercent: number; mount?: string } | null;
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
}
interface TimeseriesData { intervalSec: number; capacity: number; points: TimeseriesPoint[]; }

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

interface InfoRowProps { readonly label: string; readonly value: React.ReactNode; }
function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="monitor-info-row">
      <Text type="tertiary" className="monitor-info-label">{label}</Text>
      <Text className="monitor-info-value">{value}</Text>
    </div>
  );
}

const SKELETON_ROW_KEYS = ['r0','r1','r2','r3','r4','r5','r6','r7','r8','r9','r10','r11'] as const;

const REFRESH_OPTIONS = [
  { label: '5 秒', value: 5000 },
  { label: '10 秒', value: 10000 },
  { label: '30 秒', value: 30000 },
  { label: '60 秒', value: 60000 },
  { label: '暂停', value: 0 },
];

export default function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<number>(30000);

  const intervalRef = useRef<number>(refreshInterval);
  intervalRef.current = refreshInterval;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, tsRes] = await Promise.all([
        request.get<MonitorData>('/api/monitor', { silent: true }),
        request.get<TimeseriesData>('/api/monitor/timeseries', { silent: true }),
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
    } catch {
      Toast.error('网络请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (refreshInterval <= 0) return;
    const timer = globalThis.setInterval(fetchData, refreshInterval);
    return () => globalThis.clearInterval(timer);
  }, [fetchData, refreshInterval]);

  const chartData = useMemo(
    () => series.map((p) => ({ ...p, time: formatTimestamp(p.t) })),
    [series],
  );

  function renderSkeleton() {
    return (
      <Card className="monitor-tab-card">
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
      </Card>
    );
  }

  function renderTrendChart(title: string, lines: { dataKey: keyof TimeseriesPoint; label: string; color: string }[], unit?: string) {
    return (
      <div className="monitor-chart-card">
        <div className="monitor-chart-card__header">
          <span className="monitor-chart-card__title"><Activity size={14} />{title}</span>
          <Text type="tertiary" size="small">最近 1 小时（10 秒/点）</Text>
        </div>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={32} />
              <YAxis tick={{ fontSize: 11 }} unit={unit} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {lines.map((l) => (
                <Line
                  key={l.dataKey as string}
                  type="monotone"
                  dataKey={l.dataKey as string}
                  name={l.label}
                  stroke={l.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  function renderHttpTab(http?: HttpStats) {
    if (!http) return <Text type="tertiary">暂无 HTTP 统计</Text>;
    return (
      <>
        <div className="monitor-detail-grid">
          <InfoRow label="瞬时 QPS（最近 1s）" value={formatNumber(http.currentQps)} />
          <InfoRow label="平均 QPS（最近 60s）" value={http.qps.toFixed(2)} />
          <InfoRow label="60s 内总请求" value={formatNumber(http.total)} />
          <InfoRow label="60s 内错误数" value={formatNumber(http.errors)} />
          <InfoRow label="错误率" value={`${http.errorRate}%`} />
          <InfoRow label="累计 4xx / 5xx" value={`${formatNumber(http.total4xx)} / ${formatNumber(http.total5xx)}`} />
          <InfoRow label="P50 延迟" value={`${http.p50} ms`} />
          <InfoRow label="P95 延迟" value={`${http.p95} ms`} />
          <InfoRow label="P99 延迟" value={`${http.p99} ms`} />
          <InfoRow label="峰值延迟" value={`${http.max} ms`} />
        </div>
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

  function renderContent() {
    if (loading && !data) return renderSkeleton();
    if (!data) {
      return <div className="monitor-loading"><Text type="tertiary">暂无数据</Text></div>;
    }
    const heapPercent = data.node.memoryUsage.heapTotal > 0
      ? Math.round((data.node.memoryUsage.heapUsed / data.node.memoryUsage.heapTotal) * 100)
      : 0;

    return (
      <Card className="monitor-tab-card">
        <Tabs type="line">
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
              <InfoRow label="主机名" value={data.os.hostname} />
              <InfoRow label="操作系统" value={`${data.os.platform} ${data.os.release} (${data.os.arch})`} />
              <InfoRow label="系统运行时长" value={formatUptime(data.os.uptimeSeconds)} />
              <InfoRow label="Node 版本" value={data.node.version} />
              <InfoRow label="进程 PID" value={data.node.pid} />
              <InfoRow label="进程运行时长" value={formatUptime(data.node.uptime)} />
            </div>
          </TabPane>

          {/* ===== CPU ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Cpu size={14} />CPU</span>} itemKey="cpu">
            <div className="monitor-detail-grid">
              <InfoRow label="处理器型号" value={data.cpu.model} />
              <InfoRow label="核心数量" value={`${data.cpu.cores} 核`} />
              <InfoRow label="主频" value={`${data.cpu.speed} MHz`} />
              <InfoRow label="系统 CPU 使用率" value={`${data.cpu.usage}%`} />
              <InfoRow label="进程 CPU 使用率" value={data.node.cpuUsagePercent === undefined ? '—' : `${data.node.cpuUsagePercent}%（单核满载=100%）`} />
              <InfoRow label="系统负载 (1/5/15min)" value={data.cpu.loadAvg.map((v) => v.toFixed(2)).join(' / ')} />
            </div>
          </TabPane>

          {/* ===== 内存 ===== */}
          <TabPane tab={<span className="monitor-tab-label"><MemoryStick size={14} />内存</span>} itemKey="mem">
            <div className="monitor-detail-grid">
              <InfoRow label="总内存" value={formatBytes(data.memory.total)} />
              <InfoRow label="已使用" value={formatBytes(data.memory.used)} />
              <InfoRow label="可用内存" value={formatBytes(data.memory.free)} />
              <InfoRow label="使用率" value={`${data.memory.usagePercent}%`} />
            </div>
          </TabPane>

          {/* ===== 磁盘 ===== */}
          <TabPane tab={<span className="monitor-tab-label"><HardDrive size={14} />磁盘</span>} itemKey="disk">
            {data.disk ? (
              <div className="monitor-detail-grid">
                <InfoRow label="挂载点" value={data.disk.mount ?? '/'} />
                <InfoRow label="总容量" value={formatBytes(data.disk.total)} />
                <InfoRow label="已使用" value={formatBytes(data.disk.used)} />
                <InfoRow label="可用空间" value={formatBytes(data.disk.free)} />
                <InfoRow label="使用率" value={`${data.disk.usagePercent}%`} />
              </div>
            ) : <Text type="tertiary">磁盘信息不可用</Text>}
          </TabPane>

          {/* ===== Node.js ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Server size={14} />Node.js</span>} itemKey="node">
            <div className="monitor-detail-grid">
              <InfoRow label="进程 PID" value={data.node.pid} />
              <InfoRow label="Node 版本" value={data.node.version} />
              <InfoRow label="进程运行时长" value={formatUptime(data.node.uptime)} />
              <InfoRow label="堆内存使用率" value={`${heapPercent}%`} />
              <InfoRow label="RSS 内存" value={formatBytes(data.node.memoryUsage.rss)} />
              <InfoRow label="堆内存总量" value={formatBytes(data.node.memoryUsage.heapTotal)} />
              <InfoRow label="堆内存已用" value={formatBytes(data.node.memoryUsage.heapUsed)} />
              <InfoRow label="external" value={formatBytes(data.node.memoryUsage.external)} />
              <InfoRow label="进程 CPU%" value={data.node.cpuUsagePercent === undefined ? '—' : `${data.node.cpuUsagePercent}%`} />
              <InfoRow label="进程状态" value={<Tag color="green" size="small">运行中</Tag>} />
            </div>

            {data.node.eventLoop && (<>
              <div className="monitor-section-title">Event Loop 延迟</div>
              <div className="monitor-detail-grid">
                <InfoRow label="均值" value={`${data.node.eventLoop.meanMs} ms`} />
                <InfoRow label="P50" value={`${data.node.eventLoop.p50Ms} ms`} />
                <InfoRow label="P95" value={`${data.node.eventLoop.p95Ms} ms`} />
                <InfoRow label="P99" value={`${data.node.eventLoop.p99Ms} ms`} />
                <InfoRow label="最大值" value={`${data.node.eventLoop.maxMs} ms`} />
                <InfoRow label="标准差" value={`${data.node.eventLoop.stddevMs} ms`} />
              </div>
            </>)}

            {data.node.gc && (<>
              <div className="monitor-section-title">垃圾回收（GC）</div>
              <div className="monitor-detail-grid">
                <InfoRow label="累计次数" value={formatNumber(data.node.gc.totalCount)} />
                <InfoRow label="累计耗时" value={`${data.node.gc.totalDurationMs.toFixed(2)} ms`} />
                {Object.entries(data.node.gc.byKind).map(([kind, v]) => (
                  <InfoRow key={kind} label={`${kind}`} value={`${formatNumber(v.count)} 次 / ${v.durationMs.toFixed(2)} ms`} />
                ))}
              </div>
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
              <div className="monitor-detail-grid">
                <InfoRow label="用户态 CPU 时间" value={`${(data.node.resourceUsage.userCPUMicros / 1000).toFixed(0)} ms`} />
                <InfoRow label="内核态 CPU 时间" value={`${(data.node.resourceUsage.systemCPUMicros / 1000).toFixed(0)} ms`} />
                <InfoRow label="峰值 RSS" value={formatBytes(data.node.resourceUsage.maxRssBytes)} />
                <InfoRow label="文件读 / 写" value={`${formatNumber(data.node.resourceUsage.fsRead)} / ${formatNumber(data.node.resourceUsage.fsWrite)}`} />
                <InfoRow label="主动上下文切换" value={formatNumber(data.node.resourceUsage.voluntaryContextSwitches)} />
                <InfoRow label="被动上下文切换" value={formatNumber(data.node.resourceUsage.involuntaryContextSwitches)} />
              </div>
            </>)}
          </TabPane>

          {/* ===== HTTP ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Network size={14} />HTTP</span>} itemKey="http">
            {renderHttpTab(data.http)}
          </TabPane>

          {/* ===== 数据库 ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Database size={14} />数据库</span>} itemKey="db">
            {data.database ? (<>
              <div className="monitor-detail-grid">
                <InfoRow label="数据库名称" value={data.database.name} />
                <InfoRow label="数据库大小" value={formatBytes(data.database.size)} />
                <InfoRow label="数据表数量" value={`${data.database.tableCount} 张`} />
                <InfoRow label="总连接数" value={data.database.totalConnections} />
                {data.database.connectionStates && (<>
                  <InfoRow label="活跃连接 (active)" value={data.database.connectionStates.active} />
                  <InfoRow label="空闲连接 (idle)" value={data.database.connectionStates.idle} />
                  <InfoRow label="事务中空闲" value={data.database.connectionStates.idleInTransaction} />
                  <InfoRow label="其他状态" value={data.database.connectionStates.other} />
                </>)}
                {data.database.cacheHit && (
                  <InfoRow label="缓存命中率" value={`${data.database.cacheHit.ratio}% (${formatNumber(data.database.cacheHit.blksHit)} / ${formatNumber(data.database.cacheHit.blksHit + data.database.cacheHit.blksRead)})`} />
                )}
                {data.database.transactions && (<>
                  <InfoRow label="提交事务" value={formatNumber(data.database.transactions.commit)} />
                  <InfoRow label="回滚事务" value={formatNumber(data.database.transactions.rollback)} />
                  <InfoRow label="死锁次数" value={formatNumber(data.database.transactions.deadlocks)} />
                  <InfoRow label="临时文件字节" value={formatBytes(data.database.transactions.tempBytes)} />
                </>)}
              </div>
              <div className="monitor-section-title">慢查询 Top 5</div>
              {renderSlowQueries(data.database.slowQueries, data.database.slowQueriesAvailable)}
            </>) : <Text type="tertiary">数据库信息不可用</Text>}
          </TabPane>

          {/* ===== Redis ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Layers size={14} />Redis</span>} itemKey="redis">
            {data.redis ? (<>
              <div className="monitor-detail-grid">
                <InfoRow label="版本" value={data.redis.version} />
                <InfoRow label="角色" value={data.redis.role} />
                <InfoRow label="运行时长" value={formatUptime(data.redis.uptimeSeconds)} />
                <InfoRow label="已用内存" value={`${data.redis.usedMemoryHuman}`} />
                {data.redis.usedMemoryRss !== undefined && (
                  <InfoRow label="RSS 内存" value={formatBytes(data.redis.usedMemoryRss)} />
                )}
                {data.redis.memFragmentationRatio !== undefined && (
                  <InfoRow label="碎片率" value={data.redis.memFragmentationRatio.toFixed(2)} />
                )}
                {data.redis.maxMemory !== undefined && (
                  <InfoRow label="最大内存" value={data.redis.maxMemory > 0 ? formatBytes(data.redis.maxMemory) : '不限'} />
                )}
                {data.redis.maxMemoryPolicy && (
                  <InfoRow label="淘汰策略" value={data.redis.maxMemoryPolicy} />
                )}
                <InfoRow label="已连接客户端" value={data.redis.connectedClients} />
                {data.redis.blockedClients !== undefined && (
                  <InfoRow label="阻塞客户端" value={data.redis.blockedClients} />
                )}
                {data.redis.rejectedConnections !== undefined && (
                  <InfoRow label="拒绝连接数" value={formatNumber(data.redis.rejectedConnections)} />
                )}
                <InfoRow label="Key 总数" value={data.redis.keyCount} />
                <InfoRow label="命令总执行数" value={formatNumber(data.redis.totalCommandsProcessed)} />
                <InfoRow label="命中率" value={(() => {
                  const r = data.redis;
                  if (!r) return 'N/A';
                  const total = r.keyspaceHits + r.keyspaceMisses;
                  return total > 0 ? `${((r.keyspaceHits / total) * 100).toFixed(1)}%` : 'N/A';
                })()} />
                {data.redis.aofEnabled !== undefined && (
                  <InfoRow label="AOF" value={data.redis.aofEnabled ? '已启用' : '未启用'} />
                )}
                {data.redis.rdbLastSaveTime !== undefined && data.redis.rdbLastSaveTime > 0 && (
                  <InfoRow label="RDB 最近保存" value={formatDateTime(new Date(data.redis.rdbLastSaveTime * 1000))} />
                )}
                {data.redis.rdbChangesSinceLastSave !== undefined && (
                  <InfoRow label="距上次保存变更" value={formatNumber(data.redis.rdbChangesSinceLastSave)} />
                )}
                {data.redis.masterLinkStatus && (
                  <InfoRow label="主从链路" value={data.redis.masterLinkStatus} />
                )}
              </div>
              <div className="monitor-section-title">慢日志（最近 10 条）</div>
              {renderRedisSlowLog(data.redis.slowLog)}
            </>) : <Text type="tertiary">Redis 信息不可用</Text>}
          </TabPane>
        </Tabs>
      </Card>
    );
  }

  return (
    <div className="monitor-page">
      <div className="responsive-toolbar monitor-header">
        <div className="monitor-header__actions">
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
