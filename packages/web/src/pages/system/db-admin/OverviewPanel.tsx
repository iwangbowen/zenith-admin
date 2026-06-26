import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Spin, Typography, Tag, Space } from '@douyinfe/semi-ui';
import { BarChart, chartOptions, makeBarSpec, useChartPalette, datumNumber, datumText } from '@/components/charts';
import { RefreshCw, Database, Table as TableIcon, Eye, KeyRound, Network, Activity, HardDrive, Server } from 'lucide-react';
import { request } from '@/utils/request';

const { Text } = Typography;

export interface OverviewTopTable {
  schema: string;
  name: string;
  sizeBytes: number;
  sizeText: string;
  rowEstimate: number;
}

export interface DbOverview {
  version: string;
  databaseName: string;
  databaseSize: number;
  databaseSizeText: string;
  schemaCount: number;
  tableCount: number;
  viewCount: number;
  indexCount: number;
  totalRowEstimate: number;
  activeConnections: number;
  maxConnections: number;
  startedAt: string | null;
  uptimeSeconds: number;
  topTables: OverviewTopTable[];
}

const BAR_COLORS = ['#3b82f6', '#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1', '#84cc16'];

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d} 天`);
  if (h > 0) parts.push(`${h} 小时`);
  if (m > 0 && d === 0) parts.push(`${m} 分`);
  return parts.join(' ') || '< 1 分';
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}

function StatCard({ icon, label, value, sub, accent }: Readonly<StatCardProps>) {
  return (
    <div
      style={{
        background: 'var(--semi-color-bg-1)',
        border: '1px solid var(--semi-color-border)',
        borderRadius: 8,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 92,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: accent ?? 'var(--semi-color-primary)' }}>
        {icon}
        <Text type="tertiary" size="small">{label}</Text>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--semi-color-text-0)', lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', minHeight: 16 }}>{sub ?? ''}</div>
    </div>
  );
}

export function OverviewPanel({ onSelectTable }: Readonly<{ onSelectTable?: (schema: string, name: string) => void }>) {
  const [data, setData] = useState<DbOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const palette = useChartPalette();

  const load = useCallback(async () => {
    setLoading(true);
    const res = await request.get<DbOverview>('/api/db-admin/overview');
    if (res.code === 0 && res.data) setData(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const chartData = (data?.topTables ?? []).map((t, i) => ({
    label: t.name,
    full: `${t.schema}.${t.name}`,
    sizeMB: Number((t.sizeBytes / 1024 / 1024).toFixed(2)),
    sizeText: t.sizeText,
    rowEstimate: t.rowEstimate,
    __fill: BAR_COLORS[i % BAR_COLORS.length],
  }));

  const tableSpec = makeBarSpec({
    data: chartData,
    xField: 'label',
    series: [{ field: 'sizeMB', name: '大小', color: BAR_COLORS[0] }],
    palette,
    horizontal: true,
    categoryAxisWidth: 140,
    colorByDatum: (d) => datumText(d, '__fill') || BAR_COLORS[0],
    axis: { xLabel: (v) => `${v} MB` },
    tooltip: { value: (_v, _name, d) => `${datumText(d, 'sizeText')} · 约 ${datumNumber(d, 'rowEstimate').toLocaleString()} 行` },
  });

  function handleBarClick(full?: string) {
    if (full && onSelectTable) {
      const [s, n] = full.split('.');
      onSelectTable(s, n);
    }
  }

  const connPercent = data && data.maxConnections > 0
    ? Math.round((data.activeConnections / data.maxConnections) * 100)
    : 0;

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 4 }}>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<RefreshCw size={14} />} onClick={() => void load()} loading={loading}>刷新</Button>
        {data && (
          <Text type="tertiary" size="small">
            <Server size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            {data.databaseName} · PostgreSQL {data.version} · 已运行 {formatUptime(data.uptimeSeconds)}
            {data.startedAt ? `（自 ${data.startedAt}）` : ''}
          </Text>
        )}
      </Space>

      {!data && loading && <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>}
      {!data && !loading && <Empty title="暂无数据" />}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
            <StatCard icon={<HardDrive size={15} />} label="数据库大小" value={data.databaseSizeText} accent="#3b82f6" />
            <StatCard icon={<TableIcon size={15} />} label="表" value={data.tableCount} sub={`约 ${data.totalRowEstimate.toLocaleString()} 行`} accent="#10b981" />
            <StatCard icon={<Eye size={15} />} label="视图 / 物化视图" value={data.viewCount} accent="#8b5cf6" />
            <StatCard icon={<KeyRound size={15} />} label="索引" value={data.indexCount} accent="#f59e0b" />
            <StatCard icon={<Network size={15} />} label="Schema" value={data.schemaCount} accent="#06b6d4" />
            <StatCard
              icon={<Activity size={15} />}
              label="活动连接"
              value={`${data.activeConnections} / ${data.maxConnections}`}
              sub={`占用 ${connPercent}%`}
              accent={connPercent > 80 ? '#ef4444' : '#14b8a6'}
            />
          </div>

          <div
            style={{
              background: 'var(--semi-color-bg-1)',
              border: '1px solid var(--semi-color-border)',
              borderRadius: 8,
              padding: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Database size={15} style={{ color: 'var(--semi-color-primary)' }} />
              <Text strong>占用空间 Top {chartData.length} 表</Text>
            </div>
            {chartData.length === 0 ? (
              <Empty title="无数据" />
            ) : (
              <BarChart
                {...tableSpec}
                options={chartOptions}
                height={Math.max(220, chartData.length * 34)}
                onClick={(e) => handleBarClick((e?.datum as { full?: string } | undefined)?.full)}
              />
            )}
            <div style={{ marginTop: 8 }}>
              <Text type="tertiary" size="small">提示：点击柱状图或纵轴标签可跳转到对应表</Text>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

OverviewPanel.displayName = 'OverviewPanel';

export function KindTag({ kind }: Readonly<{ kind: 'table' | 'view' | 'matview' }>) {
  if (kind === 'view') return <Tag size="small" color="violet">视图</Tag>;
  if (kind === 'matview') return <Tag size="small" color="purple">物化视图</Tag>;
  return <Tag size="small" color="blue">表</Tag>;
}
