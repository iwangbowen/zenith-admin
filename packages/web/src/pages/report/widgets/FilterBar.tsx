import { Fragment, useEffect, useId, useState } from 'react';
import dayjs from 'dayjs';
import { Button, DatePicker, Select, Input, InputNumber, SideSheet, Space } from '@douyinfe/semi-ui';
import { Check, Filter, RotateCcw } from 'lucide-react';
import { formatDateForApi } from '@/utils/date';
import { DATE_RANGE_FILTER_WIDTH, DateRangeFilter } from '@/components/search-filters';
import { useReportFilterDynamicOptions } from '@/hooks/queries/report-designer';
import type { ReportFilter } from '@zenith/shared/report';

export interface FilterBarProps {
  filters: ReportFilter[];
  values: Record<string, unknown>;
  onChange: (filterId: string, value: unknown) => void;
  /** 公开/匿名场景禁用「数据集动态选项」拉取（避免触发鉴权 401）*/
  disableDynamicOptions?: boolean;
  dynamicOptions?: Record<string, Array<{ value: string; label: string }>>;
  /** 移动端紧凑模式：仅显示入口，完整控件放入底部抽屉。 */
  compact?: boolean;
  /** 紧凑模式重置后的值。 */
  resetValues?: Record<string, unknown>;
  /** 紧凑模式批量应用，避免逐字段触发请求。 */
  onApply?: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}

function countActiveReportFilters(filters: readonly ReportFilter[], values: Record<string, unknown>): number {
  return filters.reduce((count, filter) => {
    const value = values[filter.id];
    const active = Array.isArray(value)
      ? value.some((item) => item !== null && item !== undefined && item !== '')
      : value !== null && value !== undefined && value !== '';
    return count + (active ? 1 : 0);
  }, 0);
}

/** 区间筛选值以 `YYYY-MM-DD` 字符串存储（直接进查询参数），回填选择器前先还原成 Date */
function toDateRange(value: unknown): [Date, Date] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [start, end] = value.map((item) => dayjs(item as Date | string | number));
  return start.isValid() && end.isValid() ? [start.toDate(), end.toDate()] : null;
}

