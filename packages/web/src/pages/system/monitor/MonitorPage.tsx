import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Progress, Skeleton, Tag, Tabs, TabPane, Toast, Typography } from '@douyinfe/semi-ui';
import { RefreshCw, Cpu, HardDrive, Database, Server, MemoryStick, Layers } from 'lucide-react';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import './MonitorPage.css';

const { Text } = Typography;

interface MonitorData {
  os: {
    platform: string;
    release: string;
    arch: string;
    hostname: string;
    uptimeSeconds: number;
  };
  cpu: {
    model: string;
    cores: number;
    speed: number;
    loadAvg: [number, number, number];
    usage: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  } | null;
  node: {
    version: string;
    uptime: number;
    pid: number;
    memoryUsage: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
  };
  database: {
    name: string;
    size: number;
    activeConnections: number;
    totalConnections: number;
    tableCount: number;
  } | null;
  redis: {
    version: string;
    uptimeSeconds: number;
    connectedClients: number;
    usedMemory: number;
    usedMemoryHuman: string;
    totalCommandsProcessed: number;
    keyspaceHits: number;
    keyspaceMisses: number;
    keyCount: number;
    role: string;
  } | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

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

interface InfoRowProps {
  readonly label: string;
  readonly value: React.ReactNode;
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="monitor-info-row">
      <Text type="tertiary" className="monitor-info-label">{label}</Text>
      <Text className="monitor-info-value">{value}</Text>
    </div>
  );
}

const SKELETON_ROW_KEYS = ['r0','r1','r2','r3','r4','r5','r6','r7','r8','r9','r10','r11'] as const;

