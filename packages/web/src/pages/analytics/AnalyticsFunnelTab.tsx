/** 转化漏斗：组合页面 / 事件步骤按时间先后分析转化，支持转化窗口、分群对比、配置保存与用户下钻 */
import { useMemo, useState } from 'react';
import { Button, Card, Dropdown, Input, InputNumber, Modal, Select, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { Bookmark, Plus, Target, Trash2 } from 'lucide-react';
import { DataBar } from '@/components/data-viz/DataBar';
import { BarChart, chartOptions, makeBarSpec, useChartPalette } from '@/components/charts';
import { useAnalyzeFunnel, useSavedFunnelReports, useSaveFunnelReport, useDeleteFunnelReport } from '@/hooks/queries/analytics';
import type { AnalyticsComparison, AnalyticsSavedReport, AnalyticsSegmentPropertyFilter } from '@zenith/shared/analytics';
import { ANALYTICS_SEGMENT_COMPARE_OP_OPTIONS } from '@zenith/shared/analytics';
import { ComparisonPicker, DrillUsersSheet, isComparisonReady, useDrillSheet } from './AnalyticsComparison';
import { useBehaviorDays } from './behavior-days-context';
import { confirmDelete } from '@/utils/confirm';
import { DAYS_OPTIONS, chartColor, msToReadable, numberText, percentText, sectionStyle } from './analytics-format';
import { ChartPlaceholder, SectionHeader } from './analytics-shared';

interface FunnelStepDraft {
  id: string;
  label: string;
  pagePath?: string;
  eventName?: string;
  propKey?: string;
  propOp?: AnalyticsSegmentPropertyFilter['op'];
  propValue?: string;
}

function buildStepProperties(step: FunnelStepDraft): AnalyticsSegmentPropertyFilter[] | undefined {
  const key = step.propKey?.trim();
  if (!key) return undefined;
  const op = step.propOp ?? 'eq';
  const raw = step.propValue?.trim() ?? '';
  const value = op === 'in' ? raw.split(',').map((v) => v.trim()).filter(Boolean) : raw;
  return [{ key, op, value }];
}

export default function AnalyticsFunnelTab() {
  const palette = useChartPalette();
  const [days, setDays] = useBehaviorDays();
  const [conversionWindowHours, setConversionWindowHours] = useState(72);
  const [comparison, setComparison] = useState<AnalyticsComparison>({ type: 'none' });
  const drill = useDrillSheet();
  const [steps, setSteps] = useState<FunnelStepDraft[]>([
    { id: 'step-1', label: '进入首页', pagePath: '/' },
    { id: 'step-2', label: '进入仪表盘', pagePath: '/dashboard' },
  ]);
  const analyzeMutation = useAnalyzeFunnel();
  const result = analyzeMutation.data ?? null;
  const loading = analyzeMutation.isPending;
  const savedReportsQuery = useSavedFunnelReports();
  const savedReports = savedReportsQuery.data?.list ?? [];
  const saveReportMutation = useSaveFunnelReport();
  const deleteReportMutation = useDeleteFunnelReport();
  const [saveName, setSaveName] = useState('');
  const [saveVisible, setSaveVisible] = useState(false);

  const saveReport = async () => {
    const name = saveName.trim();
    if (!name) { Toast.warning('请输入报表名称'); return; }
    await saveReportMutation.mutateAsync({
      body: {
        name,
        config: {
          days,
          conversionWindowHours,
          comparison,
          steps: steps.map(({ label, pagePath, eventName, propKey, propOp, propValue }) => ({ label, pagePath, eventName, propKey, propOp, propValue })),
        },
      },
    });
    Toast.success('已保存');
    setSaveVisible(false);
    setSaveName('');
  };

  const loadReport = (report: AnalyticsSavedReport) => {
    const config = report.config as {
      days?: number;
      conversionWindowHours?: number;
      comparison?: AnalyticsComparison;
      steps?: Array<{ label?: string; pagePath?: string; eventName?: string; propKey?: string; propOp?: AnalyticsSegmentPropertyFilter['op']; propValue?: string }>;
    };
    if (config.days) setDays(config.days);
    setConversionWindowHours(config.conversionWindowHours ?? 72);
    setComparison(config.comparison ?? { type: 'none' });
    if (Array.isArray(config.steps) && config.steps.length >= 2) {
      setSteps(config.steps.map((s, i) => ({
        id: `step-${Date.now()}-${i}`,
        label: s.label ?? `步骤 ${i + 1}`,
        pagePath: s.pagePath,
        eventName: s.eventName,
        propKey: s.propKey,
        propOp: s.propOp,
        propValue: s.propValue,
      })));
    }
    Toast.info(`已加载「${report.name}」`);
  };

  const updateStep = (id: string, patch: Partial<Omit<FunnelStepDraft, 'id'>>) => {
    setSteps((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addStep = () => {
    setSteps((prev) => [...prev, { id: `step-${Date.now()}`, label: `步骤 ${prev.length + 1}`, eventName: '' }]);
  };

  const removeStep = (id: string) => {
    setSteps((prev) => (prev.length <= 2 ? prev : prev.filter((item) => item.id !== id)));
  };

  // 多序列时图表按序列分组展示各步转化率；单序列沿用原有的横向条形
  const funnelChartData = useMemo(() => {
    const series = result?.series ?? [];
    if (series.length === 0) return [];
    if (series.length === 1) {
      return (series[0].steps ?? []).map((step, index) => ({ ...step, __fill: chartColor(index, palette.primary) }));
    }
    return (series[0].steps ?? []).map((step, stepIndex) => {
      const row: Record<string, unknown> = { label: step.label };
      series.forEach((s) => { row[s.key] = s.steps[stepIndex]?.conversionRate ?? 0; });
      return row;
    });
  }, [palette.primary, result?.series]);

  const funnelBarSpec = useMemo(() => {
    const series = result?.series ?? [];
    const multi = series.length > 1;
    return makeBarSpec({
      data: funnelChartData,
      xField: 'label',
      series: multi
        ? series.map((s, i) => ({ field: s.key, name: s.label, color: chartColor(i, palette.primary) }))
        : [{ field: 'conversionRate', name: '总转化率', color: palette.primary }],
      palette,
      horizontal: !multi,
      categoryAxisWidth: multi ? undefined : 96,
      colorByDatum: multi ? undefined : (datum) => String(datum?.__fill ?? palette.primary),
      tooltip: { value: (value) => `${Number(value).toFixed(1)}%` },
      axis: { yLabel: (value) => `${value}%` },
    });
  }, [funnelChartData, palette, result?.series]);

  const funnelSteps = useMemo(() => steps.map((step) => ({
    label: step.label.trim(),
    pagePath: step.pagePath?.trim() || undefined,
    eventName: step.eventName?.trim() || undefined,
    properties: buildStepProperties(step),
  })), [steps]);

  const analyze = async () => {
    if (!isComparisonReady(comparison)) { Toast.warning('请至少选择一个对比分群'); return; }
    await analyzeMutation.mutateAsync({ body: { days, conversionWindowHours, comparison, steps: funnelSteps } });
  };

  /** 点击某序列某步的「已转化 / 已流失」→ 下钻出具体用户 */
  const openDrill = (seriesKey: string, seriesLabel: string, stepIndex: number, outcome: 'converted' | 'dropped', stepLabel: string) => {
    drill.open(
      { type: 'funnel', days, steps: funnelSteps, conversionWindowHours, comparison, seriesKey, stepIndex, outcome },
      `${stepLabel} · ${outcome === 'converted' ? '已转化用户' : '流失用户'}`,
      comparison.type === 'none' ? undefined : `对比序列：${seriesLabel}`,
    );
  };

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="转化漏斗"
        description="组合页面与事件步骤，按时间先后顺序分析用户转化（支持转化窗口与分群过滤）"
        extra={<Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />}
      />
      <Card bodyStyle={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Typography.Text type="tertiary" size="small">转化窗口（小时）</Typography.Text>
            <InputNumber value={conversionWindowHours} min={1} max={720} onChange={(v) => setConversionWindowHours(Number(v) || 72)} style={{ width: 120 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Typography.Text type="tertiary" size="small">对比</Typography.Text>
            <ComparisonPicker value={comparison} onChange={setComparison} />
          </div>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {steps.map((step, index) => (
            <div key={step.id} style={{ display: 'grid', gridTemplateColumns: '40px minmax(110px, 0.9fr) minmax(120px, 0.9fr) minmax(120px, 0.9fr) minmax(100px, 0.7fr) 84px minmax(100px, 0.7fr) 36px', gap: 8, alignItems: 'center' }}>
              <Tag color="blue">#{index + 1}</Tag>
              <Input placeholder="步骤名称" value={step.label} onChange={(value) => updateStep(step.id, { label: value })} />
              <Input placeholder="页面路径（可选）" value={step.pagePath ?? ''} onChange={(value) => updateStep(step.id, { pagePath: value })} />
              <Input placeholder="事件名（可选）" value={step.eventName ?? ''} onChange={(value) => updateStep(step.id, { eventName: value })} />
              <Input placeholder="属性key（可选）" value={step.propKey ?? ''} onChange={(value) => updateStep(step.id, { propKey: value })} />
              <Select
                value={step.propOp ?? 'eq'}
                optionList={ANALYTICS_SEGMENT_COMPARE_OP_OPTIONS}
                onChange={(v) => updateStep(step.id, { propOp: v as AnalyticsSegmentPropertyFilter['op'] })}
                disabled={!step.propKey}
              />
              <Input placeholder="属性值" value={step.propValue ?? ''} onChange={(value) => updateStep(step.id, { propValue: value })} disabled={!step.propKey} />
              <Button icon={<Trash2 size={14} />} type="danger" theme="borderless" disabled={steps.length <= 2} onClick={() => removeStep(step.id)} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <Button icon={<Plus size={14} />} onClick={addStep}>添加步骤</Button>
          <Button type="primary" icon={<Target size={14} />} loading={loading} disabled={steps.length < 2} onClick={() => void analyze()}>分析</Button>
          <Button icon={<Bookmark size={14} />} onClick={() => setSaveVisible(true)}>保存配置</Button>
          <Dropdown
            trigger="click"
            position="bottomLeft"
            render={(
              <Dropdown.Menu>
                {savedReports.length === 0 && <Dropdown.Item disabled>暂无保存的漏斗</Dropdown.Item>}
                {savedReports.map((report) => (
                  <Dropdown.Item key={report.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                      <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => loadReport(report)}>{report.name}</span>
                      <Button
                        theme="borderless"
                        type="danger"
                        size="small"
                        icon={<Trash2 size={12} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmDelete({
                            title: `删除报表「${report.name}」？`,
                            onOk: () => deleteReportMutation.mutateAsync({ params: { id: report.id } }).then(() => Toast.success('已删除')),
                          });
                        }}
                      />
                    </div>
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            )}
          >
            <Button loading={savedReportsQuery.isFetching}>加载配置 ({savedReports.length})</Button>
          </Dropdown>
        </div>
        <Modal
          title="保存漏斗配置"
          visible={saveVisible}
          onCancel={() => setSaveVisible(false)}
          onOk={() => void saveReport()}
          confirmLoading={saveReportMutation.isPending}
        >
          <Input placeholder="报表名称，如「注册转化漏斗」" value={saveName} onChange={setSaveName} />
        </Modal>
      </Card>
      <Card title="漏斗结果" bodyStyle={{ padding: 16 }}>
        {!result || result.series.length === 0 ? <ChartPlaceholder loading={loading} description="请配置步骤后点击分析" /> : (
          <div style={{ display: 'grid', gap: 18 }}>
            <BarChart {...funnelBarSpec} options={chartOptions} height={300} />
            {result.series.map((series, seriesIndex) => (
              <div key={series.key} style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  {result.series.length > 1 && (
                    <Space spacing={6} align="center">
                      <span
                        aria-hidden
                        style={{ width: 8, height: 8, borderRadius: '50%', background: chartColor(seriesIndex, palette.primary), display: 'inline-block' }}
                      />
                      <Typography.Text strong>{series.label}</Typography.Text>
                    </Space>
                  )}
                  <Tag color="blue">总用户 {numberText(series.totalUsers)}</Tag>
                  <Tag color="green">整体转化 {percentText(series.overallConversionRate)}</Tag>
                </div>
                {series.steps.map((step, index) => (
                  <div key={`${series.key}-${step.label}-${index}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
                      <Typography.Text strong>{step.label}</Typography.Text>
                      <Space spacing={8} wrap>
                        <Typography.Text>
                          {numberText(step.users)} 人 · 总转化 {percentText(step.conversionRate)} · 上步转化 {percentText(step.stepConversionRate)} · 流失 {numberText(step.dropoff)}
                          {step.averageConversionMs != null ? ` · 平均耗时 ${msToReadable(step.averageConversionMs)}` : ''}
                        </Typography.Text>
                        <Button theme="borderless" size="small" disabled={step.users === 0} onClick={() => openDrill(series.key, series.label, index, 'converted', step.label)}>看用户</Button>
                        {index > 0 && (
                          <Button theme="borderless" size="small" disabled={step.dropoff === 0} onClick={() => openDrill(series.key, series.label, index, 'dropped', step.label)}>看流失</Button>
                        )}
                      </Space>
                    </div>
                    <DataBar
                      value={step.conversionRate}
                      max={100}
                      minPercent={2}
                      color={chartColor(index, palette.primary)}
                      track="var(--semi-color-fill-0)"
                      height={20}
                      radius={999}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>
      <DrillUsersSheet context={drill.context} title={drill.title} description={drill.description} onClose={drill.close} />
    </div>
  );
}
