import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Col, Row, Spin, Table, Typography, Empty } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { SearchToolbar } from '@/components/SearchToolbar';
import { useCmsDashboardStats } from '@/hooks/queries/cms';
import { CmsSiteSelect } from './CmsSiteSelect';

const STAT_CARDS: { key: 'published' | 'draft' | 'pending' | 'offline' | 'rejected' | 'recycled'; label: string; color: string }[] = [
  { key: 'published', label: '已发布', color: 'var(--semi-color-success)' },
  { key: 'draft', label: '草稿', color: 'var(--semi-color-text-2)' },
  { key: 'pending', label: '待审核', color: 'var(--semi-color-warning)' },
  { key: 'offline', label: '已下线', color: 'var(--semi-color-tertiary)' },
  { key: 'rejected', label: '已驳回', color: 'var(--semi-color-danger)' },
  { key: 'recycled', label: '回收站', color: 'var(--semi-color-text-3)' },
];

export default function CmsDashboardPage() {
  const navigate = useNavigate();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const statsQuery = useCmsDashboardStats(siteId);
  const stats = statsQuery.data;

  const maxTrend = Math.max(1, ...(stats?.publishTrend ?? []).map((t) => t.count));
  const maxChannel = Math.max(1, ...(stats?.channelDistribution ?? []).map((c) => c.count));

  const topColumns: ColumnProps<NonNullable<typeof stats>['topViewed'][number]>[] = [
    {
      title: '标题',
      dataIndex: 'title',
      render: (v: string, record) => (
        <Typography.Text
          link
          ellipsis={{ showTooltip: true }}
          style={{ maxWidth: 300 }}
          onClick={() => navigate(`/cms/contents/edit?id=${record.id}&siteId=${siteId}`)}
        >
          {v}
        </Typography.Text>
      ),
    },
    { title: '栏目', dataIndex: 'channelName', width: 140, render: (v: string | null) => v ?? '-' },
    { title: '浏览量', dataIndex: 'viewCount', width: 100, align: 'right' },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={setSiteId} width={200} />
      </SearchToolbar>

      <Spin spinning={statsQuery.isFetching && !stats}>
        {/* 状态统计卡片 */}
        <Row gutter={[12, 12]}>
          {STAT_CARDS.map((card) => (
            <Col key={card.key} xs={12} md={8} xl={4}>
              <Card bodyStyle={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 13, color: 'var(--semi-color-text-2)' }}>{card.label}</div>
                <div style={{ fontSize: 26, fontWeight: 600, color: card.color, marginTop: 4 }}>
                  {stats?.totals[card.key] ?? 0}
                </div>
              </Card>
            </Col>
          ))}
        </Row>

        <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
          <Col xs={12} md={8}>
            <Card bodyStyle={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--semi-color-text-2)' }}>今日发布</div>
              <div style={{ fontSize: 26, fontWeight: 600, marginTop: 4 }}>{stats?.todayPublished ?? 0}</div>
            </Card>
          </Col>
          <Col xs={12} md={8}>
            <Card bodyStyle={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--semi-color-text-2)' }}>累计浏览量</div>
              <div style={{ fontSize: 26, fontWeight: 600, marginTop: 4 }}>{stats?.totalViews ?? 0}</div>
            </Card>
          </Col>
          <Col xs={12} md={8}>
            <Card bodyStyle={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--semi-color-text-2)' }}>待审核评论</div>
              <div style={{ fontSize: 26, fontWeight: 600, color: stats?.pendingComments ? 'var(--semi-color-warning)' : undefined, marginTop: 4 }}>
                {stats?.pendingComments ?? 0}
              </div>
            </Card>
          </Col>
        </Row>

        {/* 发布趋势（近 14 天） */}
        <Card title="发布趋势（近 14 天）" style={{ marginTop: 12 }} bodyStyle={{ padding: '16px 20px' }}>
          {stats && stats.publishTrend.some((t) => t.count > 0) ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
              {stats.publishTrend.map((t) => (
                <div key={t.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: 'var(--semi-color-text-2)' }}>{t.count > 0 ? t.count : ''}</span>
                  <div
                    title={`${t.date}：${t.count} 篇`}
                    style={{
                      width: '60%',
                      height: `${Math.max(2, Math.round((t.count / maxTrend) * 100))}px`,
                      background: t.count > 0 ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-1)',
                      borderRadius: 3,
                    }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--semi-color-text-3)', whiteSpace: 'nowrap' }}>{t.date.slice(5)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="近 14 天暂无发布" style={{ padding: '24px 0' }} />
          )}
        </Card>

        <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
          <Col xs={24} lg={14}>
            <Card title="热门内容 TOP10（按浏览量）" bodyStyle={{ padding: 0 }}>
              <Table
                columns={topColumns}
                dataSource={stats?.topViewed ?? []}
                rowKey="id"
                size="small"
                pagination={false}
                empty="暂无已发布内容"
              />
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card title="栏目内容分布 TOP10" bodyStyle={{ padding: '16px 20px' }}>
              {stats && stats.channelDistribution.length > 0 ? (
                stats.channelDistribution.map((ch) => (
                  <div key={ch.channelId} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span>{ch.channelName}</span>
                      <span style={{ color: 'var(--semi-color-text-2)' }}>{ch.count}</span>
                    </div>
                    <div style={{ height: 8, background: 'var(--semi-color-fill-0)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.round((ch.count / maxChannel) * 100)}%`, height: '100%', background: 'var(--semi-color-primary)', borderRadius: 4 }} />
                    </div>
                  </div>
                ))
              ) : (
                <Empty description="暂无内容" style={{ padding: '24px 0' }} />
              )}
            </Card>
          </Col>
        </Row>
      </Spin>
    </div>
  );
}
