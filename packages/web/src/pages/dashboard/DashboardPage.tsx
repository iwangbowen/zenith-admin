import { Card, Row, Col, Typography, Descriptions, Tag, Space } from '@douyinfe/semi-ui';
import { User, Check, Clock, Activity } from 'lucide-react';
import './DashboardPage.css';

const { Title, Text, Paragraph } = Typography;

const stats = [
  { label: '总用户数', value: '1,286', icon: <User style={{ color: '#3370ff' }} />, bg: '#ebf1ff' },
  { label: '今日活跃', value: '368', icon: <Activity style={{ color: '#0fc6c2' }} />, bg: '#e6f7f6' },
  { label: '今日新增', value: '28', icon: <Check style={{ color: '#21b550' }} />, bg: '#e8f8ec' },
  { label: '本周登录', value: '892', icon: <Clock style={{ color: '#f5a623' }} />, bg: '#fef6e6' },
];

const recentActivities = [
  { user: '张三', action: '登录了系统', time: '2 分钟前' },
  { user: '李四', action: '修改了个人信息', time: '15 分钟前' },
  { user: '王五', action: '创建了新用户', time: '1 小时前' },
  { user: '赵六', action: '导出了用户列表', time: '2 小时前' },
  { user: '管理员', action: '更新了系统配置', time: '3 小时前' },
];

export default function DashboardPage() {
  return (
    <div className="page-container">
      <div className="page-header">
        <Title heading={4} style={{ fontWeight: 600, margin: 0 }}>
          工作台
        </Title>
        <Text type="tertiary" size="small">
          欢迎使用 Zenith Admin
        </Text>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {stats.map((s) => (
          <Col key={s.label} span={6}>
            <Card
              className="dashboard-stat-card"
              bodyStyle={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}
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
                  fontSize: 18,
                }}
              >
                {s.icon}
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                  {s.label}
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={16}>
        <Col span={16}>
          <Card
            title={<Text strong style={{ fontSize: 14 }}>最近动态</Text>}
            className="dashboard-card"
            bodyStyle={{ padding: 0 }}
          >
            <div className="activity-list">
              {recentActivities.map((a, i) => (
                <div key={i} className="activity-item">
                  <div className="activity-dot" />
                  <div style={{ flex: 1 }}>
                    <Text strong style={{ fontSize: 13 }}>{a.user}</Text>
                    <Text type="tertiary" style={{ fontSize: 13, marginLeft: 6 }}>{a.action}</Text>
                  </div>
                  <Text type="tertiary" size="small">{a.time}</Text>
                </div>
              ))}
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card
            title={<Text strong style={{ fontSize: 14 }}>系统信息</Text>}
            className="dashboard-card"
          >
            <Descriptions
              size="small"
              row
              data={[
                { key: '版本', value: 'v0.1.0' },
                { key: '框架', value: 'React 19 + Hono' },
                { key: 'UI 库', value: 'Semi Design' },
                { key: '数据库', value: 'PostgreSQL' },
              ]}
              style={{ fontSize: 13 }}
            />
            <div style={{ marginTop: 12 }}>
              <Space>
                <Tag color="blue" size="small">TypeScript</Tag>
                <Tag color="cyan" size="small">Vite</Tag>
                <Tag color="green" size="small">Drizzle</Tag>
                <Tag color="violet" size="small">Monorepo</Tag>
              </Space>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
