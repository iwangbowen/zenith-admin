import { useEffect, useState } from 'react';
import { Card, Typography, Tag, Space, Spin, Empty } from '@douyinfe/semi-ui';
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

  const architectureItems = [
    { key: '前端框架', value: 'React 19 + Vite' },
    { key: '后端框架', value: 'Hono v4 / Node.js' },
    { key: 'UI 组件库', value: 'Semi Design v2' },
    { key: '数据库', value: 'PostgreSQL' },
    { key: 'ORM', value: 'Drizzle ORM' },
    { key: '认证方案', value: 'JWT Bearer Token' },
  ];

  useEffect(() => {
    Promise.all([
      request.get<MonitorData>('/api/monitor', { silent: true }),
      request.get<NoticeWithRead[]>('/api/notices/published', { silent: true }),
    ]).then(([monRes, notRes]) => {
      if (monRes.code === 0) setMonitor(monRes.data);
      if (notRes.code === 0) setNotices(notRes.data);
    }).finally(() => setLoading(false));
  }, []);

  const statCards = [
    {
      label: 'CPU 使用率',
      value: loading ? null : (monitor ? `${monitor.cpu.usage}%` : '-'),
      icon: <Cpu size={18} style={{ color: '#3370ff' }} />,
      bg: '#ebf1ff',
    },
    {
      label: '内存使用率',
      value: loading ? null : (monitor ? `${monitor.memory.usagePercent}%` : '-'),
      icon: <Server size={18} style={{ color: '#0fc6c2' }} />,
      bg: '#e6f7f6',
    },
    {
      label: 'Node 运行时间',
      value: loading ? null : (monitor ? formatUptime(monitor.node.uptime) : '-'),
      icon: <Clock size={18} style={{ color: '#21b550' }} />,
      bg: '#e8f8ec',
    },
    {
      label: '数据库连接',
      value: loading ? null : (monitor ? (monitor.database ? `${monitor.database.activeConnections} / ${monitor.database.totalConnections}` : '-') : '-'),
      icon: <Database size={18} style={{ color: '#f5a623' }} />,
      bg: '#fef6e6',
    },
  ];

  return (
    <div className="page-container dashboard-page">
      <div className="dashboard-top-grid">
        <div className="dashboard-column dashboard-column--notice">
          <Card
            title={
              <div className="dashboard-card-title">
                <Bell size={14} />
                <Text strong style={{ fontSize: 14 }}>通知公告</Text>
              </div>
            }
            className="dashboard-card dashboard-card--notice"
            bodyStyle={{ padding: 0 }}
          >
            {loading ? (
              <div className="dashboard-empty-state"><Spin /></div>
            ) : notices.length === 0 ? (
              <Empty description="暂无通知公告" className="dashboard-empty" />
            ) : (
              <div className="notice-list">
                {notices.slice(0, 6).map((n) => {
                  const typeInfo = NOTICE_TYPE_MAP[n.type] ?? { label: n.type, color: 'blue' as TagColor };
                  const priInfo = NOTICE_PRIORITY_MAP[n.priority] ?? { label: n.priority, color: 'grey' as TagColor };
                  return (
                    <div key={n.id} className={`notice-item${n.isRead ? '' : ' unread'}`}>
                      <div className="notice-content">
                        <div className="notice-item-header">
                          <Text strong style={{ fontSize: 13 }} className="notice-title">{n.title}</Text>
                          <Tag color={typeInfo.color} size="small">{typeInfo.label}</Tag>
                          <Tag color={priInfo.color} size="small">{priInfo.label}</Tag>
                        </div>
                        <Text type="tertiary" size="small" className="notice-summary">
                          {n.content || '暂无详细内容'}
                        </Text>
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
        </div>

        <div className="dashboard-column">
          <Card
            title={<Text strong style={{ fontSize: 14 }}>技术架构</Text>}
            className="dashboard-card dashboard-card--architecture"
          >
            <div className="architecture-list">
              {architectureItems.map((item) => (
                <div key={item.key} className="architecture-item">
                  <div className="architecture-item__label">{item.key}</div>
                  <div className="architecture-item__value">{item.value}</div>
                </div>
              ))}
            </div>
            <div className="architecture-tags">
              <Space wrap spacing={8}>
                <Tag color="blue" size="small">TypeScript</Tag>
                <Tag color="cyan" size="small">Vite</Tag>
                <Tag color="green" size="small">Drizzle</Tag>
                <Tag color="violet" size="small">Monorepo</Tag>
                <Tag color="indigo" size="small">Zod</Tag>
                <Tag color="orange" size="small">JWT</Tag>
              </Space>
            </div>
          </Card>
        </div>
      </div>

      <div className="dashboard-section-intro">
        <Text strong>运行概览</Text>
        <Text type="tertiary">只保留最常看的四项状态，信息更聚焦。</Text>
      </div>

      <div className="dashboard-metrics-grid">
        {statCards.map((s) => (
          <Card key={s.label} className="dashboard-stat-card" bodyStyle={{ padding: 18 }}>
            <div className="dashboard-stat-card__inner">
              <div className="dashboard-stat-card__icon" style={{ background: s.bg }}>
                {s.icon}
              </div>
              <div className="dashboard-stat-card__content">
                <div className="dashboard-stat-card__value">{s.value ?? <Spin size="small" />}</div>
                <div className="dashboard-stat-card__label">{s.label}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
