/** 用户留存：按首访周期形成 cohort 的留存热力表，支持日 / 周 / 月粒度、两种首访口径与分群对比下钻 */
import { useState } from 'react';
import { Card, Empty, Select, Typography } from '@douyinfe/semi-ui';
import { useAnalyticsRetention } from '@/hooks/queries/analytics';
import type { AnalyticsComparison, AnalyticsRetentionMode, AnalyticsRetentionPeriodType } from '@zenith/shared/analytics';
import { ANALYTICS_RETENTION_MODE_OPTIONS, ANALYTICS_RETENTION_PERIOD_LIMITS, ANALYTICS_RETENTION_PERIOD_TYPE_OPTIONS, ANALYTICS_RETENTION_PERIOD_UNIT_LABELS } from '@zenith/shared/analytics';
import { ComparisonPicker, DrillUsersSheet, isComparisonReady, useDrillSheet } from './AnalyticsComparison';
import { numberText, sectionStyle } from './analytics-format';
import { ChartPlaceholder, SectionHeader } from './analytics-shared';

const RETENTION_DAYS_OPTIONS: Record<AnalyticsRetentionPeriodType, Array<{ label: string; value: number }>> = {
  day: [
    { label: '近 7 天', value: 7 },
    { label: '近 14 天', value: 14 },
    { label: '近 30 天', value: 30 },
    { label: '近 60 天', value: 60 },
    { label: '近 90 天', value: 90 },
  ],
  week: [
    { label: '近 8 周', value: 56 },
    { label: '近 12 周', value: 84 },
    { label: '近 26 周', value: 182 },
    { label: '近 52 周', value: 365 },
  ],
  month: [
    { label: '近 6 个月', value: 183 },
    { label: '近 12 个月', value: 365 },
    { label: '近 24 个月', value: 730 },
  ],
};

/** 周期列数候选：上限随粒度收敛，避免月留存出现 30 列空白 */
function retentionPeriodOptions(periodType: AnalyticsRetentionPeriodType): Array<{ label: string; value: number }> {
  const unit = ANALYTICS_RETENTION_PERIOD_UNIT_LABELS[periodType];
  const { maxPeriods } = ANALYTICS_RETENTION_PERIOD_LIMITS[periodType];
  return [4, 6, 8, 12, 16, 24, 30]
    .filter((n) => n <= maxPeriods)
    .map((n) => ({ label: `${n} 个${unit}周期`, value: n }));
}

