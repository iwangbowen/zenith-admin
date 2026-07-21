/** 访问统计（P4）：PV/UV 趋势、内容 TOP、来源/设备/通道分布 + 搜索分析（无结果词榜） */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Col, Row, Spin, Table, Typography, Empty, Tabs, TabPane, RadioGroup, Radio, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { SearchToolbar } from '@/components/SearchToolbar';
import { useCmsVisitStats, useCmsSearchAnalytics } from '@/hooks/queries/cms';
import type { CmsVisitStats, CmsSearchAnalytics } from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';

const DEVICE_LABELS: Record<string, string> = { pc: 'PC', mobile: '移动端', bot: '爬虫' };

function MetricCard({ label, value, delta }: { label: string; value: number; delta?: number | null }) {
  return (
    <Card bodyStyle={{ padding: '16px 20px' }}>
      <div style={{ fontSize: 13, color: 'var(--semi-color-text-2)' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {delta !== undefined && delta !== null ? (
        <div style={{ fontSize: 12, marginTop: 2, color: delta >= 0 ? 'var(--semi-color-success)' : 'var(--semi-color-danger)' }}>
          较昨日 {delta >= 0 ? '+' : ''}{delta}
        </div>
      ) : null}
    </Card>
  );
}

/** 双指标趋势柱状（PV 主柱 + UV 覆盖柱，纯 CSS 与 Dashboard 同风格） */
function TrendChart({ trend }: { trend: CmsVisitStats['trend'] }) {
  const max = Math.max(1, ...trend.map((t) => t.pv));
  if (!trend.some((t) => t.pv > 0)) return <Empty description="统计区间暂无访问" style={{ padding: '24px 0' }} />;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 150 }}>
        {trend.map((t) => (
          <div key={t.date} title={`${t.date}\nPV ${t.pv} / UV ${t.uv}`}
            style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', position: 'relative' }}>
            <div style={{ height: `${Math.max(t.pv > 0 ? 2 : 0, Math.round((t.pv / max) * 100))}%`, background: 'var(--semi-color-primary-light-active)', borderRadius: 'var(--semi-border-radius-small)', position: 'relative' }}>
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${t.pv > 0 ? Math.round((t.uv / t.pv) * 100) : 0}%`, background: 'var(--semi-color-primary)', borderRadius: 'var(--semi-border-radius-small)' }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--semi-color-text-3)', marginTop: 6 }}>
        <span>{trend[0]?.date}</span>
        <span style={{ display: 'inline-flex', gap: 12 }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--semi-color-primary-light-active)', borderRadius: 'var(--semi-border-radius-small)', marginRight: 4 }} />PV</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--semi-color-primary)', borderRadius: 'var(--semi-border-radius-small)', marginRight: 4 }} />UV</span>
        </span>
        <span>{trend[trend.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function DistBars({ items, labelOf }: { items: { key: string; pv: number }[]; labelOf?: (key: string) => string }) {
  const max = Math.max(1, ...items.map((i) => i.pv));
  if (items.length === 0) return <Empty description="暂无数据" style={{ padding: '16px 0' }} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((i) => (
        <div key={i.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelOf?.(i.key) ?? i.key}</span>
            <span style={{ color: 'var(--semi-color-text-2)', flexShrink: 0 }}>{i.pv}</span>
          </div>
          <div style={{ height: 8, background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-small)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round((i.pv / max) * 100)}%`, height: '100%', background: 'var(--semi-color-primary)', borderRadius: 'var(--semi-border-radius-small)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function VisitsTab({ siteId, days }: { siteId: number | undefined; days: number }) {
  const navigate = useNavigate();
  const statsQuery = useCmsVisitStats(siteId, days);
  const stats = statsQuery.data;

  const topColumns: ColumnProps<CmsVisitStats['topContents'][number]>[] = [
    {
      title: '标题', dataIndex: 'title',
      render: (v: string, record) => (
        <Typography.Text link ellipsis={{ showTooltip: true }} style={{ maxWidth: 320 }}
          onClick={() => navigate(`/cms/contents/edit?id=${record.contentId}&siteId=${siteId}`)}>
          {v}
        </Typography.Text>
      ),
    },
    { title: 'PV', dataIndex: 'pv', width: 90, align: 'right' },
    { title: 'UV', dataIndex: 'uv', width: 90, align: 'right' },
  ];

  return (
    <Spin spinning={statsQuery.isFetching && !stats}>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><MetricCard label="今日 PV" value={stats?.today.pv ?? 0} delta={stats ? stats.today.pv - stats.yesterday.pv : null} /></Col>
        <Col xs={12} md={6}><MetricCard label="今日 UV" value={stats?.today.uv ?? 0} delta={stats ? stats.today.uv - stats.yesterday.uv : null} /></Col>
        <Col xs={12} md={6}><MetricCard label="今日独立 IP" value={stats?.today.ips ?? 0} delta={stats ? stats.today.ips - stats.yesterday.ips : null} /></Col>
        <Col xs={12} md={6}><MetricCard label={`近 ${days} 天累计 PV`} value={stats?.totalPv ?? 0} /></Col>
      </Row>

      <Card title={`访问趋势（近 ${days} 天，不含爬虫）`} style={{ marginTop: 12 }} bodyStyle={{ padding: '16px 20px' }}>
        {stats ? <TrendChart trend={stats.trend} /> : null}
      </Card>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={14}>
          <Card title="内容访问 TOP20" bodyStyle={{ padding: 0 }}>
            <Table columns={topColumns} dataSource={stats?.topContents ?? []} rowKey="contentId" size="small" pagination={false} empty="暂无详情页访问" />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="来源域名 TOP10（外部引荐）" bodyStyle={{ padding: '16px 20px' }}>
            <DistBars items={(stats?.referrers ?? []).map((r) => ({ key: r.host, pv: r.pv }))} />
          </Card>
          <Card title="设备分布（含爬虫）" style={{ marginTop: 12 }} bodyStyle={{ padding: '16px 20px' }}>
            <DistBars items={(stats?.devices ?? []).map((d) => ({ key: d.deviceType, pv: d.pv }))} labelOf={(k) => DEVICE_LABELS[k] ?? k} />
          </Card>
          <Card title="发布通道访问对比" style={{ marginTop: 12 }} bodyStyle={{ padding: '16px 20px' }}>
            <DistBars items={(stats?.channels ?? []).map((ch) => ({ key: ch.channelCode, pv: ch.pv }))} />
          </Card>
        </Col>
      </Row>
    </Spin>
  );
}

function SearchTab({ siteId, days }: { siteId: number | undefined; days: number }) {
  const query = useCmsSearchAnalytics(siteId, days);
  const data = query.data;
  const maxTrend = Math.max(1, ...(data?.trend ?? []).map((t) => t.count));

  const topColumns: ColumnProps<CmsSearchAnalytics['topKeywords'][number]>[] = [
    { title: '关键词', dataIndex: 'keyword' },
    { title: '搜索次数', dataIndex: 'count', width: 100, align: 'right' },
    { title: '平均结果数', dataIndex: 'avgResults', width: 110, align: 'right' },
  ];
  const noResultColumns: ColumnProps<CmsSearchAnalytics['noResultKeywords'][number]>[] = [
    { title: '关键词', dataIndex: 'keyword', render: (v: string) => <span>{v} <Tag size="small" color="orange">无结果</Tag></span> },
    { title: '搜索次数', dataIndex: 'count', width: 100, align: 'right' },
  ];

  return (
    <Spin spinning={query.isFetching && !data}>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><MetricCard label={`近 ${days} 天搜索量`} value={data?.total ?? 0} /></Col>
        <Col xs={12} md={6}><MetricCard label="无结果关键词数" value={data?.noResultKeywords.length ?? 0} /></Col>
      </Row>
      <Card title={`搜索量趋势（近 ${days} 天）`} style={{ marginTop: 12 }} bodyStyle={{ padding: '16px 20px' }}>
        {data && data.trend.some((t) => t.count > 0) ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
            {data.trend.map((t) => (
              <div key={t.date} title={`${t.date}：${t.count} 次`}
                style={{ flex: 1, minWidth: 0, height: `${Math.max(t.count > 0 ? 3 : 1, Math.round((t.count / maxTrend) * 100))}%`, background: t.count > 0 ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-1)', borderRadius: 'var(--semi-border-radius-small)' }} />
            ))}
          </div>
        ) : (
          <Empty description="统计区间暂无搜索" style={{ padding: '24px 0' }} />
        )}
      </Card>
      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={12}>
          <Card title="热搜词 TOP20" bodyStyle={{ padding: 0 }}>
            <Table columns={topColumns} dataSource={data?.topKeywords ?? []} rowKey="keyword" size="small" pagination={false} empty="暂无搜索记录" />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="无结果搜索词榜（内容选题参考）" bodyStyle={{ padding: 0 }}>
            <Table columns={noResultColumns} dataSource={data?.noResultKeywords ?? []} rowKey="keyword" size="small" pagination={false} empty="暂无无结果搜索" />
          </Card>
        </Col>
      </Row>
    </Spin>
  );
}

export default function StatsPage() {
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [days, setDays] = useState(30);

  return (
    <div className="page-container page-tabs-page">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={setSiteId} width={200} />
        <RadioGroup type="button" buttonSize="small" value={days} onChange={(e) => setDays(e.target.value as number)}>
          <Radio value={7}>近 7 天</Radio>
          <Radio value={30}>近 30 天</Radio>
          <Radio value={90}>近 90 天</Radio>
        </RadioGroup>
      </SearchToolbar>
      <Tabs type="line" lazyRender>
        <TabPane tab="访问统计" itemKey="visits"><VisitsTab siteId={siteId} days={days} /></TabPane>
        <TabPane tab="搜索分析" itemKey="search"><SearchTab siteId={siteId} days={days} /></TabPane>
      </Tabs>
    </div>
  );
}
