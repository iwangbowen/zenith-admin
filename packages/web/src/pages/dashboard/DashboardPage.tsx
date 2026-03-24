import { useEffect, useState } from 'react';
import { Button, Card, Typography, Tag, Space, Spin, Empty, Toast } from '@douyinfe/semi-ui';
import { Bell } from 'lucide-react';
import { request } from '../../utils/request';
import { formatDateTime } from '../../utils/date';
import type { Notice } from '@zenith/shared';
import './DashboardPage.css';

const { Text } = Typography;

type NoticeWithRead = Notice & { isRead: boolean };

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

const markReadById = (id: number) => (n: NoticeWithRead) =>
  n.id === id ? { ...n, isRead: true } : n;

export default function DashboardPage() {
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
    request.get<NoticeWithRead[]>('/api/notices/published', { silent: true })
      .then((res) => {
        if (res.code === 0) setNotices(res.data);
      })
      .finally(() => setLoading(false));
  }, []);

  function markAsRead(id: number) {
    request.post(`/api/notices/${id}/read`, undefined, { silent: true }).then((res) => {
      if (res.code !== 0) return;
      setNotices((prev) => prev.map(markReadById(id)));
      Toast.success('已标记为已读');
    });
  }

  function renderNotices() {
    if (loading) return <div className="dashboard-empty-state"><Spin /></div>;
    if (notices.length === 0) return <Empty description="暂无通知公告" className="dashboard-empty" />;
    return (
      <div className="notice-list">
        {notices.slice(0, 6).map((n) => {
          const typeInfo = NOTICE_TYPE_MAP[n.type] ?? { label: n.type, color: 'blue' as TagColor };
          const priInfo = NOTICE_PRIORITY_MAP[n.priority] ?? { label: n.priority, color: 'grey' as TagColor };
          return (
            <div key={n.id} className="notice-item">
              <div className="notice-content">
                <div className="notice-item-header">
                  {!n.isRead && <div className="unread-dot" />}
                  <Text strong style={{ fontSize: 13 }} className="notice-title">{n.title}</Text>
                  <Tag color={typeInfo.color} size="small">{typeInfo.label}</Tag>
                  <Tag color={priInfo.color} size="small">{priInfo.label}</Tag>
                </div>
                <Text type="tertiary" size="small" className="notice-summary">
                  {n.content || '暂无详细内容'}
                </Text>
                <div className="notice-item-footer">
                  <Text type="tertiary" size="small">
                    {n.createByName ?? '-'} · {formatDateTime(n.publishTime)}
                  </Text>
                  {!n.isRead && (
                    <Button
                      size="small"
                      theme="borderless"
                      type="tertiary"
                      onClick={() => markAsRead(n.id)}
                    >
                      标记已读
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

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
            {renderNotices()}
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
    </div>
  );
}