export default function AnalyticsRetentionTab() {
  const [periodType, setPeriodType] = useState<AnalyticsRetentionPeriodType>('day');
  const [days, setDays] = useState(ANALYTICS_RETENTION_PERIOD_LIMITS.day.defaultDays);
  const [maxPeriods, setMaxPeriods] = useState(ANALYTICS_RETENTION_PERIOD_LIMITS.day.defaultPeriods);
  const [mode, setMode] = useState<AnalyticsRetentionMode>('first_seen');
  const [comparison, setComparison] = useState<AnalyticsComparison>({ type: 'none' });
  const drill = useDrillSheet();
  // 分群对比未选分群时不发请求：请求体过不了 schema 校验，只会白白拿一个 400
  const effectiveComparison = isComparisonReady(comparison) ? comparison : { type: 'none' as const };
  const retentionQuery = useAnalyticsRetention({ days, mode, periodType, maxPeriods, comparison: effectiveComparison });
  const data = retentionQuery.data ?? null;
  const loading = retentionQuery.isFetching;

  // 切换粒度时回溯窗口与列数必须一起改：60 天窗口配月留存只有 2 个队列，12 列全是空的
  const handlePeriodTypeChange = (next: AnalyticsRetentionPeriodType) => {
    setPeriodType(next);
    setDays(ANALYTICS_RETENTION_PERIOD_LIMITS[next].defaultDays);
    setMaxPeriods(ANALYTICS_RETENTION_PERIOD_LIMITS[next].defaultPeriods);
  };

  const periodUnit = ANALYTICS_RETENTION_PERIOD_UNIT_LABELS[periodType];
  const series = data?.series ?? [];
  // 色阶基准取全部序列的最大值，多序列之间颜色深浅才可直接横向比较
  const periodMax = series.length
    ? Math.max(1, ...series.flatMap((s) => s.cohorts.flatMap((c) => c.values.filter((v): v is number => v != null))))
    : 100;

  const openDrill = (seriesKey: string, seriesLabel: string, cohortDate: string, periodIndex: number, outcome: 'retained' | 'churned') => {
    drill.open(
      { type: 'retention', days, mode, periodType, comparison: effectiveComparison, seriesKey, cohortDate, periodIndex, outcome },
      `${cohortDate} 队列 · 第 ${periodIndex} ${periodUnit} · ${outcome === 'retained' ? '回访用户' : '未回访用户'}`,
      effectiveComparison.type === 'none' ? undefined : `对比序列：${seriesLabel}`,
    );
  };

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="用户留存"
        description="按首访周期形成 cohort，单元格颜色越深表示留存率越高；点击单元格可下钻到具体用户"
        extra={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Select
              value={periodType}
              optionList={ANALYTICS_RETENTION_PERIOD_TYPE_OPTIONS}
              onChange={(v) => handlePeriodTypeChange(v as AnalyticsRetentionPeriodType)}
              style={{ width: 120 }}
            />
            <Select
              value={mode}
              optionList={ANALYTICS_RETENTION_MODE_OPTIONS}
              onChange={(v) => setMode(v as AnalyticsRetentionMode)}
              style={{ width: 160 }}
            />
            <Select value={days} optionList={RETENTION_DAYS_OPTIONS[periodType]} onChange={(v) => setDays(Number(v))} style={{ width: 130 }} />
            <Select value={maxPeriods} optionList={retentionPeriodOptions(periodType)} onChange={(v) => setMaxPeriods(Number(v))} style={{ width: 140 }} />
            <ComparisonPicker value={comparison} onChange={setComparison} />
          </div>
        )}
      />
      <Typography.Text type="tertiary" size="small">
        {mode === 'first_seen'
          ? '真实首访口径：按用户全历史首次出现周期分组，仅展示首访周期落在统计区间内的 cohort'
          : '窗口首现口径：按当前统计窗口内首次出现周期分组（与旧版行为一致）'}
      </Typography.Text>
      {loading && !data ? <Card bodyStyle={{ padding: 16 }}><ChartPlaceholder loading /></Card>
        : series.length === 0 ? <Card bodyStyle={{ padding: 16 }}><Empty description="暂无留存数据" /></Card>
          : series.map((s) => (
            <Card
              key={s.key}
              title={series.length > 1 ? `${s.label}（${numberText(s.totalUsers)} 人）` : undefined}
              bodyStyle={{ padding: 16, overflowX: 'auto' }}
            >
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 4, minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 12px 8px 10px', fontSize: 12, color: 'var(--semi-color-text-2)', fontWeight: 500, width: '1%', whiteSpace: 'nowrap' }}>同期群</th>
                    <th style={{ textAlign: 'right', padding: '8px 14px 8px 10px', fontSize: 12, color: 'var(--semi-color-text-2)', fontWeight: 500, width: '1%', whiteSpace: 'nowrap' }}>人数</th>
                    {(data?.periods ?? []).map((period) => <th key={period} style={{ textAlign: 'center', padding: '8px 6px', fontSize: 12, color: 'var(--semi-color-text-2)', fontWeight: 500, whiteSpace: 'nowrap' }}>{`第 ${period} ${periodUnit}`}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '8px 12px 8px 10px', fontWeight: 600, whiteSpace: 'nowrap', width: '1%', color: 'var(--semi-color-text-2)' }}>加权平均</td>
                    <td style={{ padding: '8px 14px 8px 10px', textAlign: 'right', color: 'var(--semi-color-text-2)', whiteSpace: 'nowrap', width: '1%' }}>–</td>
                    {s.averages.map((value, index) => (
                      <td key={index} style={{ textAlign: 'center', padding: '8px 6px', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--semi-color-text-2)', fontWeight: 600 }}>
                        {value == null ? '·' : `${value.toFixed(1)}%`}
                      </td>
                    ))}
                  </tr>
                  {s.cohorts.map((cohort) => (
                    <tr key={cohort.cohortDate}>
                      <td style={{ padding: '8px 12px 8px 10px', fontWeight: 600, whiteSpace: 'nowrap', width: '1%' }}>{cohort.cohortDate}</td>
                      <td style={{ padding: '8px 14px 8px 10px', textAlign: 'right', color: 'var(--semi-color-text-1)', whiteSpace: 'nowrap', width: '1%' }}>{numberText(cohort.cohortSize)}</td>
                      {(data?.periods ?? []).map((period, index) => {
                        const value = cohort.values[index];
                        const ratio = value == null ? 0 : Math.min(1, value / periodMax);
                        const opacity = value == null ? 0 : 0.12 + ratio * 0.73;
                        const drillable = value != null && cohort.cohortSize > 0;
                        return (
                          <td
                            key={period}
                            title={drillable ? '点击查看该周期回访的用户' : undefined}
                            style={{
                              textAlign: 'center',
                              padding: 0,
                              borderRadius: 'var(--semi-border-radius-medium)',
                              fontSize: 12,
                              fontVariantNumeric: 'tabular-nums',
                              background: value == null ? 'transparent' : `color-mix(in srgb, var(--semi-color-primary) ${Math.round(opacity * 100)}%, transparent)`,
                              color: value == null ? 'var(--semi-color-text-3)' : ratio > 0.55 ? '#ffffff' : 'var(--semi-color-text-0)',
                            }}
                          >
                            {drillable ? (
                              <button
                                type="button"
                                onClick={() => openDrill(s.key, s.label, cohort.cohortDate, index, 'retained')}
                                style={{
                                  width: '100%', padding: '8px 6px', border: 'none', background: 'transparent',
                                  color: 'inherit', font: 'inherit', cursor: 'pointer', borderRadius: 'inherit',
                                }}
                              >
                                {`${value.toFixed(1)}%`}
                              </button>
                            ) : (
                              <span style={{ display: 'inline-block', padding: '8px 6px' }}>{value == null ? '·' : `${value.toFixed(1)}%`}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
      <DrillUsersSheet context={drill.context} title={drill.title} description={drill.description} onClose={drill.close} />
    </div>
  );
}
