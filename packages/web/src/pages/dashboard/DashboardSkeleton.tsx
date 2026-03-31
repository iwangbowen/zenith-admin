import { Card, Skeleton } from '@douyinfe/semi-ui';
import './DashboardPage.css';

/** 首页骨架屏 — 用于 React.lazy Suspense fallback，避免看到空白 Spin */
export default function DashboardSkeleton() {
  return (
    <div className="page-container dashboard-page">
      {/* 统计卡片骨架 */}
      <div className="dashboard-stats-row">
        {(['a', 'b', 'c', 'd', 'e'] as const).map((k) => (
          <Card key={k} className="dashboard-stat-card" bodyStyle={{ padding: '16px 20px' }}>
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
        ))}
      </div>

      {/* 图表区骨架 */}
      <div className="dashboard-charts-row">
        {(['c1', 'c2', 'c3'] as const).map((k) => (
          <Card key={k} className="dashboard-card dashboard-chart-card" bodyStyle={{ padding: '12px 16px 8px' }}>
            <Skeleton active loading placeholder={
              <div>
                <Skeleton.Title style={{ width: 120, height: 14, marginBottom: 16 }} />
                <Skeleton.Paragraph rows={5} style={{ width: '100%' }} />
              </div>
            } />
          </Card>
        ))}
      </div>

      {/* 下半区骨架 */}
      <div className="dashboard-top-grid">
        <div className="dashboard-column dashboard-column--notice">
          <Card className="dashboard-card" bodyStyle={{ padding: '12px 16px' }}>
            <Skeleton active loading placeholder={
              <div>
                <Skeleton.Title style={{ width: 100, height: 14, marginBottom: 16 }} />
                {(['n1', 'n2', 'n3', 'n4'] as const).map((k) => (
                  <div key={k} style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
                    <Skeleton.Title style={{ width: '55%', height: 14, marginBottom: 8 }} />
                    <Skeleton.Paragraph rows={1} style={{ width: '85%' }} />
                  </div>
                ))}
              </div>
            } />
          </Card>
        </div>
        <div className="dashboard-column">
          <Card className="dashboard-card" bodyStyle={{ padding: '12px 16px' }}>
            <Skeleton active loading placeholder={
              <div>
                <Skeleton.Title style={{ width: 80, height: 14, marginBottom: 16 }} />
                <Skeleton.Paragraph rows={4} style={{ width: '100%' }} />
              </div>
            } />
          </Card>
        </div>
      </div>
    </div>
  );
}