/** 全局筛选器运行时渲染（视图 / 设计器预览共用）*/
export function FilterBar({
  filters,
  values,
  onChange,
  disableDynamicOptions,
  dynamicOptions,
  compact = false,
  resetValues = {},
  onApply,
  disabled = false,
}: Readonly<FilterBarProps>) {
  const dynOptions = useReportFilterDynamicOptions(filters, disableDynamicOptions);
  const [visible, setVisible] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, unknown>>(values);
  const labelPrefix = useId();

  useEffect(() => {
    if (!visible) setDraftValues(values);
  }, [values, visible]);

  function optionsOf(f: ReportFilter) {
    if (f.optionSource?.kind === 'static') return f.optionSource.options ?? [];
    return dynamicOptions?.[f.id] ?? dynOptions[f.id] ?? [];
  }

  if (!filters.length) return null;

  function renderControls(
    currentValues: Record<string, unknown>,
    change: (filterId: string, value: unknown) => void,
    fullWidth: boolean,
  ) {
    const popupContainer = fullWidth ? () => document.body : undefined;
    return filters.map((f) => {
        const v = currentValues[f.id];
        const w = f.width ? f.width * 30 : 180;
        const controlWidth = fullWidth ? '100%' : w;
        const labelId = `${labelPrefix}-${f.id.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`;
        let control;
        switch (f.type) {
          case 'date':
            control = <DatePicker type="date" placeholder={f.label} value={v as string | undefined} style={{ width: controlWidth }}
              disabled={disabled} getPopupContainer={popupContainer}
              aria-labelledby={fullWidth ? labelId : undefined}
              onChange={(d) => change(f.id, d ? formatDateForApi(d as Date) : null)} />;
            break;
          case 'daterange':
            control = <DateRangeFilter type="dateRange" placeholder={[`${f.label}起`, '止']} value={toDateRange(v)} width={fullWidth ? '100%' : Math.max(w, DATE_RANGE_FILTER_WIDTH)}
              disabled={disabled} getPopupContainer={popupContainer}
              aria-labelledby={fullWidth ? labelId : undefined}
              onChange={(range) => change(f.id, range ? range.map((x) => formatDateForApi(x)) : null)} />;
            break;
          case 'select':
            control = <Select placeholder={f.label} value={v as string | undefined} style={{ width: controlWidth }} showClear filter
              disabled={disabled} getPopupContainer={popupContainer}
              aria-labelledby={fullWidth ? labelId : undefined}
              optionList={optionsOf(f)} onChange={(val) => change(f.id, val ?? null)} />;
            break;
          case 'multiSelect':
            control = <Select multiple placeholder={f.label} value={v as string[] | undefined} style={{ width: fullWidth ? '100%' : Math.max(w, 200) }} showClear filter
              disabled={disabled} getPopupContainer={popupContainer}
              aria-labelledby={fullWidth ? labelId : undefined}
              optionList={optionsOf(f)} onChange={(val) => change(f.id, val ?? [])} />;
            break;
          case 'numberRange':
            control = (
              <Space spacing={4} style={fullWidth ? { width: '100%' } : undefined}>
                <InputNumber placeholder={`${f.label}min`} value={(v as [number, number])?.[0]} style={{ width: fullWidth ? 'calc(50% - 10px)' : 90 }}
                  disabled={disabled}
                  aria-labelledby={fullWidth ? labelId : undefined}
                  onChange={(n) => change(f.id, [n, (v as [number, number])?.[1]])} />
                <span style={{ color: 'var(--semi-color-text-2)' }}>~</span>
                <InputNumber placeholder="max" value={(v as [number, number])?.[1]} style={{ width: fullWidth ? 'calc(50% - 10px)' : 90 }}
                  disabled={disabled}
                  aria-labelledby={fullWidth ? labelId : undefined}
                  onChange={(n) => change(f.id, [(v as [number, number])?.[0], n])} />
              </Space>
            );
            break;
          default:
            control = <Input placeholder={f.label} value={v as string | undefined} style={{ width: controlWidth }} showClear
              disabled={disabled}
              aria-labelledby={fullWidth ? labelId : undefined}
              onChange={(val) => change(f.id, val)} />;
        }
        return fullWidth ? (
          <div key={f.id} className="report-filter-compact__field">
            <span id={labelId} className="report-filter-compact__label">{f.label}</span>
            {control}
          </div>
        ) : <Fragment key={f.id}>{control}</Fragment>;
      });
  }

  if (!compact) {
    return (
      <Space wrap className="report-filter-bar" style={{ marginBottom: 12 }}>
        {renderControls(values, onChange, false)}
      </Space>
    );
  }

  const activeCount = countActiveReportFilters(filters, values);
  const draftActiveCount = countActiveReportFilters(filters, draftValues);
  const apply = () => {
    if (disabled) return;
    if (onApply) onApply(draftValues);
    else {
      for (const filter of filters) onChange(filter.id, draftValues[filter.id]);
    }
    setVisible(false);
  };

  return (
    <div className="report-filter-compact">
      <Button
        icon={<Filter size={15} />}
        onClick={() => {
          setDraftValues(values);
          setVisible(true);
        }}
        disabled={disabled}
        aria-label={`筛选条件，已启用 ${activeCount} 项`}
      >
        筛选{activeCount > 0 ? ` ${activeCount}` : ''}
      </Button>
      <SideSheet
        className="report-filter-sheet"
        title={`筛选条件 · 已启用 ${draftActiveCount} 项`}
        visible={visible}
        onCancel={() => setVisible(false)}
        placement="bottom"
        height="min(78vh, 560px)"
        footer={(
          <Space style={{ width: '100%' }}>
            <Button
              type="tertiary"
              icon={<RotateCcw size={15} />}
              style={{ flex: 1 }}
              disabled={disabled}
              onClick={() => setDraftValues(resetValues)}
            >
              重置
            </Button>
            <Button
              type="primary"
              icon={<Check size={15} />}
              style={{ flex: 1 }}
              disabled={disabled}
              onClick={apply}
            >
              应用
            </Button>
          </Space>
        )}
      >
        <div className="report-filter-compact__controls">
          {renderControls(
            draftValues,
            (filterId, value) => setDraftValues((previous) => ({ ...previous, [filterId]: value })),
            true,
          )}
        </div>
      </SideSheet>
    </div>
  );
}

export default FilterBar;
