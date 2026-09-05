import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Typography, Tag, Skeleton, Empty, List, Descriptions } from '@douyinfe/semi-ui';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import type { Announcement } from '@zenith/shared/messaging';
import type { MonitorAlertOverview } from '@zenith/shared/platform';
import { Bell, BookOpen, MonitorPlay, Siren, Users, Wifi, LogIn, Activity, MapPin, Clock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

// 图表区懒加载：'@/components/charts' 拖 ~1.9MB 的 @visactor 依赖树，
// 首页主体（欢迎区/统计概览/公告/日历）先渲染，图表 chunk 就绪后补齐
const DashboardChartsRow = lazy(() => import('./DashboardCharts'));

const GithubIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);
import { formatDateTime, stripHtml } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import AnnouncementDetailModal from '@/components/AnnouncementDetailModal';
import { UserAvatar } from '@/components/UserAvatar';
import MonthCalendar from '@/components/MonthCalendar';
import type { DashboardCharts, DashboardStats } from '@zenith/shared/analytics';
import { useDashboardCharts, useDashboardStats } from '@/hooks/queries/dashboard';
import {
  useMarkMyAnnouncementRead,
  useMyAnnouncementDetail,
  usePublishedAnnouncements,
} from '@/hooks/queries/announcements';
import { useMonitorAlertOverview } from '@/hooks/queries/monitor-alerts';
import './DashboardPage.css';

const { Text } = Typography;

type AnnouncementWithRead = Announcement & { isRead: boolean };

const STAT_ITEMS: Array<{
  key: keyof DashboardStats;
  label: string;
  icon: React.ReactNode;
}> = [
  { key: 'totalUsers',      label: '系统用户总数', icon: <Users size={16} /> },
  { key: 'onlineUsers',     label: '当前在线',     icon: <Wifi size={16} /> },
  { key: 'todayLogins',     label: '今日登录',     icon: <LogIn size={16} /> },
  { key: 'todayOperations', label: '今日操作',     icon: <Activity size={16} /> },
];

