import { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Select, Spin, Tabs, TabPane, Typography, Empty, Tag, Progress, Card } from '@douyinfe/semi-ui';
import { Clock, MousePointerClick, Flame, RefreshCcw, TrendingUp, BarChart3, Target, Activity, Users, Eye, Zap } from 'lucide-react';
import { request } from '@/utils/request';
import type { PageStats, PageStatItem, FeatureStats, FeatureStatItem, HeatmapData, HeatmapPageListItem, UserStats, UserStatItem } from '@zenith/shared';
import { usePageTracker } from '@/hooks/usePageTracker';
import { ConfigurableTable } from '@/components/ConfigurableTable';

const { Text } = Typography;

// ─── Helpers ────────────────────────────────────────────────────────────────

function msToReadable(ms: number | null): string {
  if (ms == null) return '–';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

/** Returns a CSS rgba color for heatmap cells: blue(cold) → red(hot) based on 0-1 intensity */
function heatColor(intensity: number, alpha = 0.18): string {
  if (intensity <= 0.33) {
    return `rgba(79, 141, 249, ${alpha + intensity * alpha})`; // blue
  } else if (intensity <= 0.66) {
    return `rgba(245, 166, 35, ${alpha + intensity * alpha})`; // yellow-orange
  }
  return `rgba(232, 107, 107, ${alpha + intensity * alpha})`; // red
}

const DAYS_OPTIONS = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
];

// ─── Stat Card ───────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}

function StatCard({ icon, label, value, sub, color = 'var(--semi-color-primary)' }: Readonly<StatCardProps>) {
  return (
    <Card style={{ flex: '1 1 180px', minWidth: 0 }} bodyStyle={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>
          {icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <Text type="tertiary" size="small">{label}</Text>
          <div style={{ fontSize: 20, fontWeight: 700, lineHeight: '1.3', color: 'var(--semi-color-text-0)' }}>{value}</div>
          {sub && <Text type="tertiary" size="small">{sub}</Text>}
        </div>
      </div>
    </Card>
  );
}

// ─── Page Dwell Time Tab ─────────────────────────────────────────────────────

function PageDwellTab() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PageStats | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<PageStats>(`/api/analytics/page-stats?days=${days}&limit=20`);
      if (res.code === 0) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const maxAvg = Math.max(...(data?.items ?? []).map((i) => i.avgMs ?? 0), 1);
  const totalPages = data?.items.length ?? 0;
  const longestPage = data?.items[0];

  const columns = [
    {
      title: '页面',
      dataIndex: 'pagePath',
      key: 'pagePath',
      render: (_: unknown, record: PageStatItem) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
          <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{record.pageTitle ?? record.pagePath}</span>
          {record.pageTitle && <Text type="tertiary" size="small" style={{ whiteSpace: 'nowrap' }}>{record.pagePath}</Text>}
        </div>
      ),
    },
    {
      title: '访问次数',
      dataIndex: 'visits',
      key: 'visits',
      width: 100,
      render: (v: number) => <Tag color="blue" size="small">{v.toLocaleString()}</Tag>,
    },
    {
      title: '平均停留',
      dataIndex: 'avgMs',
      key: 'avgMs',
      width: 220,
      render: (v: number | null) => {
        const intensity = (v ?? 0) / maxAvg;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px', borderRadius: 4, background: heatColor(intensity) }}>
            <Progress percent={Math.round(intensity * 100)} showInfo={false} style={{ width: 70 }} size="small" />
            <Text size="small" strong>{msToReadable(v)}</Text>
          </div>
        );
      },
    },
    {
      title: '中位数',
      dataIndex: 'medianMs',
      key: 'medianMs',
      width: 100,
      render: (v: number | null) => <Text size="small">{msToReadable(v)}</Text>,
    },
    {
      title: 'P90',
      dataIndex: 'p90Ms',
      key: 'p90Ms',
      width: 100,
      render: (v: number | null) => <Text size="small">{msToReadable(v)}</Text>,
    },
  ];

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard icon={<Clock size={18} />} label="总访问次数" value={(data?.totalVisits ?? 0).toLocaleString()} sub={`${totalPages} 个页面`} />
        <StatCard icon={<TrendingUp size={18} />} label="最长停留页面" value={longestPage ? msToReadable(longestPage.avgMs) : '–'} sub={longestPage?.pageTitle ?? longestPage?.pagePath ?? '暂无数据'} color="var(--semi-color-success)" />
        <StatCard icon={<BarChart3 size={18} />} label="整体均值" value={data ? msToReadable(Math.round(data.items.reduce((s, i) => s + (i.avgMs ?? 0), 0) / Math.max(data.items.length, 1))) : '–'} sub="各页面平均停留时长均值" color="var(--semi-color-warning)" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Select value={days} onChange={(v) => setDays(v as number)} style={{ width: 120 }}>
          {DAYS_OPTIONS.map((o) => <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>)}
        </Select>
      </div>
      <ConfigurableTable
        columns={columns}
        dataSource={data?.items ?? []}
        loading={loading}
        rowKey="pagePath"
        bordered
        empty={<Empty description="暂无停留时长数据" style={{ padding: 60 }} />}
        pagination={false}
        onRefresh={load}
        refreshLoading={loading}
      />
    </div>
  );
}

