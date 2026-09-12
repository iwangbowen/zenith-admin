import React, { useMemo } from 'react';
import { Spin } from '@douyinfe/semi-ui';
import {
  BarChart,
  LineChart,
  chartOptions,
  makeBarSpec,
  makeLineSpec,
  useChartPalette,
  StatCard,
  StatGrid,
} from '@/components/charts';
import { FileImage, Video, Music, FileText, File } from 'lucide-react';
import { useFileStats } from '@/hooks/queries/files';
import { FILE_STORAGE_PROVIDER_LABELS } from '@zenith/shared/platform';
import { DataBar } from '@/components/data-viz/DataBar';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { formatBytes } from '@zenith/shared/core';

const PROVIDER_LABELS: Record<string, string> = FILE_STORAGE_PROVIDER_LABELS;

const PROVIDER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899',
];

const FILE_TYPE_CONFIG = [
  { type: 'image',    label: '图片', Icon: FileImage, color: '#3b82f6', bgColor: 'rgba(59,130,246,0.12)' },
  { type: 'video',    label: '视频', Icon: Video,     color: '#8b5cf6', bgColor: 'rgba(139,92,246,0.12)' },
  { type: 'audio',    label: '音频', Icon: Music,     color: '#f59e0b', bgColor: 'rgba(245,158,11,0.12)' },
  { type: 'document', label: '文档', Icon: FileText,  color: '#10b981', bgColor: 'rgba(16,185,129,0.12)' },
  { type: 'other',    label: '其他', Icon: File,      color: '#6b7280', bgColor: 'rgba(107,114,128,0.12)' },
] as const;

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--semi-color-text-0)',
  marginBottom: 12,
};

export default function FileStatsPanel() {
  const palette = useChartPalette();
  const statsQuery = useFileStats();
  const stats = statsQuery.data ?? null;

  const summary = stats?.summary;
  const totalFiles = summary?.totalFiles ?? 0;
  const providerData = useMemo(
    () => (stats?.providerStats ?? []).map((p, i) => ({
      ...p,
      providerLabel: PROVIDER_LABELS[p.provider] ?? p.provider,
      fill: PROVIDER_COLORS[i % PROVIDER_COLORS.length],
    })),
    [stats],
  );
  const uploaderData = useMemo(
    () => (stats?.uploaderStats ?? []).map((u) => ({ ...u, sizeLabel: formatBytes(u.size) })),
    [stats],
  );
  const providerSpec = useMemo(() => makeBarSpec({
    data: providerData,
    xField: 'providerLabel',
    series: [{ field: 'count', name: '文件数', color: '#3b82f6' }],
    palette,
    horizontal: true,
    categoryAxisWidth: 80,
    colorByDatum: (d) => String(d?.fill),
    tooltip: { value: (v) => `${v} 个文件` },
  }), [palette, providerData]);
  const monthlySpec = useMemo(() => makeLineSpec({
    data: stats?.monthlyStats ?? [],
    xField: 'month',
    series: [{ field: 'count', name: '新增文件', color: '#3b82f6' }],
    palette,
    point: true,
    tooltip: { value: (v) => `${v} 个` },
  }), [palette, stats]);
  const sizeRangeSpec = useMemo(() => makeBarSpec({
    data: stats?.sizeRangeStats ?? [],
    xField: 'range',
    series: [{ field: 'count', name: '文件数', color: '#10b981' }],
    palette,
    tooltip: { value: (v) => `${v} 个` },
  }), [palette, stats]);
  const uploaderSpec = useMemo(() => makeBarSpec({
    data: uploaderData,
    xField: 'username',
    series: [{ field: 'count', name: '文件数', color: '#8b5cf6' }],
    palette,
    horizontal: true,
    categoryAxisWidth: 80,
    tooltip: { value: (v) => `${v} 个文件` },
  }), [palette, uploaderData]);

  return (
    <Spin spinning={statsQuery.isFetching}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* 汇总卡片 */}
        <StatGrid>
          <StatCard title="文件总数" value={totalFiles > 0 ? totalFiles.toLocaleString() : EMPTY_PLACEHOLDER} />
          <StatCard title="占用空间" value={summary ? formatBytes(summary.totalSize) : EMPTY_PLACEHOLDER} />
          <StatCard
            title="今日新增"
            value={summary?.todayCount == null ? EMPTY_PLACEHOLDER : summary.todayCount.toLocaleString()}
            sub="今日共上传"
          />
          <StatCard
            title="本月新增"
            value={summary?.thisMonthCount == null ? EMPTY_PLACEHOLDER : summary.thisMonthCount.toLocaleString()}
            sub="本月共上传"
          />
        </StatGrid>

        {/* 文件类型卡片 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: 12 }}>
          {FILE_TYPE_CONFIG.map(({ type, label, Icon, color, bgColor }) => {
            const stat = stats?.typeStats.find(t => t.type === type);
            const count = stat?.count ?? 0;
            const size = stat?.size ?? 0;
            const percent = totalFiles > 0 ? (count / totalFiles) * 100 : 0;
            return (
              <div key={type} className="zx-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* 图标 + 右侧内容 */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 'var(--semi-border-radius-large)', background: bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={19} color={color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* 类型名 + 数量同行 */}
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--semi-color-text-0)' }}>{label}</span>
                      <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--semi-color-text-0)', flexShrink: 0 }}>{count.toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--semi-color-text-2)', marginTop: 3 }}>{formatBytes(size)}</div>
                  </div>
                </div>
                {/* 进度条 */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: 'var(--semi-color-text-2)' }}>占比</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color }}>{percent.toFixed(1)}%</span>
                  </div>
                  <DataBar value={percent} max={100} color={color} height={5} />
                </div>
              </div>
            );
          })}
        </div>

        {/* 存储类型分布 + 月度上传趋势 */}
        <div className="chart-grid">
          <div className="zx-panel">
            <div style={sectionTitleStyle}>存储类型分布</div>
            <BarChart {...providerSpec} options={chartOptions} height={220} />
          </div>
          <div className="zx-panel">
            <div style={sectionTitleStyle}>月度上传趋势（近 12 个月）</div>
            <LineChart {...monthlySpec} options={chartOptions} height={220} />
          </div>
        </div>

        {/* 文件大小分布 + Top 上传人 */}
        <div className="chart-grid">
          <div className="zx-panel">
            <div style={sectionTitleStyle}>文件大小分布</div>
            <BarChart {...sizeRangeSpec} options={chartOptions} height={220} />
          </div>
          {stats && stats.uploaderStats.length > 0 && (
            <div className="zx-panel">
              <div style={sectionTitleStyle}>Top 上传人（按文件数）</div>
              <BarChart {...uploaderSpec} options={chartOptions} height={220} />
            </div>
          )}
        </div>

      </div>
    </Spin>
  );
}