/** 告警指标：点击直达告警事件页对应筛选，避免「看到数字却不知道去哪查」 */
const ALERT_METRICS: Array<{
  key: string;
  label: string;
  accent: string;
  to: string;
  pick: (overview: MonitorAlertOverview) => number;
}> = [
  {
    key: 'firing', label: '告警中', accent: 'var(--semi-color-danger)',
    to: '/alerts/events?status=firing', pick: (o) => o.firingTotal,
  },
  {
    key: 'critical', label: '严重告警', accent: 'var(--semi-color-danger)',
    to: '/alerts/events?status=firing&level=critical',
    pick: (o) => o.firingByLevel.find((item) => item.level === 'critical')?.count ?? 0,
  },
  {
    key: 'pending', label: '待处理', accent: 'var(--semi-color-warning)',
    to: '/alerts/events?status=firing&handleStatus=pending', pick: (o) => o.pendingTotal,
  },
  {
    key: 'notifyFailed', label: '通知失败', accent: 'var(--semi-color-danger)',
    to: '/alerts/events?notifyStatus=failed', pick: (o) => o.notifyFailedInRange,
  },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const {
    getLabel: getAnnouncementTypeLabel,
    getColor: getAnnouncementTypeColor,
  } = useDictItems('announcement_type');
  const {
    getLabel: getAnnouncementPriorityLabel,
    getColor: getAnnouncementPriorityColor,
  } = useDictItems('announcement_priority');
  const { permissions, hasPermission } = usePermission();
  const { user } = useAuth();
  const isAdmin = permissions.includes('*');
  const canViewAlertOverview = hasPermission('alert:overview:list');
  const alertOverviewQuery = useMonitorAlertOverview('24h', canViewAlertOverview);
  const alertOverview = alertOverviewQuery.data ?? null;
  const [selectedNotice, setSelectedNotice] = useState<AnnouncementWithRead | null>(null);
  const noticesQuery = usePublishedAnnouncements();
  const statsQuery = useDashboardStats(isAdmin);
  const chartsQuery = useDashboardCharts(isAdmin);
  // 挂件场景：详情拉取失败时静默回退到列表数据，不打断工作台
  const detailQuery = useMyAnnouncementDetail(selectedNotice?.id, selectedNotice !== null, true);
  const markReadMutation = useMarkMyAnnouncementRead();
  const notices = noticesQuery.data ?? [];
  const stats: DashboardStats | null = statsQuery.data ?? null;
  const charts: DashboardCharts | null = chartsQuery.data ?? null;
  const selectedNoticeDetail = selectedNotice ? (detailQuery.data ? { ...detailQuery.data, isRead: true } : selectedNotice) : null;
  const loading = noticesQuery.isLoading;
  const statsLoading = statsQuery.isFetching;
  const chartsLoading = chartsQuery.isFetching;
  const noticeDetailLoading = detailQuery.isFetching;

  const architectureItems = [
    { key: '前端框架', value: 'React 19 + Vite' },
    { key: '后端框架', value: 'Hono v4 / Node.js' },
    { key: 'UI 组件库', value: 'Semi Design v2' },
    { key: '数据库', value: 'PostgreSQL' },
    { key: 'ORM', value: 'Drizzle ORM' },
    { key: '认证方案', value: 'JWT Bearer Token' },
  ];

  function markAsRead(id: number) {
    markReadMutation.mutate({ params: { id } });
  }

  async function openNotice(n: AnnouncementWithRead) {
    setSelectedNotice({ ...n, isRead: true });
    if (!n.isRead) markAsRead(n.id);
  }

  function renderNotices() {
    if (loading) return (
      <div className="dashboard-notice-skeleton">
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
          const typeInfo = {
            label: getAnnouncementTypeLabel(n.type),
            color: (getAnnouncementTypeColor(n.type) as TagColor | undefined) ?? 'blue',
          };
          const priInfo = {
            label: getAnnouncementPriorityLabel(n.priority),
            color: (getAnnouncementPriorityColor(n.priority) as TagColor | undefined) ?? 'grey',
          };
          return (
            <List.Item
              className="notice-item"
              header={n.isRead ? <div className="notice-read-placeholder" /> : <div className="unread-dot" />}
              main={(
                <button
                  type="button"
                  className="notice-content notice-content--button"
                  onClick={() => void openNotice(n)}
                >
                  <span className="notice-item-header">
                    <Text strong style={{ fontSize: 13 }} className="notice-title">{n.title}</Text>
                    <Tag color={typeInfo.color} size="small">{typeInfo.label}</Tag>
                    <Tag color={priInfo.color} size="small">{priInfo.label}</Tag>
                  </span>
                  <span className="notice-summary">{stripHtml(n.content || '', 200)}</span>
                  <span className="notice-item-footer">
                    <Text type="tertiary" size="small">
                      {n.createByName ?? '-'} · {formatDateTime(n.publishTime)}
                    </Text>
                  </span>
                </button>
              )}
            />
          );
        }}
      />
    );
  }

  return (
    <div className="page-container dashboard-page">
      <section className="dashboard-welcome-section" aria-label="欢迎信息">
        <Skeleton active loading={!user} placeholder={
          <div className="dashboard-welcome-skeleton">
            <Skeleton.Avatar style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <Skeleton.Title style={{ width: 180, height: 18, marginBottom: 8 }} />
              <Skeleton.Paragraph rows={1} style={{ width: 260 }} />
            </div>
          </div>
        }>
          <div className="dashboard-welcome">
            <div className="dashboard-welcome__left">
              <UserAvatar
                name={user?.nickname || '用户'}
                avatar={user?.avatar}
                size={null}
                semiSize="large"
                className="dashboard-welcome__avatar"
              />
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
      </section>

      {isAdmin && (
        <section className="dashboard-stats-row" aria-label="系统概览">
          {statsLoading
            ? STAT_ITEMS.map((item) => (
              <div key={item.key} className="dashboard-stat-item">
                <Skeleton active loading placeholder={
                  <div className="dashboard-stat-skeleton">
                    <Skeleton.Avatar style={{ width: 16, height: 16, borderRadius: '50%' }} />
                    <div style={{ flex: 1 }}>
                      <Skeleton.Title style={{ width: 60, height: 22, marginBottom: 6 }} />
                      <Skeleton.Paragraph rows={1} style={{ width: 80 }} />
                    </div>
                  </div>
                } />
              </div>
            ))
            : STAT_ITEMS.map((item) => (
              <div key={item.key} className="dashboard-stat-item">
                <div className="dashboard-stat-item__value">
                  {stats?.[item.key] ?? '—'}
                </div>
                <div className="dashboard-stat-item__label">
                  <span className="dashboard-stat-item__icon">{item.icon}</span>
                  {item.label}
                </div>
              </div>
            ))
          }
        </section>
      )}

      {canViewAlertOverview && (
        <section className="dashboard-section dashboard-alerts" aria-label="告警概览">
          <header className="dashboard-section-header">
            <div className="dashboard-section-heading">
              <Siren size={15} />
              <Text strong>告警中心</Text>
              <Text type="tertiary" size="small">近 24 小时</Text>
            </div>
            <Button theme="borderless" size="small" type="tertiary" onClick={() => navigate('/alerts/overview')}>查看全部</Button>
          </header>
          {alertOverviewQuery.isLoading ? (
            <Skeleton active loading placeholder={<Skeleton.Paragraph rows={1} style={{ width: '70%' }} />} />
          ) : (
            <div className="dashboard-alerts__metrics">
              {ALERT_METRICS.map((metric) => {
                const value = alertOverview ? metric.pick(alertOverview) : 0;
                return (
                  <button
                    type="button"
                    key={metric.key}
                    className="dashboard-alerts__metric"
                    onClick={() => navigate(metric.to)}
                  >
                    <span
                      className="dashboard-alerts__value"
                      // 为 0 时保持中性色：全都染红会让「无告警」和「有告警」看起来一样紧急
                      style={value > 0 ? { color: metric.accent } : undefined}
                    >
                      {alertOverview ? value : '—'}
                    </span>
                    <span className="dashboard-alerts__label">{metric.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {isAdmin && (
        <Suspense          fallback={
            <div className="dashboard-charts-row">
              {['7 天登录趋势', '今日操作分布', '7 天用户活跃度'].map((title) => (
                <section key={title} className="dashboard-chart-section">
                  <header className="dashboard-section-header">
                    <Text strong>{title}</Text>
                    <span className="dashboard-section-meta">{title.startsWith('今日') ? '今日' : '近 7 天'}</span>
                  </header>
                  <div className="dashboard-chart-placeholder">
                    <Skeleton active loading placeholder={
                      <div style={{ width: '100%', height: 200, padding: '12px 0' }}>
                        <Skeleton.Paragraph rows={6} style={{ width: '100%' }} />
                      </div>
                    } />
                  </div>
                </section>
              ))}
            </div>
          }
        >
          <DashboardChartsRow charts={charts} chartsLoading={chartsLoading} />
        </Suspense>
      )}

      <div className="dashboard-top-grid">
        <div className="dashboard-column dashboard-column--notice">
          <section className="dashboard-section dashboard-section--notice">
            <header className="dashboard-section-header">
              <div className="dashboard-section-heading">
                <Bell size={15} />
                <Text strong>通知公告</Text>
              </div>
              <Button theme="borderless" size="small" type="tertiary" onClick={() => navigate('/announcements')}>查看全部</Button>
            </header>
            {renderNotices()}
          </section>

          <section className="dashboard-section dashboard-section--calendar">
            <header className="dashboard-section-header">
              <Text strong>日历</Text>
            </header>
            <MonthCalendar />
          </section>
        </div>

        <aside className="dashboard-column dashboard-column--details">
          <section className="dashboard-section dashboard-section--links">
            <header className="dashboard-section-header">
              <Text strong>项目链接</Text>
            </header>
            <div className="project-links">
              <a href="https://github.com/iwangbowen/zenith-admin" target="_blank" rel="noreferrer" className="project-link-item" title="GitHub 仓库">
                <GithubIcon size={18} />
                <span>GitHub</span>
              </a>
              <a href="https://iwangbowen.github.io/zenith-admin/" target="_blank" rel="noreferrer" className="project-link-item" title="文档站点">
                <BookOpen size={18} />
                <span>文档</span>
              </a>
              <a href="https://iwangbowen.github.io/zenith-admin/demo/" target="_blank" rel="noreferrer" className="project-link-item" title="在线演示">
                <MonitorPlay size={18} />
                <span>演示</span>
              </a>
            </div>
          </section>

          <section className="dashboard-section dashboard-section--architecture">
            <header className="dashboard-section-header">
              <Text strong>技术架构</Text>
            </header>
            <Descriptions
              data={architectureItems}
              align="plain"
              className="dashboard-architecture"
            />
            <div className="architecture-tags">
              <Tag color="blue" size="small">TypeScript</Tag>
              <Tag color="cyan" size="small">Vite</Tag>
              <Tag color="green" size="small">Drizzle</Tag>
              <Tag color="violet" size="small">Monorepo</Tag>
              <Tag color="indigo" size="small">Zod</Tag>
              <Tag color="orange" size="small">JWT</Tag>
            </div>
          </section>
        </aside>
      </div>

      {/* ===== 通知详情 Modal ===== */}
      <AnnouncementDetailModal
        visible={selectedNotice !== null}
        announcement={selectedNoticeDetail}
        loading={noticeDetailLoading}
        onClose={() => setSelectedNotice(null)}
      />
    </div>
  );
}
