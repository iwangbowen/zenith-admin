import { useEffect, useState } from 'react';
import { DatePicker, Select, Input, InputNumber, Space } from '@douyinfe/semi-ui';
import { request } from '@/utils/request';
import { formatDateForApi } from '@/utils/date';
import type { ReportFilter, ReportDataResult } from '@zenith/shared';

interface FilterBarProps {
  filters: ReportFilter[];
  values: Record<string, unknown>;
  onChange: (filterId: string, value: unknown) => void;
  /** 公开/匿名场景禁用「数据集动态选项」拉取（避免触发鉴权 401）*/
  disableDynamicOptions?: boolean;
}

/** 全局筛选器运行时渲染（视图 / 设计器预览共用）*/
export function FilterBar({ filters, values, onChange, disableDynamicOptions }: Readonly<FilterBarProps>) {
  const [dynOptions, setDynOptions] = useState<Record<string, { value: string; label: string }[]>>({});

  useEffect(() => {
    if (disableDynamicOptions) return;
    for (const f of filters) {
      const src = f.optionSource;
      if ((f.type === 'select' || f.type === 'multiSelect') && src?.kind === 'dataset' && src.datasetId) {
        request.post<ReportDataResult>(`/api/report/datasets/${src.datasetId}/data`, { limit: 500 }, { silent: true }).then((res) => {
          if (res.code === 0) {
            const vf = src.valueField || res.data.columns[0];
            const lf = src.labelField || vf;
            const opts = res.data.rows.map((r) => ({ value: String(r[vf] ?? ''), label: String(r[lf] ?? r[vf] ?? '') })).filter((o) => o.value !== '');
            setDynOptions((m) => ({ ...m, [f.id]: opts }));
          }
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters.map((f) => [f.id, f.optionSource?.datasetId]))]);

  function optionsOf(f: ReportFilter) {
    if (f.optionSource?.kind === 'static') return f.optionSource.options ?? [];
    return dynOptions[f.id] ?? [];
  }

  if (!filters.length) return null;

  return (
    <Space wrap style={{ marginBottom: 12 }}>
      {filters.map((f) => {
        const v = values[f.id];
        const w = f.width ? f.width * 30 : 180;
        switch (f.type) {
          case 'date':
            return <DatePicker key={f.id} type="date" placeholder={f.label} value={v as string | undefined} style={{ width: w }}
              onChange={(d) => onChange(f.id, d ? formatDateForApi(d as Date) : null)} />;
          case 'daterange':
            return <DatePicker key={f.id} type="dateRange" placeholder={[`${f.label}起`, '止']} value={v as [Date, Date] | undefined} style={{ width: Math.max(w, 240) }}
              onChange={(d) => onChange(f.id, d ? (d as Date[]).map((x) => formatDateForApi(x)) : null)} />;
          case 'select':
            return <Select key={f.id} placeholder={f.label} value={v as string | undefined} style={{ width: w }} showClear filter
              optionList={optionsOf(f)} onChange={(val) => onChange(f.id, val ?? null)} />;
          case 'multiSelect':
            return <Select key={f.id} multiple placeholder={f.label} value={v as string[] | undefined} style={{ width: Math.max(w, 200) }} showClear filter
              optionList={optionsOf(f)} onChange={(val) => onChange(f.id, val ?? [])} />;
          case 'numberRange':
            return (
              <Space key={f.id} spacing={4}>
                <InputNumber placeholder={`${f.label}min`} value={(v as [number, number])?.[0]} style={{ width: 90 }}
                  onChange={(n) => onChange(f.id, [n, (v as [number, number])?.[1]])} />
                <span style={{ color: 'var(--semi-color-text-2)' }}>~</span>
                <InputNumber placeholder="max" value={(v as [number, number])?.[1]} style={{ width: 90 }}
                  onChange={(n) => onChange(f.id, [(v as [number, number])?.[0], n])} />
              </Space>
            );
          default:
            return <Input key={f.id} placeholder={f.label} value={v as string | undefined} style={{ width: w }} showClear
              onChange={(val) => onChange(f.id, val)} />;
        }
      })}
    </Space>
  );
}

export default FilterBar;
