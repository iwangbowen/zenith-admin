import { Skeleton } from '@douyinfe/semi-ui';
import './DashboardPage.css';

/** 首页骨架屏 — 用于 React.lazy Suspense fallback，避免看到空白 Spin */
export default function DashboardSkeleton() {
  return (
    <div className="page-container dashboard-page">
      <section className="dashboard-welcome-section">
        <Skeleton active loading placeholder={
          <div className="dashboard-welcome-skeleton">
            <Skeleton.Avatar style={{ width: 48, height: 48, borderRadius: '50%' }} />
            <div style={{ flex: 1 }}>
              <Skeleton.Title style={{ width: 180, height: 18, marginBottom: 8 }} />
              <Skeleton.Paragraph rows={1} style={{ width: 260 }} />
            </div>
          </div>
        } />
      </section>

      <div className="dashboard-stats-row">
        {(['a', 'b', 'c', 'd', 'e'] as const).map((k) => (
          <div key={k} className="dashboard-stat-item">
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
        ))}
      </div>

      <div className="dashboard-charts-row">
        {(['c1', 'c2', 'c3'] as const).map((k) => (
          <section key={k} className="dashboard-chart-section">
            <Skeleton active loading placeholder={
              <div>
                <Skeleton.Title style={{ width: 120, height: 14, marginBottom: 16 }} />
                <Skeleton.Paragraph rows={5} style={{ width: '100%' }} />
              </div>
            } />
          </section>
        ))}
      </div>

      <section className="dashboard-section dashboard-section--notice">
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
      </section>
    </div>
  );
}
