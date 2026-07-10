import type { ReportDatasetParam } from '@zenith/shared';
import { formatDateForApi } from '@/utils/date';

function parseDefaultValue(param: ReportDatasetParam): unknown {
  if (param.defaultValue === '' || param.defaultValue === undefined || param.defaultValue === null) return undefined;
  if (param.type === 'number') {
    const num = Number(param.defaultValue);
    return Number.isFinite(num) ? num : undefined;
  }
  if (param.type === 'boolean') return param.defaultValue === true || param.defaultValue === 'true';
  if (param.type === 'date') return String(param.defaultValue);
  return param.defaultValue;
}

export function buildReportParamInitialValues(params: ReportDatasetParam[], overrides?: Record<string, unknown>) {
  const values: Record<string, unknown> = {};
  params.forEach((param) => {
    const override = overrides?.[param.name];
    if (override !== undefined) values[param.name] = override;
    else {
      const fallback = parseDefaultValue(param);
      if (fallback !== undefined) values[param.name] = fallback;
    }
  });
  return values;
}

export function normalizeReportParamValues(params: ReportDatasetParam[], values: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const param of params) {
    const value = values[param.name];
    if (value === undefined || value === null || value === '') {
      if (param.required) throw new Error(`请填写${param.label || param.name}`);
      continue;
    }
    if (param.type === 'number') {
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num)) throw new Error(`${param.label || param.name} 必须为数字`);
      output[param.name] = num;
      continue;
    }
    if (param.type === 'boolean') {
      output[param.name] = value === true || value === 'true';
      continue;
    }
    if (param.type === 'date') {
      output[param.name] = formatDateForApi(value as string | number | Date);
      continue;
    }
    output[param.name] = value;
  }
  return output;
}
