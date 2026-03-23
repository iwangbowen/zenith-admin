import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Progress, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { RefreshCw, Cpu, HardDrive, Database, Server, MemoryStick } from 'lucide-react';
import { request } from '../../../utils/request';
import { formatDateTime } from '../../../utils/date';
import './MonitorPage.css';

const { Title, Text } = Typography;

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

export default function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<MonitorData>('/api/monitor');
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

  function renderContent() {
    if (loading && !data) {
      return (
        <div className="monitor-loading">
          <Spin size="large" />
        </div>
      );
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
      <div className="monitor-grid">
        <Card
          className="monitor-card"
          title={
            <div className="monitor-card-title">
              <Server size={16} />
              <span>系统信息</span>
            </div>
          }
        >
          <InfoRow label="主机名" value={data.os.hostname} />
          <InfoRow label="操作系统" value={`${data.os.platform} ${data.os.release}`} />
          <InfoRow label="系统架构" value={data.os.arch} />
          <InfoRow label="系统运行时长" value={formatUptime(data.os.uptimeSeconds)} />
          <InfoRow label="系统状态" value={<Tag color="green" size="small">运行中</Tag>} />
        </Card>

        <Card
          className="monitor-card"
          title={
            <div className="monitor-card-title">
              <Cpu size={16} />
              <span>CPU</span>
            </div>
          }
        >
          <div className="monitor-progress-section">
            <div className="monitor-progress-header">
              <Text>CPU 使用率</Text>
              <Text strong>{data.cpu.usage}%</Text>
            </div>
            <div className={getProgressClass(data.cpu.usage)}>
              <Progress percent={data.cpu.usage} showInfo={false} size="large" />
            </div>
          </div>
          <InfoRow label="处理器型号" value={data.cpu.model} />
          <InfoRow label="核心数量" value={`${data.cpu.cores} 核`} />
          <InfoRow label="主频" value={`${data.cpu.speed} MHz`} />
          <InfoRow
            label="系统负载 (1/5/15min)"
            value={data.cpu.loadAvg.map((v) => v.toFixed(2)).join(' / ')}
          />
        </Card>

        <Card
          className="monitor-card"
          title={
            <div className="monitor-card-title">
              <MemoryStick size={16} />
              <span>内存</span>
            </div>
          }
        >
          <div className="monitor-progress-section">
            <div className="monitor-progress-header">
              <Text>内存使用率</Text>
              <Text strong>{data.memory.usagePercent}%</Text>
            </div>
            <div className={getProgressClass(data.memory.usagePercent)}>
              <Progress percent={data.memory.usagePercent} showInfo={false} size="large" />
            </div>
          </div>
          <InfoRow label="总内存" value={formatBytes(data.memory.total)} />
          <InfoRow label="已使用" value={formatBytes(data.memory.used)} />
          <InfoRow label="可用内存" value={formatBytes(data.memory.free)} />
        </Card>

        <Card
          className="monitor-card"
          title={
            <div className="monitor-card-title">
              <HardDrive size={16} />
              <span>磁盘 (/)</span>
            </div>
          }
        >
          {data.disk ? (
            <>
              <div className="monitor-progress-section">
                <div className="monitor-progress-header">
                  <Text>磁盘使用率</Text>
                  <Text strong>{data.disk.usagePercent}%</Text>
                </div>
                <div className={getProgressClass(data.disk.usagePercent)}>
                  <Progress percent={data.disk.usagePercent} showInfo={false} size="large" />
                </div>
              </div>
              <InfoRow label="总容量" value={formatBytes(data.disk.total)} />
              <InfoRow label="已使用" value={formatBytes(data.disk.used)} />
              <InfoRow label="可用空间" value={formatBytes(data.disk.free)} />
            </>
          ) : (
            <Text type="tertiary">磁盘信息不可用</Text>
          )}
        </Card>

        <Card
          className="monitor-card"
          title={
            <div className="monitor-card-title">
              <Server size={16} />
              <span>Node.js 进程</span>
            </div>
          }
        >
          <div className="monitor-progress-section">
            <div className="monitor-progress-header">
              <Text>堆内存使用率</Text>
              <Text strong>{heapPercent}%</Text>
            </div>
            <Progress percent={heapPercent} showInfo={false} size="large" />
          </div>
          <InfoRow label="进程 PID" value={data.node.pid} />
          <InfoRow label="Node 版本" value={data.node.version} />
          <InfoRow label="进程运行时长" value={formatUptime(data.node.uptime)} />
          <InfoRow label="RSS 内存" value={formatBytes(data.node.memoryUsage.rss)} />
          <InfoRow label="堆内存总量" value={formatBytes(data.node.memoryUsage.heapTotal)} />
          <InfoRow label="堆内存已用" value={formatBytes(data.node.memoryUsage.heapUsed)} />
          <InfoRow label="进程状态" value={<Tag color="green" size="small">运行中</Tag>} />
        </Card>

        <Card
          className="monitor-card"
          title={
            <div className="monitor-card-title">
              <Database size={16} />
              <span>数据库</span>
            </div>
          }
        >
          {data.database ? (
            <>
              <InfoRow label="数据库名称" value={data.database.name} />
              <InfoRow label="数据库大小" value={formatBytes(data.database.size)} />
              <InfoRow label="数据表数量" value={`${data.database.tableCount} 张`} />
              <InfoRow label="活跃连接数" value={data.database.activeConnections} />
              <InfoRow label="总连接数" value={data.database.totalConnections} />
              <InfoRow
                label="数据库状态"
                value={<Tag color="green" size="small">运行中</Tag>}
              />
            </>
          ) : (
            <Text type="tertiary">数据库信息不可用</Text>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="monitor-page">
      <div className="monitor-header">
        <Title heading={4} style={{ margin: 0 }}>服务监控</Title>
        <div className="monitor-header-right">
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