export default function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<MonitorData>('/api/monitor', { silent: true });
      if (res.code === 0 && res.data) {
        setData(res.data);
        setLastUpdated(new Date());
      } else {
        Toast.error('获取监控数据失败');
      }
    } catch {
      Toast.error('网络请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 30000);
    return () => clearInterval(timer);
  }, [fetchData]);

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

  function renderContent() {
    if (loading && !data) {
      return renderSkeleton();
    }
    if (!data) {
      return (
        <div className="monitor-loading">
          <Text type="tertiary">暂无数据</Text>
        </div>
      );
    }
    const heapPercent = Math.round(
      (data.node.memoryUsage.heapUsed / data.node.memoryUsage.heapTotal) * 100,
    );

    return (
      <Card className="monitor-tab-card">
        <Tabs type="line">
          {/* ===== 总览 ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Server size={14} />总览</span>} itemKey="overview">
            <div className="monitor-overview-grid">
              {/* CPU */}
              <div className="monitor-overview-metric">
                <div className="monitor-overview-metric__header">
                  <Cpu size={15} />
                  <Text strong>CPU</Text>
                </div>
                <div className={`monitor-overview-metric__value ${getProgressClass(data.cpu.usage)}`}>
                  {data.cpu.usage}%
                </div>
                <div className={getProgressClass(data.cpu.usage)}>
                  <Progress percent={data.cpu.usage} showInfo={false} />
                </div>
                <div className="monitor-overview-metric__info">
                  <Text type="tertiary" size="small">{data.cpu.cores} 核 · {data.cpu.speed} MHz</Text>
                  <Text type="tertiary" size="small">负载 {data.cpu.loadAvg.map((v) => v.toFixed(2)).join(' / ')}</Text>
                </div>
              </div>

              {/* 内存 */}
              <div className="monitor-overview-metric">
                <div className="monitor-overview-metric__header">
                  <MemoryStick size={15} />
                  <Text strong>内存</Text>
                </div>
                <div className={`monitor-overview-metric__value ${getProgressClass(data.memory.usagePercent)}`}>
                  {data.memory.usagePercent}%
                </div>
                <div className={getProgressClass(data.memory.usagePercent)}>
                  <Progress percent={data.memory.usagePercent} showInfo={false} />
                </div>
                <div className="monitor-overview-metric__info">
                  <Text type="tertiary" size="small">已用 {formatBytes(data.memory.used)}</Text>
                  <Text type="tertiary" size="small">共 {formatBytes(data.memory.total)}</Text>
                </div>
              </div>

              {/* 磁盘 */}
              <div className="monitor-overview-metric">
                <div className="monitor-overview-metric__header">
                  <HardDrive size={15} />
                  <Text strong>磁盘</Text>
                </div>
                {data.disk ? (
                  <>
                    <div className={`monitor-overview-metric__value ${getProgressClass(data.disk.usagePercent)}`}>
                      {data.disk.usagePercent}%
                    </div>
                    <div className={getProgressClass(data.disk.usagePercent)}>
                      <Progress percent={data.disk.usagePercent} showInfo={false} />
                    </div>
                    <div className="monitor-overview-metric__info">
                      <Text type="tertiary" size="small">已用 {formatBytes(data.disk.used)}</Text>
                      <Text type="tertiary" size="small">共 {formatBytes(data.disk.total)}</Text>
                    </div>
                  </>
                ) : (
                  <Text type="tertiary" size="small">不可用</Text>
                )}
              </div>

              {/* Node 堆内存 */}
              <div className="monitor-overview-metric">
                <div className="monitor-overview-metric__header">
                  <Server size={15} />
                  <Text strong>Node 堆内存</Text>
                </div>
                <div className={`monitor-overview-metric__value ${getProgressClass(heapPercent)}`}>
                  {heapPercent}%
                </div>
                <div className={getProgressClass(heapPercent)}>
                  <Progress percent={heapPercent} showInfo={false} />
                </div>
                <div className="monitor-overview-metric__info">
                  <Text type="tertiary" size="small">已用 {formatBytes(data.node.memoryUsage.heapUsed)}</Text>
                  <Text type="tertiary" size="small">共 {formatBytes(data.node.memoryUsage.heapTotal)}</Text>
                </div>
              </div>
            </div>

            {/* 系统基本信息 */}
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
              <InfoRow label="CPU 使用率" value={`${data.cpu.usage}%`} />
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
                <InfoRow label="总容量" value={formatBytes(data.disk.total)} />
                <InfoRow label="已使用" value={formatBytes(data.disk.used)} />
                <InfoRow label="可用空间" value={formatBytes(data.disk.free)} />
                <InfoRow label="使用率" value={`${data.disk.usagePercent}%`} />
              </div>
            ) : (
              <Text type="tertiary">磁盘信息不可用</Text>
            )}
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
              <InfoRow label="进程状态" value={<Tag color="green" size="small">运行中</Tag>} />
            </div>
          </TabPane>

          {/* ===== 数据库 ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Database size={14} />数据库</span>} itemKey="db">
            {data.database ? (
              <div className="monitor-detail-grid">
                <InfoRow label="数据库名称" value={data.database.name} />
                <InfoRow label="数据库大小" value={formatBytes(data.database.size)} />
                <InfoRow label="数据表数量" value={`${data.database.tableCount} 张`} />
                <InfoRow label="活跃连接数" value={data.database.activeConnections} />
                <InfoRow label="总连接数" value={data.database.totalConnections} />
                <InfoRow label="数据库状态" value={<Tag color="green" size="small">运行中</Tag>} />
              </div>
            ) : (
              <Text type="tertiary">数据库信息不可用</Text>
            )}
          </TabPane>

          {/* ===== Redis ===== */}
          <TabPane tab={<span className="monitor-tab-label"><Layers size={14} />Redis</span>} itemKey="redis">
            {data.redis ? (
              <div className="monitor-detail-grid">
                <InfoRow label="版本" value={data.redis.version} />
                <InfoRow label="运行时长" value={formatUptime(data.redis.uptimeSeconds)} />
                <InfoRow label="角色" value={data.redis.role} />
                <InfoRow label="已用内存" value={`${data.redis.usedMemoryHuman} (${formatBytes(data.redis.usedMemory)})`} />
                <InfoRow label="已连接客户端" value={data.redis.connectedClients} />
                <InfoRow label="Key 总数" value={data.redis.keyCount} />
                <InfoRow label="命令总执行数" value={data.redis.totalCommandsProcessed.toLocaleString()} />
                <InfoRow
                  label="命中率"
                  value={(() => {
                    const total = data.redis.keyspaceHits + data.redis.keyspaceMisses;
                    return total > 0
                      ? `${((data.redis.keyspaceHits / total) * 100).toFixed(1)}%`
                      : 'N/A';
                  })()}
                />
                <InfoRow label="Redis 状态" value={<Tag color="green" size="small">运行中</Tag>} />
              </div>
            ) : (
              <Text type="tertiary">Redis 信息不可用</Text>
            )}
          </TabPane>
        </Tabs>
      </Card>
    );
  }

  return (
    <div className="monitor-page">
      <div className="responsive-toolbar monitor-header">
        <div className="responsive-toolbar__right monitor-header__actions">
          {lastUpdated && (
            <Text type="tertiary" size="small">
              最后更新：{formatDateTime(lastUpdated)}
            </Text>
          )}
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
