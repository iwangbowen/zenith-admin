/**
 * 表单联动：默认值公式一次性注入、公式实时计算、dateRange→天数、select 级联收敛、联动赋值与远程数据源回填。
 * 每次 onValueChange 依次执行：公式 → 天数 → 级联 → 联动赋值（顺序即语义，勿调换）。
 */
import { useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import dayjs from 'dayjs';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { evalFormula } from '../../form-formula';
import { fetchWorkflowDataSourceRecord } from '@/hooks/queries/workflow-designer';
import { getCascadeAllowedOptions } from './field-utils';

type Values = Record<string, unknown>;

/** 默认值公式：按「静态默认值 + 外部初始值」求值一次注入（外部已给值/只读展示不覆盖） */
function enrichInitValues(all: WorkflowFormField[], initValues: Values | undefined, readOnly: boolean | undefined): Values | undefined {
  if (readOnly) return initValues;
  const withFormula = all.filter((f) => f.defaultFormula?.trim());
  if (withFormula.length === 0) return initValues;
  const base: Values = {};
  for (const f of all) if (f.defaultValue !== undefined) base[f.key] = f.defaultValue;
  Object.assign(base, initValues);
  const out: Values = { ...(initValues ?? {}) };
  for (const f of withFormula) {
    if (out[f.key] !== undefined && out[f.key] !== null && out[f.key] !== '') continue;
    const v = evalFormula(f.defaultFormula ?? '', base, f.precision ?? 2);
    if (v !== null) out[f.key] = v;
  }
  return out;
}

function syncFormulaFields(api: FormApi, formulaFields: WorkflowFormField[], next: Values) {
  for (const f of formulaFields) {
    if (!f.formula) continue;
    const result = evalFormula(f.formula, next, f.precision ?? 2);
    if (result !== null && next[f.key] !== result) {
      api.setValue(f.key, result);
    } else if (result === null && next[f.key] !== undefined) {
      api.setValue(f.key, undefined);
    }
  }
}

/** 日期范围 → 天数（含首尾） */
function syncDayFields(api: FormApi, dayFields: WorkflowFormField[], next: Values) {
  for (const f of dayFields) {
    if (!f.daysFromKey) continue;
    const range = next[f.daysFromKey];
    if (Array.isArray(range) && range.length === 2 && range[0] && range[1]) {
      const start = dayjs(range[0] as string | Date);
      const end = dayjs(range[1] as string | Date);
      if (start.isValid() && end.isValid()) {
        const days = end.diff(start, 'day') + 1;
        if (Number.isFinite(days) && days >= 0 && next[f.key] !== days) {
          api.setValue(f.key, days);
        } else if ((!Number.isFinite(days) || days < 0) && next[f.key] !== undefined) {
          api.setValue(f.key, undefined);
        }
      }
    } else if (next[f.key] !== undefined) {
      api.setValue(f.key, undefined);
    }
  }
}

/** 级联：父值变化后过滤已失效的子值 */
function syncCascadeFields(api: FormApi, cascadeFields: WorkflowFormField[], next: Values) {
  for (const f of cascadeFields) {
    if (!f.optionsFrom) continue;
    const allowed = getCascadeAllowedOptions(f, next);
    const cur = next[f.key];
    if (cur === undefined || cur === null || cur === '') continue;
    if (Array.isArray(cur)) {
      const filtered = cur.filter(v => allowed.includes(String(v)));
      if (filtered.length !== cur.length) {
        api.setValue(f.key, filtered);
        Toast.info(`${f.label}已按父字段选项自动调整`);
      }
    } else if (typeof cur === 'string' && !allowed.includes(cur)) {
      api.setValue(f.key, undefined);
      Toast.info(`${f.label}已清空，当前父字段下该选项不可用`);
    }
  }
}

interface UseFormLinkageOptions {
  /** 平铺后的全部字段（含容器内子字段） */
  all: WorkflowFormField[];
  initValues?: Values;
  readOnly?: boolean;
  formApiRef: RefObject<FormApi | null>;
  onValueChange?: (values: Values) => void;
}

export function useFormLinkage({ all, initValues, readOnly, formApiRef, onValueChange }: UseFormLinkageOptions) {
  const [enrichedInitValues] = useState<Values | undefined>(() => enrichInitValues(all, initValues, readOnly));

  const valuesRef = useRef<Values>(enrichedInitValues ?? {});
  const [valuesState, setValuesState] = useState<Values>(enrichedInitValues ?? {});

  const formulaFields = useMemo(() => all.filter(f => f.type === 'formula' && f.formula), [all]);
  const dayFields = useMemo(() => all.filter(f => f.daysFromKey && (f.type === 'number' || f.type === 'amount')), [all]);
  const cascadeFields = useMemo(() => all.filter(f => f.optionsFrom), [all]);
  const autoFillFields = useMemo(() => all.filter(f => f.autoFill && f.autoFill.targets.length > 0), [all]);

  // 数据源记录回填：选中值期间变化则丢弃结果，失败静默
  const fillFromDataSourceRecord = async (f: WorkflowFormField, value: string) => {
    const map = f.autoFill?.dataSourceFieldMap;
    if (!f.dataSourceId || !map) return;
    try {
      const record = await fetchWorkflowDataSourceRecord(f.dataSourceId, value);
      const api = formApiRef.current;
      if (!api || !record) return;
      if (String(valuesRef.current[f.key] ?? '') !== value) return;
      for (const targetKey of f.autoFill?.targets ?? []) {
        const sourceField = map[targetKey];
        if (!sourceField) continue;
        const raw = record[sourceField];
        if (raw === undefined) continue;
        const tf = all.find(x => x.key === targetKey);
        let val: unknown = raw;
        if (tf && (tf.type === 'number' || tf.type === 'amount')) {
          val = raw === '' || raw === null ? undefined : Number(raw);
        } else if (raw !== null && typeof raw === 'object') {
          val = JSON.stringify(raw);
        } else if (raw === null) {
          val = undefined;
        }
        api.setValue(targetKey, val);
      }
    } catch {
      /* 数据源不可用时静默，不阻塞填写 */
    }
  };

  // 联动赋值：源字段选项变化时自动填充目标字段
  const syncAutoFillFields = (api: FormApi, next: Values, prev: Values) => {
    for (const f of autoFillFields) {
      if (!f.autoFill) continue;
      if (next[f.key] === prev[f.key]) continue;
      const optKey = next[f.key];
      if (optKey === undefined || optKey === null) continue;
      // 远程数据源模式：按选中记录回填映射字段（异步，含竞态防护）
      if (f.dataSourceId && f.autoFill.dataSourceFieldMap && Object.keys(f.autoFill.dataSourceFieldMap).length > 0) {
        void fillFromDataSourceRecord(f, String(optKey));
        continue;
      }
      const fillMap = f.autoFill.byOption[String(optKey)];
      if (!fillMap) continue;
      for (const targetKey of f.autoFill.targets) {
        const raw = fillMap[targetKey];
        if (raw === undefined) continue;
        const tf = all.find(x => x.key === targetKey);
        const val = tf && (tf.type === 'number' || tf.type === 'amount')
          ? (raw === '' ? undefined : Number(raw))
          : raw;
        api.setValue(targetKey, val);
      }
    }
  };

  const handleValueChange = (raw: Values) => {
    // Semi Form 每次回调传入同一个内部可变对象：必须浅拷贝快照，
    // 否则第一次 setState 之后 state 与 next 恒等（Object.is），
    // React 跳过重渲染，第二次值变更起显隐/条件必填联动全部失效。
    const prev = valuesRef.current;
    const next = { ...raw };
    valuesRef.current = next;
    setValuesState(next);
    const api = formApiRef.current;
    if (api) {
      syncFormulaFields(api, formulaFields, next);
      syncDayFields(api, dayFields, next);
      syncCascadeFields(api, cascadeFields, next);
      syncAutoFillFields(api, next, prev);
    }
    onValueChange?.(next);
  };

  return { enrichedInitValues, valuesState, handleValueChange };
}