// ─── Feature Usage Tab ──────────────────────────────────────────────────────

function FeatureUsageTab() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FeatureStats | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<FeatureStats>(`/api/analytics/feature-stats?days=${days}&limit=30`);
      if (res.code === 0) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const maxCount = Math.max(...(data?.items ?? []).map((i) => i.count), 1);
  const topFeature = data?.items[0];

  const columns = [
    {
      title: '排名',
      key: 'rank',
      width: 80,
      render: (_: unknown, __: unknown, index: number) => (
        <Text type={index < 3 ? 'warning' : 'tertiary'} strong={index < 3}>{index + 1}</Text>
      ),
    },
    {
      title: '功能名称',
      dataIndex: 'elementKey',
      key: 'elementKey',
      render: (_: unknown, record: FeatureStatItem) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
          <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{record.elementLabel ?? record.elementKey}</span>
          {record.elementLabel && <Text type="tertiary" size="small" style={{ whiteSpace: 'nowrap' }}>{record.elementKey}</Text>}
        </div>
      ),
    },
    {
      title: 'UI 区域',
      dataIndex: 'componentArea',
      key: 'componentArea',
      width: 140,
      render: (v: string | null) => v ? <Tag size="small">{v}</Tag> : <Text type="tertiary">–</Text>,
    },
    {
      title: '所在页面',
      dataIndex: 'pagePath',
      key: 'pagePath',
      width: 200,
      render: (v: string) => <Text size="small" type="tertiary">{v}</Text>,
    },
    {
      title: '使用次数',
      dataIndex: 'count',
      key: 'count',
      width: 220,
      render: (v: number) => {
        const intensity = v / maxCount;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px', borderRadius: 4, background: heatColor(intensity) }}>
            <Progress percent={Math.round(intensity * 100)} showInfo={false} style={{ width: 70 }} size="small" stroke="var(--semi-color-success)" />
            <Text strong>{v.toLocaleString()}</Text>
            <Text type="tertiary" size="small">次</Text>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard icon={<MousePointerClick size={18} />} label="总操作次数" value={(data?.totalEvents ?? 0).toLocaleString()} sub={`${data?.items.length ?? 0} 个功能`} />
        <StatCard icon={<Target size={18} />} label="最高频功能" value={topFeature ? (topFeature.elementLabel ?? topFeature.elementKey) : '–'} sub={topFeature ? `${topFeature.count.toLocaleString()} 次` : '暂无数据'} color="var(--semi-color-success)" />
        <StatCard icon={<Activity size={18} />} label="功能人均使用" value={data && data.items.length > 0 ? `${Math.round(data.totalEvents / data.items.length)} 次` : '–'} sub="每个功能平均被使用次数" color="var(--semi-color-warning)" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Select value={days} onChange={(v) => setDays(v as number)} style={{ width: 120 }}>
          {DAYS_OPTIONS.map((o) => <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>)}
        </Select>
      </div>
      <ConfigurableTable
        columns={columns}
        dataSource={data?.items ?? []}
        loading={loading}
        rowKey={(r) => `${r?.pagePath}_${r?.elementKey}`}
        bordered
        empty={<Empty description="暂无功能使用数据" style={{ padding: 60 }} />}
        pagination={false}
        onRefresh={load}
        refreshLoading={loading}
      />
    </div>
  );
}

// ─── Heatmap Canvas ─────────────────────────────────────────────────────────

function HeatmapCanvas({ data }: Readonly<{ data: HeatmapData }>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.points.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const maxValue = Math.max(...data.points.map((p) => p.value), 1);

    for (const point of data.points) {
      const px = (point.x / 100) * W;
      const py = (point.y / 100) * H;
      const intensity = point.value / maxValue;
      const radius = Math.max(18, Math.min(40, 18 + intensity * 22));

      const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius);
      gradient.addColorStop(0, `rgba(255, ${Math.floor(20 + (1 - intensity) * 200)}, 0, ${0.12 + intensity * 0.45})`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [data]);

  if (data.points.length === 0) {
    return <Empty description="该区域暂无点击数据" style={{ padding: 40 }} />;
  }

  return (
    <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ width: '100%', paddingBottom: '45%', background: 'var(--semi-color-fill-0)', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={800}
          height={360}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
      </div>
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--semi-color-border)' }}>
        <Text size="small" type="tertiary">
          {data.total.toLocaleString()} 次点击 · 页面：{data.pagePath} · 区域：{data.componentArea}
        </Text>
      </div>
    </div>
  );
}

