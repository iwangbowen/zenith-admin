import { useEffect, useState } from 'react';
import { Card, Row, Col, Typography, Descriptions, Tag, Space, Spin, Empty } from '@douyinfe/semi-ui';
import { Bell, Cpu, Database, Server, Clock } from 'lucide-react';
import { request } from '../../utils/request';
import { formatDateTime } from '../../utils/date';
import type { Notice } from '@zenith/shared';
import './DashboardPage.css';

const { Text } = Typography;

interface MonitorData {
  os: { platform: string; release: string; arch: string; hostname: string; uptimeSeconds: number };
  cpu: { model: string; cores: number; speed: number; loadAvg: number[]; usage: number };
  memory: { total: number; used: number; free: number; usagePercent: number };
  disk: { total: number; used: number; free: number; usagePercent: number } | null;
  node: { version: string; uptime: number; pid: number; memoryUsage: { heapUsed: number; heapTotal: number; rss: number; external: number } };
  database: { name: string; size: number; activeConnections: number; totalConnections: number; tableCount: number } | null;
}

type NoticeWithRead = Notice & { isRead: boolean };

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${mins} 分钟`;
  return `${mins} 分钟`;
}

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const NOTICE_TYPE_MAP: Record<string, { label: string; color: TagColor }> = {
  notice: { label: '通知', color: 'blue' },
  announcement: { label: '公告', color: 'cyan' },
  warning: { label: '预警', color: 'orange' },
};

const NOTICE_PRIORITY_MAP: Record<string, { label: string; color: TagColor }> = {
  high: { label: '高', color: 'red' },
  medium: { label: '中', color: 'orange' },
  low: { label: '低', color: 'green' },
};

export default function DashboardPage() {
  const [monitor, setMonitor] = useState<MonitorData | null>(null);
  const [notices, setNotices] = useState<NoticeWithRead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      request.get<MonitorData>('/api/monitor'),
      request.get<NoticeWithRead[]>('/api/notices/published'),
    ]).then(([monRes, notRes]) => {
      if (monRes.code === 0) setMonitor(monRes.data);
      if (notRes.code === 0) setNotices(notRes.data);
    }).finally(() => setLoading(false));
  }, []);

  const statCards = [
    {
      label: 'CPU 使用率',
      value: monitor ? `${monitor.cpu.usage}%` : null,
      icon: <Cpu size={18} style={{ color: '#3370ff' }} />,
      bg: '#ebf1ff',
    },
    {
      label: '内存使用率',
      value: monitor ? `${monitor.memory.usagePercent}%` : null,
      icon: <Server size={18} style={{ color: '#0fc6c2' }} />,
      bg: '#e6f7f6',
    },
    {
      label: 'Node 运行时间',
      value: monitor ? formatUptime(monitor.node.uptime) : null,
      icon: <Clock size={18} style={{ color: '#21b550' }} />,
      bg: '#e8f8ec',
    },
    {
      label: '数据库连接',
      value: monitor
        ? monitor.database
          ? `${monitor.database.activeConnections} / ${monitor.database.totalConnections}`
          : '-'
        : null,
      icon: <Database size={18} style={{ color: '#f5a623' }} />,
      bg: '#fef6e6',
    },
  ];

  return (
    <div className="page-container">
      {/* 服务运行统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {statCards.map((s) => (
          <Col key={s.label} span={6}>
            <Card
              className="dashboard-stat-card"
              bodyStyle={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: s.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {s.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3, minHeight: 26 }}>
                  {s.value ?? <Spin size="small" />}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                  {s.label}
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        {/* 通知公告 */}
        <Col span={16}>
          <Card
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Bell size={14} />
                <Text strong style={{ fontSize: 14 }}>通知公告</Text>
              </div>
            }
            className="dashboard-card"
            bodyStyle={{ padding: 0 }}
          >
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>
            ) : notices.length === 0 ? (
              <Empty description="暂无通知公告" style={{ padding: 40 }} />
            ) : (
              <div className="notice-list">
                {notices.slice(0, 8).map((n) => {
                  const typeInfo = NOTICE_TYPE_MAP[n.type] ?? { label: n.type, color: 'blue' as TagColor };
                  const priInfo = NOTICE_PRIORITY_MAP[n.priority] ?? { label: n.priority, color: 'grey' as TagColor };
                  return (
                    <div key={n.id} className={`notice-item${n.isRead ? '' : ' unread'}`}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="notice-item-header">
                          <Text strong style={{ fontSize: 13 }} className="notice-title">{n.title}</Text>
                          <Tag color={typeInfo.color} size="small">{typeInfo.label}</Tag>
                          <Tag color={priInfo.color} size="small">{priInfo.label}</Tag>
                        </div>
                        <Text type="tertiary" size="small">
                          {n.createByName ?? '-'} · {formatDateTime(n.publishTime)}
                        </Text>
                      </div>
                      {!n.isRead && <div className="unread-dot" />}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </Col>

        {/* 技术架构 */}
        <Col span={8}>
          <Card
            title={<Text strong style={{ fontSize: 14 }}>技术架构</Text>}
            className="dashboard-card"
          >
            <Descriptions
              size="small"
              row
              data={[
                { key: '前端框架', value: 'React 19 + Vite' },
                { key: '后端框架', value: 'Hono v4 / Node.js' },
                { key: 'UI 组件库', value: 'Semi Design v2' },
                { key: '数据库', value: 'PostgreSQL' },
                { key: 'ORM', value: 'Drizzle ORM' },
                { key: '认证方案', value: 'JWT Bearer Token' },
              ]}
              style={{ fontSize: 13 }}
            />
            <div style={{ marginTop: 14 }}>
              <Space wrap>
                <Tag color="blue" size="small">TypeScript</Tag>
                <Tag color="cyan" size="small">Vite</Tag>
                <Tag color="green" size="small">Drizzle</Tag>
                <Tag color="violet" size="small">Monorepo</Tag>
                <Tag color="indigo" size="small">Zod</Tag>
                <Tag color="orange" size="small">JWT</Tag>
              </Space>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 服务运行信息 */}
      <Row gutter={16}>
        <Col span={24}>
          <Card
            title={<Text strong style={{ fontSize: 14 }}>服务运行信息</Text>}
            className="dashboard-card"
          >
            {!monitor ? (
              <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
            ) : (
              <Row gutter={[24, 0]}>
                <Col span={6}>
                  <div className="monitor-section-title">操作系统</div>
                  <Descriptions
                    size="small"
                    row
                    data={[
                      { key: '平台', value: monitor.os.platform },
                      { key: '架构', value: monitor.os.arch },
                      { key: '主机名', value: monitor.os.hostname },
                      { key: '已运行', value: formatUptime(monitor.os.uptimeSeconds) },
                    ]}
                    style={{ fontSize: 12 }}
                  />
                </Col>
                <Col span={6}>
                  <div className="monitor-section-title">CPU</div>
                  <Descriptions
                    size="small"
                    row
                    data={[
                      { key: '核心数', value: `${monitor.cpu.cores} 核` },
                      { key: '主频', value: `${monitor.cpu.speed} MHz` },
                      { key: '负载均值', value: monitor.cpu.loadAvg.map((v) => v.toFixed(2)).join(' / ') },
                      { key: '使用率', value: `${monitor.cpu.usage}%` },
                    ]}
                    style={{ fontSize: 12 }}
                  />
                </Col>
                <Col span={6}>
                  <div className="monitor-section-title">内存</div>
                  <Descriptions
                    size="small"
                    row
                    data={[
                      { key: '总内存', value: formatBytes(monitor.memory.total) },
                      { key: '已使用', value: formatBytes(monitor.memory.used) },
                      { key: '空闲', value: formatBytes(monitor.memory.free) },
                      { key: '使用率', value: `${monitor.memory.usagePercent}%` },
                    ]}
                    style={{ fontSize: 12 }}
                  />
                </Col>
                <Col span={6}>
                  <div className="monitor-section-title">Node.js / 数据库</div>
                  <Descriptions
                    size="small"
                    row
                    data={[
                      { key: 'Node 版本', value: monitor.node.version },
                      { key: '运行时长', value: formatUptime(monitor.node.uptime) },
                      { key: 'Heap 占用', value: formatBytes(monitor.node.memoryUsage.heapUsed) },
                      ...(monitor.database
                        ? [
                            { key: '数据库', value: monitor.database.name },
                            { key: 'DB 大小', value: formatBytes(monitor.database.size) },
                            { key: '表数量', value: `${monitor.database.tableCount} 张` },
                          ]
                        : [{ key: '数据库', value: '无法连接' }]),
                    ]}
                    style={{ fontSize: 12 }}
                  />
                </Col>
              </Row>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
