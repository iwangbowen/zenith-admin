import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card,
  Row,
  Col,
  Typography,
  Tag,
  Space,
  Button,
  Progress,
  Spin,
  Descriptions,
  Toast,
} from '@douyinfe/semi-ui';
import { Activity, RefreshCw, Cpu, MemoryStick, HardDrive, Server, Database } from 'lucide-react';
import type { MonitorSnapshot } from '@zenith/shared';
import { request } from '../../../utils/request';

const { Title, Text } = Typography;

const AUTO_REFRESH_INTERVAL = 10_000; // 10 秒自动刷新

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d} 天`);
  if (h > 0) parts.push(`${h} 小时`);
  if (m > 0) parts.push(`${m} 分钟`);
  if (s >= 0 && parts.length === 0) parts.push(`${s} 秒`);
  return parts.join(' ');
}

function getUsageColor(percent: number): string {
  if (percent >= 90) return '#f53f3f';
  if (percent >= 70) return '#ff7d00';
  return '#00b42a';
}

function statusTagProps(status: MonitorSnapshot['overallStatus']) {
  const map: Record<MonitorSnapshot['overallStatus'], { color: 'green' | 'orange' | 'red'; text: string }> = {
    healthy:  { color: 'green',  text: '健康' },
    warning:  { color: 'orange', text: '警告' },
    critical: { color: 'red',    text: '严重' },
  };
  return map[status] ?? map.healthy;
}

interface MetricCardProps {
  icon: React.ReactNode;
  title: string;
  percent: number;
  used: string;
  total: string;
  extra?: React.ReactNode;
}

function MetricCard({ icon, title, percent, used, total, extra }: MetricCardProps) {
  const color = getUsageColor(percent);
  return (
    <Card bodyStyle={{ padding: '20px 24px' }}>
      <Space align="center" style={{ marginBottom: 16 }}>
        <span style={{ color, display: 'flex' }}>{icon}</span>
        <Text strong style={{ fontSize: 14 }}>{title}</Text>
      </Space>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <Progress
          type="circle"
          percent={Math.round(percent)}
          stroke={color}
          size="large"
          showInfo
          format={(val) => (
            <span style={{ fontSize: 18, fontWeight: 700, color }}>{val}%</span>
          )}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <Text type="tertiary" size="small">已用：{used}</Text>
        <Text type="tertiary" size="small">总计：{total}</Text>
      </div>
      {extra && <div style={{ marginTop: 8 }}>{extra}</div>}
    </Card>
  );
}

export default function MonitorPage() {
  const [data, setData] = useState<MonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMonitor = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await request.get<MonitorSnapshot>('/api/monitor');
      if (res.code === 0) {
        setData(res.data);
      } else {
        Toast.error('获取监控数据失败');
      }
    } catch {
      Toast.error('网络请求失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMonitor();
    timerRef.current = setInterval(() => fetchMonitor(true), AUTO_REFRESH_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchMonitor]);

  const overallTag = data ? statusTagProps(data.overallStatus) : null;

  return (
    <div className="page-container">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <Title heading={4} style={{ fontWeight: 600, margin: 0 }}>
            服务监控
          </Title>
          <Text type="tertiary" size="small">
            系统资源与服务进程实时状态，每 {AUTO_REFRESH_INTERVAL / 1000} 秒自动刷新
          </Text>
        </div>
        <Space>
          {overallTag && (
            <Tag color={overallTag.color} size="large" style={{ borderRadius: 20 }}>
              整体状态：{overallTag.text}
            </Tag>
          )}
          <Button
            icon={<RefreshCw size={14} />}
            onClick={() => fetchMonitor()}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      {loading && !data ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
          <Spin size="large" />
        </div>
      ) : data ? (
        <>
          {/* ── 采集时间 ── */}
          <div style={{ marginBottom: 16 }}>
            <Text type="tertiary" size="small">
              <Activity size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              数据采集时间：{new Date(data.collectedAt).toLocaleString('zh-CN')}
            </Text>
          </div>

          {/* ── 硬件资源 ── */}
          <div style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              硬件资源
            </Text>
          </div>
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            {/* CPU */}
            <Col span={8}>
              <MetricCard
                icon={<Cpu size={20} />}
                title="CPU 使用率"
                percent={data.hardware.cpu.usage}
                used={`${data.hardware.cpu.usage}%`}
                total={`${data.hardware.cpu.cores} 核`}
                extra={
                  <div>
                    <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 4 }}>
                      {data.hardware.cpu.model}
                    </Text>
                    <Text type="tertiary" size="small">
                      负载均值：{data.hardware.cpu.loadAvg.map((v: number) => v.toFixed(2)).join(' / ')}
                    </Text>
                  </div>
                }
              />
            </Col>
            {/* Memory */}
            <Col span={8}>
              <MetricCard
                icon={<MemoryStick size={20} />}
                title="内存使用率"
                percent={data.hardware.memory.usagePercent}
                used={formatBytes(data.hardware.memory.used)}
                total={formatBytes(data.hardware.memory.total)}
                extra={
                  <Progress
                    percent={Math.round(data.hardware.memory.usagePercent)}
                    stroke={getUsageColor(data.hardware.memory.usagePercent)}
                    showInfo={false}
                    size="small"
                  />
                }
              />
            </Col>
            {/* Disk */}
            <Col span={8}>
              <MetricCard
                icon={<HardDrive size={20} />}
                title="磁盘使用率"
                percent={data.hardware.disk.usagePercent}
                used={formatBytes(data.hardware.disk.used)}
                total={formatBytes(data.hardware.disk.total)}
                extra={
                  <Progress
                    percent={Math.round(data.hardware.disk.usagePercent)}
                    stroke={getUsageColor(data.hardware.disk.usagePercent)}
                    showInfo={false}
                    size="small"
                  />
                }
              />
            </Col>
          </Row>

          {/* ── 服务进程 & 数据库 ── */}
          <div style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              服务状态
            </Text>
          </div>
          <Row gutter={[16, 16]}>
            {/* Node.js Process */}
            <Col span={12}>
              <Card
                title={
                  <Space>
                    <Server size={16} style={{ color: '#3370ff' }} />
                    <Text strong style={{ fontSize: 14 }}>Node.js 进程</Text>
                    <Tag color="blue" size="small">运行中</Tag>
                  </Space>
                }
              >
                <Descriptions
                  size="small"
                  row
                  data={[
                    { key: 'PID',       value: String(data.service.pid) },
                    { key: '运行时间',  value: formatUptime(data.service.uptime) },
                    { key: 'Node 版本', value: data.service.nodeVersion },
                    { key: '平台',      value: `${data.service.platform} / ${data.service.arch}` },
                    { key: 'RSS 内存',  value: formatBytes(data.service.memory.rss) },
                    { key: '堆总量',    value: formatBytes(data.service.memory.heapTotal) },
                    { key: '堆已用',    value: formatBytes(data.service.memory.heapUsed) },
                    { key: '外部内存',  value: formatBytes(data.service.memory.external) },
                  ]}
                  style={{ fontSize: 13 }}
                />
                <div style={{ marginTop: 12 }}>
                  <Text type="tertiary" size="small">堆内存使用</Text>
                  <Progress
                    percent={Math.round(
                      (data.service.memory.heapUsed / data.service.memory.heapTotal) * 100,
                    )}
                    stroke={getUsageColor(
                      (data.service.memory.heapUsed / data.service.memory.heapTotal) * 100,
                    )}
                    showInfo
                    size="small"
                    style={{ marginTop: 6 }}
                  />
                </div>
              </Card>
            </Col>

            {/* Database */}
            <Col span={12}>
              <Card
                title={
                  <Space>
                    <Database
                      size={16}
                      style={{ color: data.database.status === 'up' ? '#00b42a' : '#f53f3f' }}
                    />
                    <Text strong style={{ fontSize: 14 }}>数据库</Text>
                    <Tag
                      color={data.database.status === 'up' ? 'green' : 'red'}
                      size="small"
                    >
                      {data.database.status === 'up' ? '连接正常' : '连接异常'}
                    </Tag>
                  </Space>
                }
              >
                <Descriptions
                  size="small"
                  row
                  data={[
                    { key: '状态',    value: data.database.status === 'up' ? '正常' : '异常' },
                    { key: '响应延迟', value: data.database.status === 'up' ? `${data.database.latency} ms` : 'N/A' },
                    { key: '版本',    value: data.database.version || 'N/A' },
                  ]}
                  style={{ fontSize: 13 }}
                />
                {data.database.status === 'up' && (
                  <div style={{ marginTop: 16 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 16px',
                        borderRadius: 8,
                        background: 'var(--semi-color-success-light-default)',
                      }}
                    >
                      <div
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: '#00b42a',
                          boxShadow: '0 0 6px #00b42a',
                          animation: 'pulse 2s infinite',
                          flexShrink: 0,
                        }}
                      />
                      <Text style={{ fontSize: 13, color: '#00b42a' }}>
                        数据库连接正常，延迟 {data.database.latency} ms
                      </Text>
                    </div>
                  </div>
                )}
                {data.database.status === 'down' && (
                  <div style={{ marginTop: 16 }}>
                    <div
                      style={{
                        padding: '12px 16px',
                        borderRadius: 8,
                        background: 'var(--semi-color-danger-light-default)',
                      }}
                    >
                      <Text style={{ fontSize: 13, color: '#f53f3f' }}>
                        ⚠ 无法连接到数据库，请检查数据库服务状态
                      </Text>
                    </div>
                  </div>
                )}
              </Card>
            </Col>
          </Row>
        </>
      ) : null}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