// ─── Heatmap Tab ─────────────────────────────────────────────────────────────

function HeatmapTab() {
  const [days, setDays] = useState(30);
  const [pages, setPages] = useState<HeatmapPageListItem[]>([]);
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);

  const loadPages = useCallback(async () => {
    setPagesLoading(true);
    try {
      const res = await request.get<{ pages: HeatmapPageListItem[] }>(`/api/analytics/heatmap-pages?days=${days}`, { silent: true });
      if (res.code === 0) {
        setPages(res.data?.pages ?? []);
        setSelectedPage(null);
        setSelectedArea(null);
        setHeatmapData(null);
      }
    } finally {
      setPagesLoading(false);
    }
  }, [days]);

  useEffect(() => { void loadPages(); }, [loadPages]);

  const currentPageAreas = pages.find((p) => p.pagePath === selectedPage)?.areas ?? [];

  const loadHeatmap = useCallback(async () => {
    if (!selectedPage || !selectedArea) return;
    setLoading(true);
    try {
      const res = await request.get<HeatmapData>(
        `/api/analytics/heatmap?pagePath=${encodeURIComponent(selectedPage)}&componentArea=${encodeURIComponent(selectedArea)}&days=${days}`,
      );
      if (res.code === 0) setHeatmapData(res.data);
    } finally {
      setLoading(false);
    }
  }, [selectedPage, selectedArea, days]);

  useEffect(() => { void loadHeatmap(); }, [loadHeatmap]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Select value={days} onChange={(v) => setDays(v as number)} style={{ width: 120 }}>
          {DAYS_OPTIONS.map((o) => <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>)}
        </Select>
        <Select
          value={selectedPage ?? undefined}
          onChange={(v) => { setSelectedPage(v as string); setSelectedArea(null); }}
          placeholder="选择页面"
          style={{ width: 220 }}
          loading={pagesLoading}
          showClear
        >
          {pages.map((p) => (
            <Select.Option key={p.pagePath} value={p.pagePath}>
              {p.pageTitle ?? p.pagePath}
            </Select.Option>
          ))}
        </Select>
        {selectedPage && (
          <Select
            value={selectedArea ?? undefined}
            onChange={(v) => setSelectedArea(v as string)}
            placeholder="选择区域"
            style={{ width: 160 }}
            showClear
          >
            {currentPageAreas.map((area) => (
              <Select.Option key={area} value={area}>{area}</Select.Option>
            ))}
          </Select>
        )}
        <Button icon={<RefreshCcw size={14} />} onClick={loadPages} loading={pagesLoading}>刷新</Button>
      </div>

      {pages.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {pages.map((p) => (
            <div
              key={p.pagePath}
              style={{ flex: '0 0 auto', cursor: 'pointer' }}
              onClick={() => { setSelectedPage(p.pagePath); setSelectedArea(null); }}
            >
              <Card
                style={{ border: selectedPage === p.pagePath ? '1px solid var(--semi-color-primary)' : undefined }}
                bodyStyle={{ padding: '8px 14px' }}
              >
                <Text strong size="small">{p.pageTitle ?? p.pagePath}</Text>
                <div>
                  {p.areas.map((area) => (
                    <Tag
                      key={area}
                      size="small"
                      color={selectedPage === p.pagePath && selectedArea === area ? 'blue' : 'grey'}
                      style={{ marginRight: 4, marginTop: 4, cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); setSelectedPage(p.pagePath); setSelectedArea(area); }}
                    >
                      {area}
                    </Tag>
                  ))}
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      <Spin spinning={loading}>
        {(!selectedPage || !selectedArea) && (
          <Empty
            description={pages.length === 0 ? '暂无热力图数据，请先在页面中接入区域点击追踪' : '请在上方选择页面和区域'}
            style={{ padding: 60 }}
          />
        )}
        {selectedPage && selectedArea && heatmapData && <HeatmapCanvas data={heatmapData} />}
      </Spin>
    </div>
  );
}

// ─── User Stats Tab ──────────────────────────────────────────────────────────

function UserStatsTab() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<UserStats | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<UserStats>(`/api/analytics/user-stats?days=${days}&limit=20`);
      if (res.code === 0) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const maxEvents = Math.max(...(data?.items ?? []).map((i) => i.totalEvents), 1);
  const topUser = data?.items[0];

  const columns = [
    {
      title: '排名',
      key: 'rank',
      width: 70,
      render: (_: unknown, __: unknown, index: number) => (
        <Text type={index < 3 ? 'warning' : 'tertiary'} strong={index < 3}>{index + 1}</Text>
      ),
    },
    {
      title: '用户',
      dataIndex: 'username',
      key: 'username',
      render: (v: string | null) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--semi-color-primary-light-default)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--semi-color-primary)', flexShrink: 0 }}>
            {(v ?? '?')[0]?.toUpperCase()}
          </div>
          <Text strong>{v ?? '未知用户'}</Text>
        </div>
      ),
    },
    {
      title: '总操作次数',
      dataIndex: 'totalEvents',
      key: 'totalEvents',
      width: 220,
      render: (v: number) => {
        const intensity = v / maxEvents;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px', borderRadius: 4, background: heatColor(intensity) }}>
            <Progress percent={Math.round(intensity * 100)} showInfo={false} style={{ width: 70 }} size="small" />
            <Text strong>{v.toLocaleString()}</Text>
          </div>
        );
      },
    },
    {
      title: '页面访问',
      dataIndex: 'pageViews',
      key: 'pageViews',
      width: 100,
      render: (v: number) => <Tag color="blue" size="small">{v.toLocaleString()}</Tag>,
    },
    {
      title: '访问页面数',
      dataIndex: 'uniquePages',
      key: 'uniquePages',
      width: 120,
      render: (v: number) => <Tag color="teal" size="small">{v}</Tag>,
    },
    {
      title: '功能使用',
      dataIndex: 'featureUses',
      key: 'featureUses',
      width: 100,
      render: (v: number) => <Tag color="green" size="small">{v.toLocaleString()}</Tag>,
    },
    {
      title: '总停留时长',
      dataIndex: 'totalDwellMs',
      key: 'totalDwellMs',
      width: 120,
      render: (v: number | null) => <Text size="small">{msToReadable(v)}</Text>,
    },
    {
      title: '最近活跃',
      dataIndex: 'lastActiveAt',
      key: 'lastActiveAt',
      width: 160,
      render: (v: string | null) => <Text size="small" type="tertiary">{v ?? '–'}</Text>,
    },
  ];

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard icon={<Users size={18} />} label="活跃用户数" value={(data?.totalUsers ?? 0).toLocaleString()} sub={`近 ${days} 天有操作记录`} />
        <StatCard icon={<Zap size={18} />} label="最活跃用户" value={topUser?.username ?? '–'} sub={topUser ? `${topUser.totalEvents.toLocaleString()} 次操作` : '暂无数据'} color="var(--semi-color-success)" />
        <StatCard icon={<Eye size={18} />} label="用户均访问页面" value={data && data.items.length > 0 ? `${Math.round(data.items.reduce((s, i) => s + i.uniquePages, 0) / data.items.length)}` : '–'} sub="个不同页面（平均）" color="var(--semi-color-warning)" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Select value={days} onChange={(v) => setDays(v as number)} style={{ width: 120 }}>
          {DAYS_OPTIONS.map((o) => <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>)}
        </Select>
      </div>
      <ConfigurableTable
        columns={columns}
        dataSource={data?.items ?? []}
        loading={loading}
        rowKey={(r) => String(r?.userId ?? r?.username ?? 'unknown')}
        bordered
        empty={<Empty description="暂无用户行为数据" style={{ padding: 60 }} />}
        pagination={false}
        onRefresh={load}
        refreshLoading={loading}
      />
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  usePageTracker('行为分析');

  return (
    <div className="page-container">
      <Tabs type="line" defaultActiveKey="dwell">
        <TabPane
          tab={<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={14} />页面停留时长</span>}
          itemKey="dwell"
        >
          <div style={{ paddingTop: 16 }}>
            <PageDwellTab />
          </div>
        </TabPane>
        <TabPane
          tab={<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MousePointerClick size={14} />功能使用频率</span>}
          itemKey="feature"
        >
          <div style={{ paddingTop: 16 }}>
            <FeatureUsageTab />
          </div>
        </TabPane>
        <TabPane
          tab={<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Flame size={14} />点击热力图</span>}
          itemKey="heatmap"
        >
          <div style={{ paddingTop: 16 }}>
            <HeatmapTab />
          </div>
        </TabPane>
        <TabPane
          tab={<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Users size={14} />用户分析</span>}
          itemKey="users"
        >
          <div style={{ paddingTop: 16 }}>
            <UserStatsTab />
          </div>
        </TabPane>
      </Tabs>
    </div>
  );
}
