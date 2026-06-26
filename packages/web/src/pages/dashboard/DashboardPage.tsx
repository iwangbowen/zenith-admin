import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Calendar, Typography, Tag, Space, Skeleton, Empty, List, Avatar, Descriptions } from '@douyinfe/semi-ui';
import {
  AreaChart,
  LineChart,
  PieChart,
  chartOptions,
  makeAreaSpec,
  makeLineSpec,
  makePieSpec,
  useChartPalette,
} from '@/components/charts';
import { Bell, BookOpen, MonitorPlay, Users, UserCheck, Wifi, LogIn, Activity, MapPin, Clock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

const GithubIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import type { Announcement } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import AnnouncementDetailModal from '@/components/AnnouncementDetailModal';
import './DashboardPage.css';

const { Text } = Typography;

type AnnouncementWithRead = Announcement & { isRead: boolean };

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  onlineUsers: number;
  todayLogins: number;
  todayOperations: number;
}

interface LoginTrendItem { date: string; successCount: number; failCount: number; }
interface OperationTypeItem { module: string; count: number; fill?: string; }
interface UserActivityItem { date: string; activeUsers: number; }
interface DashboardCharts {
  loginTrend: LoginTrendItem[];
  operationTypes: OperationTypeItem[];
  userActivity: UserActivityItem[];
}

const PIE_COLORS = [
  '#4A90E2', '#52C41A', '#FA8C16', '#13C2C2',
  '#722ED1', '#F5222D', '#EB2F96', '#1677FF',
];

function shortDate(dateStr: string) {
  return dateStr.slice(5); // MM-DD
}

const STAT_ITEMS: Array<{
  key: keyof DashboardStats;
  label: string;
  icon: React.ReactNode;
  color: string;
}> = [
  { key: 'totalUsers',      label: '系统用户总数', icon: <Users size={20} />,      color: '#4A90E2' },
  { key: 'activeUsers',     label: '活跃用户',     icon: <UserCheck size={20} />,  color: '#52C41A' },
  { key: 'onlineUsers',     label: '当前在线',     icon: <Wifi size={20} />,       color: '#13C2C2' },
  { key: 'todayLogins',     label: '今日登录',     icon: <LogIn size={20} />,      color: '#722ED1' },
  { key: 'todayOperations', label: '今日操作',     icon: <Activity size={20} />,   color: '#FA8C16' },
];

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const ANNOUNCEMENT_TYPE_MAP: Record<string, { label: string; color: TagColor }> = {
  notice: { label: '通知', color: 'blue' },
  announcement: { label: '公告', color: 'cyan' },
  warning: { label: '预警', color: 'orange' },
};

const ANNOUNCEMENT_PRIORITY_MAP: Record<string, { label: string; color: TagColor }> = {
  high: { label: '高', color: 'red' },
  medium: { label: '中', color: 'orange' },
  low: { label: '低', color: 'green' },
};

const markReadById = (id: number) => (n: AnnouncementWithRead) =>
  n.id === id ? { ...n, isRead: true } : n;

function stripHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent ?? tmp.innerText ?? '').replaceAll(/\s+/g, ' ').trim();
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { permissions } = usePermission();
  const { user } = useAuth();
  const palette = useChartPalette();
  const isAdmin = permissions.includes('*');
  const [notices, setNotices] = useState<AnnouncementWithRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNotice, setSelectedNotice] = useState<AnnouncementWithRead | null>(null);
  const [noticeDetailLoading, setNoticeDetailLoading] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [charts, setCharts] = useState<DashboardCharts | null>(null);
  const [chartsLoading, setChartsLoading] = useState(false);

  const architectureItems = [
    { key: '前端框架', value: 'React 19 + Vite' },
    { key: '后端框架', value: 'Hono v4 / Node.js' },
    { key: 'UI 组件库', value: 'Semi Design v2' },
    { key: '数据库', value: 'PostgreSQL' },
    { key: 'ORM', value: 'Drizzle ORM' },
    { key: '认证方案', value: 'JWT Bearer Token' },
  ];

  useEffect(() => {
    request.get<AnnouncementWithRead[]>('/api/announcements/published', { silent: true })
      .then((res) => {
        if (res.code === 0) setNotices(res.data);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    setStatsLoading(true);
    request.get<DashboardStats>('/api/dashboard/stats', { silent: true })
      .then((res) => {
        if (res.code === 0) setStats(res.data);
      })
      .finally(() => setStatsLoading(false));
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    setChartsLoading(true);
    request.get<DashboardCharts>('/api/dashboard/charts', { silent: true })
      .then((res) => {
        if (res.code === 0) setCharts(res.data);
      })
      .finally(() => setChartsLoading(false));
  }, [isAdmin]);

  const loginTrendSpec = useMemo(() => makeLineSpec({
    data: charts?.loginTrend ?? [],
    xField: 'date',
    series: [
      { field: 'successCount', name: '成功', color: '#52C41A' },
      { field: 'failCount', name: '失败', color: '#F5222D' },
    ],
    palette,
    point: true,
    axis: { xLabel: shortDate },
    tooltip: { title: (x) => `日期：${x}` },
  }), [charts?.loginTrend, palette]);

  const userActivitySpec = useMemo(() => makeAreaSpec({
    data: charts?.userActivity ?? [],
    xField: 'date',
    series: [{ field: 'activeUsers', name: '活跃用户', color: '#4A90E2' }],
    palette,
    point: true,
    axis: { xLabel: shortDate },
    tooltip: { title: (x) => `日期：${x}` },
  }), [charts?.userActivity, palette]);

  function markAsRead(id: number) {
    request.post(`/api/announcements/${id}/read`, undefined, { silent: true }).then((res) => {
      if (res.code !== 0) return;
      setNotices((prev) => prev.map(markReadById(id)));
    });
  }

  async function openNotice(n: AnnouncementWithRead) {
    setSelectedNotice(n);
    if (!n.isRead) markAsRead(n.id);
    setNoticeDetailLoading(true);
    try {
      const res = await request.get<Announcement>(`/api/announcements/${n.id}`, { silent: true });
      if (res.code === 0 && res.data) {
        setSelectedNotice({ ...res.data, isRead: true });
      }
    } finally {
      setNoticeDetailLoading(false);
    }
  }

  function renderOperationPie() {
    if (chartsLoading) return (
      <div className="dashboard-chart-placeholder">
        <Skeleton active loading placeholder={
          <div style={{ width: '100%', height: 200, display: 'flex', alignItems: 'flex-end', gap: 12, padding: '0 8px' }}>
            {[60, 80, 45, 90, 55, 70].map((h) => (
              <Skeleton.Button key={h} style={{ flex: 1, height: `${h}%`, borderRadius: 4 }} />
            ))}
          </div>
        } />
      </div>
    );
    const pieData = charts?.operationTypes ?? [];
    if (pieData.length === 0) {
      return <div className="dashboard-chart-placeholder"><Empty description="今日暂无操作记录" /></div>;
    }
    const coloredData = pieData.map((item, idx) => ({ ...item, fill: PIE_COLORS[idx % PIE_COLORS.length] }));
    const operationPieSpec = makePieSpec({
      data: coloredData,
      categoryField: 'module',
      valueField: 'count',
      donut: false,
      colors: coloredData.map((d) => d.fill),
      palette,
      label: 'percent',
      valueUnit: '次',
    });
    return (
      <PieChart {...operationPieSpec} options={chartOptions} height={200} />
    );
  }

  function renderNotices() {
    if (loading) return (
      <div style={{ padding: '8px 16px' }}>
        <Skeleton active loading placeholder={
          <>
            {[1, 2, 3, 4].map((k) => (
              <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--color-border)' }}>
                <Skeleton.Avatar size="small" style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <Skeleton.Title style={{ width: '60%', height: 14, marginBottom: 8 }} />
                  <Skeleton.Paragraph rows={1} style={{ width: '90%' }} />
                  <Skeleton.Title style={{ width: 120, height: 10, marginTop: 8 }} />
                </div>
              </div>
            ))}
          </>
        } />
      </div>
    );
    if (notices.length === 0) return <Empty description="暂无公告" className="dashboard-empty" />;
    return (
      <List
        className="notice-list"
        dataSource={notices.slice(0, 6)}
        size="small"
        renderItem={(n: AnnouncementWithRead) => {
          const typeInfo = ANNOUNCEMENT_TYPE_MAP[n.type] ?? { label: n.type, color: 'blue' };
          const priInfo = ANNOUNCEMENT_PRIORITY_MAP[n.priority] ?? { label: n.priority, color: 'grey' };
          return (
            <List.Item
              className="notice-item notice-item--clickable"
              style={{ cursor: 'pointer' }}
              onClick={() => void openNotice(n)}
              header={n.isRead ? <div className="notice-read-placeholder" /> : <div className="unread-dot" />}
              main={(
                <div className="notice-content">
                  <div className="notice-item-header">
                    <Text strong style={{ fontSize: 13 }} className="notice-title">{n.title}</Text>
                    <Tag color={typeInfo.color} size="small">{typeInfo.label}</Tag>
                    <Tag color={priInfo.color} size="small">{priInfo.label}</Tag>
                  </div>
                  <div
                    className="notice-summary"
                    style={{ maxHeight: 40, overflow: 'hidden', lineHeight: 1.5 }}
                  >
                    {stripHtml(n.content || '')}
                  </div>
                  <div className="notice-item-footer">
                    <Text type="tertiary" size="small">
                      {n.createByName ?? '-'} · {formatDateTime(n.publishTime)}
                    </Text>
                  </div>
                </div>
              )}
            />
          );
        }}
      />
    );
  }

  return (
    <div className="page-container dashboard-page">
      {/* ===== 欢迎横幅 ===== */}
      <Card bodyStyle={{ padding: '16px 20px' }} className="dashboard-welcome-card">
        <Skeleton active loading={!user} placeholder={
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Skeleton.Avatar style={{ width: 52, height: 52, borderRadius: '50%', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <Skeleton.Title style={{ width: 180, height: 18, marginBottom: 8 }} />
              <Skeleton.Paragraph rows={1} style={{ width: 260 }} />
            </div>
          </div>
        }>
          <div className="dashboard-welcome">
            <div className="dashboard-welcome__left">
              <Avatar
                src={user?.avatar || undefined}
                color="blue"
                size="large"
                style={{ width: 52, height: 52, fontSize: 20, flexShrink: 0, cursor: 'pointer' }}
                onClick={() => navigate('/profile')}
              >
                {user?.nickname?.charAt(0).toUpperCase() ?? 'U'}
              </Avatar>
              <div className="dashboard-welcome__info">
                <div className="dashboard-welcome__greeting">
                  {'欢迎回来，'}
                  <button
                    type="button"
                    className="dashboard-welcome__name dashboard-welcome__name--link"
                    onClick={() => navigate('/profile')}
                  >
                    {user?.nickname ?? user?.username ?? '用户'}
                  </button>
                </div>
                <div className="dashboard-welcome__meta">
                  {user?.lastLoginAt ? (
                    <>
                      <span className="dashboard-welcome__meta-item">
                        <Clock size={12} />
                        上次登录：{user.lastLoginAt}
                      </span>
                      {user.lastLoginIp && (
                        <span className="dashboard-welcome__meta-item">
                          <MapPin size={12} />
                          {user.lastLoginLocation ? `${user.lastLoginLocation}（${user.lastLoginIp}）` : `IP：${user.lastLoginIp}`}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="dashboard-welcome__meta-item">首次登录，欢迎！</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Skeleton>
      </Card>
      {isAdmin && (
        <div className="dashboard-stats-row">
          {statsLoading
            ? STAT_ITEMS.map((item) => (
              <Card key={item.key} className="dashboard-stat-card" bodyStyle={{ padding: '16px 20px' }}>
                <Skeleton active loading placeholder={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <Skeleton.Avatar style={{ width: 44, height: 44, borderRadius: 10 }} />
                    <div style={{ flex: 1 }}>
                      <Skeleton.Title style={{ width: 60, height: 22, marginBottom: 6 }} />
                      <Skeleton.Paragraph rows={1} style={{ width: 80 }} />
                    </div>
                  </div>
                } />
              </Card>
            ))
            : STAT_ITEMS.map((item) => (
              <Card key={item.key} className="dashboard-stat-card" bodyStyle={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10,
                    background: `${item.color}18`,
                    color: item.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {item.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2, color: 'var(--semi-color-text-0)' }}>
                      {stats?.[item.key] ?? '—'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginTop: 2 }}>
                      {item.label}
                    </div>
                  </div>
                </div>
              </Card>
            ))
          }
        </div>
      )}
      {isAdmin && (
        <div className="dashboard-charts-row">
          {/* 7 天登录趋势 */}
          <Card
            title={<Text strong style={{ fontSize: 14 }}>7 天登录趋势</Text>}
            className="dashboard-card dashboard-chart-card"
            bodyStyle={{ padding: '12px 16px 8px' }}
          >
            {chartsLoading
              ? <div className="dashboard-chart-placeholder">
                  <Skeleton active loading placeholder={
                    <div style={{ width: '100%', height: 200, padding: '12px 0' }}>
                      <Skeleton.Paragraph rows={6} style={{ width: '100%' }} />
                    </div>
                  } />
                </div>
              : (
                <LineChart {...loginTrendSpec} options={chartOptions} height={200} />
              )
            }
          </Card>

          {/* 今日操作类型分布 */}
          <Card
            title={<Text strong style={{ fontSize: 14 }}>今日操作分布</Text>}
            className="dashboard-card dashboard-chart-card"
            bodyStyle={{ padding: '12px 16px 8px' }}
          >
            {renderOperationPie()}
          </Card>

          {/* 用户活跃度曲线 */}
          <Card
            title={<Text strong style={{ fontSize: 14 }}>7 天用户活跃度</Text>}
            className="dashboard-card dashboard-chart-card"
            bodyStyle={{ padding: '12px 16px 8px' }}
          >
            {chartsLoading
              ? <div className="dashboard-chart-placeholder">
                  <Skeleton active loading placeholder={
                    <div style={{ width: '100%', height: 200, padding: '12px 0' }}>
                      <Skeleton.Paragraph rows={6} style={{ width: '100%' }} />
                    </div>
                  } />
                </div>
              : (
                <AreaChart {...userActivitySpec} options={chartOptions} height={200} />
              )
            }
          </Card>
        </div>
      )}

      <div className="dashboard-top-grid">
        <div className="dashboard-column dashboard-column--notice">
          <Card
            title={
              <div className="dashboard-card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <Space spacing={6}>
                  <Bell size={14} />
                  <Text strong style={{ fontSize: 14 }}>通知公告</Text>
                </Space>
                <Button theme="borderless" size="small" type="tertiary" onClick={() => navigate('/announcements')}>查看更多</Button>
              </div>
            }
            className="dashboard-card dashboard-card--notice"
            bodyStyle={{ padding: 0 }}
          >
            {renderNotices()}
          </Card>

          <Card
            title={<Text strong style={{ fontSize: 14 }}>日历</Text>}
            className="dashboard-card dashboard-card--calendar"
            style={{ marginTop: 16 }}
            bodyStyle={{ padding: '8px 0 4px' }}
          >
            <Calendar mode="month" />
          </Card>
        </div>

        <div className="dashboard-column">
          <Card
            title={<Text strong style={{ fontSize: 14 }}>项目链接</Text>}
            className="dashboard-card dashboard-card--links"
          >
            <div className="project-links">
              <a href="https://github.com/iwangbowen/zenith-admin" target="_blank" rel="noreferrer" className="project-link-item" title="GitHub 仓库">
                <GithubIcon size={18} />
              </a>
              <a href="https://iwangbowen.github.io/zenith-admin/" target="_blank" rel="noreferrer" className="project-link-item" title="文档站点">
                <BookOpen size={18} />
              </a>
              <a href="https://iwangbowen.github.io/zenith-admin/demo/" target="_blank" rel="noreferrer" className="project-link-item" title="在线演示">
                <MonitorPlay size={18} />
              </a>
            </div>
          </Card>

          <Card
            title={<Text strong style={{ fontSize: 14 }}>技术架构</Text>}
            className="dashboard-card dashboard-card--architecture"
            style={{ marginTop: 16 }}
            bodyStyle={{ padding: '4px 0 8px' }}
          >
            <Descriptions
              data={architectureItems}
              align="plain"
              style={{ padding: '4px 16px 4px' }}
            />
            <div className="architecture-tags">
              <Space wrap spacing={6}>
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

      {/* ===== 通知详情 Modal ===== */}
      <AnnouncementDetailModal
        visible={selectedNotice !== null}
        announcement={selectedNotice}
        loading={noticeDetailLoading}
        onClose={() => setSelectedNotice(null)}
      />
    </div>
  );
}
