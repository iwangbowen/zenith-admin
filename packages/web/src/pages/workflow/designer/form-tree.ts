/**
 * 表单字段树操作工具（纯函数，不可变）
 * 统一处理顶层字段、分栏（row.columns[].fields）、分组/明细（children）的
 * 查找 / 更新 / 删除 / 插入，供设计器画布的嵌套拖拽与字段配置复用。
 */
import type { WorkflowFormField, WorkflowFormFieldType } from '@zenith/shared';

/** 容器类型：内部可容纳子字段 */
export const CONTAINER_TYPES: WorkflowFormFieldType[] = ['row', 'group', 'detail', 'tabs', 'steps'];
export const isContainerType = (t: WorkflowFormFieldType): boolean => CONTAINER_TYPES.includes(t);

/** 是否为 tabs/steps 面板容器 */
export const isPaneContainerType = (t: WorkflowFormFieldType): boolean => t === 'tabs' || t === 'steps';

// ─── 容器嵌套规则（F03）────────────────────────────────────────────
// 分栏列内可放：分组/明细；分组内可放：分栏/明细；
// 明细与标签页/分步面板内仍不允许放容器；整体容器链深度 ≤ 3。

const NESTABLE_IN_COL = new Set<WorkflowFormFieldType>(['group', 'detail']);
const NESTABLE_IN_GROUP = new Set<WorkflowFormFieldType>(['row', 'detail']);
export const MAX_CONTAINER_DEPTH = 3;

/** 字段子树的容器高度：自身是容器计 1，叠加子孙容器最大高度（普通字段为 0） */
export function containerHeightOf(field: WorkflowFormField): number {
  const childFields: WorkflowFormField[] = [
    ...(field.columns?.flatMap((c) => c.fields) ?? []),
    ...(field.panes?.flatMap((p) => p.fields) ?? []),
    ...(field.children ?? []),
  ];
  const maxChild = childFields.length ? Math.max(...childFields.map(containerHeightOf)) : 0;
  return (isContainerType(field.type) ? 1 : 0) + maxChild;
}

/** 从顶层到指定容器（含自身）的容器链深度；未找到返回 0 */
export function containerDepthAt(fields: WorkflowFormField[], key: string): number {
  let found = 0;
  const walk = (list: WorkflowFormField[], depth: number): boolean => {
    for (const f of list) {
      const d = isContainerType(f.type) ? depth + 1 : depth;
      if (f.key === key) {
        found = d;
        return true;
      }
      if (f.columns) for (const c of f.columns) if (walk(c.fields, d)) return true;
      if (f.panes) for (const p of f.panes) if (walk(p.fields, d)) return true;
      if (f.children && walk(f.children, d)) return true;
    }
    return false;
  };
  walk(fields, 0);
  return found;
}

/** 容器类字段能否放入目标位置（白名单 + 深度限制）；普通字段恒可 */
export function canNestContainer(
  fields: WorkflowFormField[],
  target: DropTarget,
  moved: { type: WorkflowFormFieldType; height: number },
): boolean {
  if (!isContainerType(moved.type)) return true;
  if (target.container === 'root') return moved.height <= MAX_CONTAINER_DEPTH;
  if (target.container === 'pane') return false;
  const allowed = target.container === 'col' ? NESTABLE_IN_COL : NESTABLE_IN_GROUP;
  if (!allowed.has(moved.type)) return false;
  const anchorKey = target.container === 'col' ? target.rowKey : target.groupKey;
  return containerDepthAt(fields, anchorKey) + moved.height <= MAX_CONTAINER_DEPTH;
}

/** 拖放目标位置；beforeKey 为空表示追加到容器末尾 */
export type DropTarget =
  | { container: 'root'; beforeKey?: string }
  | { container: 'col'; rowKey: string; colIndex: number; beforeKey?: string }
  | { container: 'group'; groupKey: string; beforeKey?: string }
  | { container: 'pane'; paneKey: string; paneIndex: number; beforeKey?: string };

/** 递归查找字段（含分栏列 / 分组子 / 明细子 / 面板子） */
export function findField(fields: WorkflowFormField[], key: string): WorkflowFormField | null {
  for (const f of fields) {
    if (f.key === key) return f;
    if (f.columns) {
      for (const col of f.columns) {
        const r = findField(col.fields, key);
        if (r) return r;
      }
    }
    if (f.panes) {
      for (const pane of f.panes) {
        const r = findField(pane.fields, key);
        if (r) return r;
      }
    }
    if (f.children) {
      const r = findField(f.children, key);
      if (r) return r;
    }
  }
  return null;
}

/** 递归更新字段属性（返回新树） */
export function updateField(
  fields: WorkflowFormField[],
  key: string,
  updates: Partial<WorkflowFormField>,
): WorkflowFormField[] {
  return fields.map((f) => {
    if (f.key === key) return { ...f, ...updates };
    let nf = f;
    if (f.columns) {
      nf = { ...nf, columns: f.columns.map((col) => ({ ...col, fields: updateField(col.fields, key, updates) })) };
    }
    if (f.panes) {
      nf = { ...nf, panes: f.panes.map((pane) => ({ ...pane, fields: updateField(pane.fields, key, updates) })) };
    }
    if (f.children) {
      nf = { ...nf, children: updateField(f.children, key, updates) };
    }
    return nf;
  });
}

/** 递归删除字段，返回 [新树, 被删字段|null] */
export function removeField(
  fields: WorkflowFormField[],
  key: string,
): [WorkflowFormField[], WorkflowFormField | null] {
  let removed: WorkflowFormField | null = null;
  const out: WorkflowFormField[] = [];
  for (const f of fields) {
    if (f.key === key) { removed = f; continue; }
    let nf = f;
    if (f.columns) {
      nf = {
        ...nf,
        columns: f.columns.map((col) => {
          const [cf, r] = removeField(col.fields, key);
          if (r) removed = r;
          return { ...col, fields: cf };
        }),
      };
    }
    if (f.panes) {
      nf = {
        ...nf,
        panes: f.panes.map((pane) => {
          const [pf, r] = removeField(pane.fields, key);
          if (r) removed = r;
          return { ...pane, fields: pf };
        }),
      };
    }
    if (f.children) {
      const [cf, r] = removeField(f.children, key);
      if (r) removed = r;
      nf = { ...nf, children: cf };
    }
    out.push(nf);
  }
  return [out, removed];
}

function insertIntoArray(arr: WorkflowFormField[], beforeKey: string | undefined, field: WorkflowFormField): WorkflowFormField[] {
  if (!beforeKey) return [...arr, field];
  const idx = arr.findIndex((f) => f.key === beforeKey);
  if (idx < 0) return [...arr, field];
  const copy = [...arr];
  copy.splice(idx, 0, field);
  return copy;
}

/** 在目标位置插入字段（返回新树） */
export function insertField(
  fields: WorkflowFormField[],
  target: DropTarget,
  field: WorkflowFormField,
): WorkflowFormField[] {
  if (target.container === 'root') {
    return insertIntoArray(fields, target.beforeKey, field);
  }
  if (target.container === 'col') {
    return fields.map((f) => {
      if (f.key !== target.rowKey || !f.columns) return f;
      return {
        ...f,
        columns: f.columns.map((col, i) =>
          i === target.colIndex ? { ...col, fields: insertIntoArray(col.fields, target.beforeKey, field) } : col,
        ),
      };
    });
  }
  if (target.container === 'pane') {
    return fields.map((f) => {
      if (f.key !== target.paneKey || !f.panes) return f;
      return {
        ...f,
        panes: f.panes.map((pane, i) =>
          i === target.paneIndex ? { ...pane, fields: insertIntoArray(pane.fields, target.beforeKey, field) } : pane,
        ),
      };
    });
  }
  return fields.map((f) => {
    if (f.key !== target.groupKey) return f;
    return { ...f, children: insertIntoArray(f.children ?? [], target.beforeKey, field) };
  });
}

/** 在指定字段之后插入（用于复制字段，保持同容器同位置） */
export function insertAfterKey(
  fields: WorkflowFormField[],
  afterKey: string,
  field: WorkflowFormField,
): WorkflowFormField[] {
  const out: WorkflowFormField[] = [];
  for (const f of fields) {
    let nf = f;
    if (f.columns) {
      nf = { ...nf, columns: f.columns.map((col) => ({ ...col, fields: insertAfterKey(col.fields, afterKey, field) })) };
    }
    if (f.panes) {
      nf = { ...nf, panes: f.panes.map((pane) => ({ ...pane, fields: insertAfterKey(pane.fields, afterKey, field) })) };
    }
    if (f.children) {
      nf = { ...nf, children: insertAfterKey(f.children, afterKey, field) };
    }
    out.push(nf);
    if (f.key === afterKey) out.push(field);
  }
  return out;
}

/** 在字段所处的同级数组内上移（dir=-1）/ 下移（dir=1）一位；到边界或未找到时原样返回 */
export function moveFieldSibling(
  fields: WorkflowFormField[],
  key: string,
  dir: -1 | 1,
): WorkflowFormField[] {
  const swapIn = (arr: WorkflowFormField[]): WorkflowFormField[] | null => {
    const idx = arr.findIndex((f) => f.key === key);
    if (idx >= 0) {
      const to = idx + dir;
      if (to < 0 || to >= arr.length) return null;
      const copy = [...arr];
      [copy[idx], copy[to]] = [copy[to], copy[idx]];
      return copy;
    }
    let changed = false;
    const out = arr.map((f) => {
      if (changed) return f;
      let nf = f;
      if (f.columns) {
        const cols = f.columns.map((col) => {
          if (changed) return col;
          const r = swapIn(col.fields);
          if (r) { changed = true; return { ...col, fields: r }; }
          return col;
        });
        if (changed) nf = { ...nf, columns: cols };
      }
      if (!changed && f.panes) {
        const panes = f.panes.map((pane) => {
          if (changed) return pane;
          const r = swapIn(pane.fields);
          if (r) { changed = true; return { ...pane, fields: r }; }
          return pane;
        });
        if (changed) nf = { ...nf, panes: panes };
      }
      if (!changed && f.children) {
        const r = swapIn(f.children);
        if (r) { changed = true; nf = { ...nf, children: r }; }
      }
      return nf;
    });
    return changed ? out : null;
  };
  return swapIn(fields) ?? fields;
}

let cloneCounter = 0;

/** 生成字段 key（类型前缀 + 时间戳 + 计数 + 随机段） */
export function generateFieldKey(type: WorkflowFormFieldType): string {
  cloneCounter++;
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${type}_${Date.now()}_${cloneCounter}_${random.replace(/-/g, '').slice(0, 8)}`;
}

/** 深拷贝字段并为自身及所有嵌套子字段重新生成 key（复制/粘贴共用）；withSuffix 时名称追加「副本」 */
export function cloneFieldWithNewKeys(field: WorkflowFormField, withSuffix = true): WorkflowFormField {
  const copy: WorkflowFormField = structuredClone(field);
  const reassign = (f: WorkflowFormField) => {
    f.key = generateFieldKey(f.type);
    f.children?.forEach(reassign);
    f.columns?.forEach((col) => col.fields.forEach(reassign));
    f.panes?.forEach((pane) => pane.fields.forEach(reassign));
  };
  reassign(copy);
  if (withSuffix && field.label) copy.label = `${field.label} 副本`;
  return copy;
}

/** 判断 key 是否在 ancestorKey 的子树内（防止把容器拖进自身） */
export function isDescendant(fields: WorkflowFormField[], ancestorKey: string, key: string): boolean {
  const anc = findField(fields, ancestorKey);
  if (!anc) return false;
  const sub: WorkflowFormField[] = [];
  if (anc.columns) for (const c of anc.columns) sub.push(...c.fields);
  if (anc.panes) for (const p of anc.panes) sub.push(...p.fields);
  if (anc.children) sub.push(...anc.children);
  return findField(sub, key) != null;
}

/** 递归展开所有字段（含分栏列 / 分组子 / 明细子 / 面板子） */
export function flattenAllFields(fields: WorkflowFormField[]): WorkflowFormField[] {
  const out: WorkflowFormField[] = [];
  for (const f of fields) {
    out.push(f);
    if (f.columns) for (const c of f.columns) out.push(...flattenAllFields(c.fields));
    if (f.panes) for (const p of f.panes) out.push(...flattenAllFields(p.fields));
    if (f.children) out.push(...flattenAllFields(f.children));
  }
  return out;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const replaceFormulaKey = (formula: string, oldKey: string, newKey: string): string =>
  formula.replace(
    new RegExp(`\\{\\s*${escapeRegExp(oldKey)}(\\.[^}\\s]*)?\\s*\\}`, 'g'),
    (_m, suffix) => `{${newKey}${suffix ?? ''}}`,
  );

const renameRuleGroupField = (group: WorkflowFormField['visibilityRules'], oldKey: string, newKey: string) =>
  group ? { ...group, rules: group.rules.map((r) => (r.field === oldKey ? { ...r, field: newKey } : r)) } : group;

/** 重命名字段 key，并级联更新所有引用（显隐/必填/只读规则、级联父字段、天数联动、公式） */
export function renameFieldKey(fields: WorkflowFormField[], oldKey: string, newKey: string): WorkflowFormField[] {
  return fields.map((f) => {
    const nf: WorkflowFormField = { ...f };
    if (nf.key === oldKey) nf.key = newKey;
    if (nf.visibilityCondition?.field === oldKey) {
      nf.visibilityCondition = { ...nf.visibilityCondition, field: newKey };
    }
    nf.visibilityRules = renameRuleGroupField(nf.visibilityRules, oldKey, newKey);
    nf.requiredRules = renameRuleGroupField(nf.requiredRules, oldKey, newKey);
    nf.readOnlyRules = renameRuleGroupField(nf.readOnlyRules, oldKey, newKey);
    if (nf.optionsFrom?.sourceKey === oldKey) {
      nf.optionsFrom = { ...nf.optionsFrom, sourceKey: newKey };
    }
    if (nf.autoFill) {
      nf.autoFill = {
        targets: nf.autoFill.targets.map((t) => (t === oldKey ? newKey : t)),
        byOption: Object.fromEntries(
          Object.entries(nf.autoFill.byOption).map(([opt, m]) => [
            opt,
            Object.fromEntries(Object.entries(m).map(([tk, v]) => [tk === oldKey ? newKey : tk, v])),
          ]),
        ),
      };
    }
    if (nf.daysFromKey === oldKey) nf.daysFromKey = newKey;
    if (nf.formula) nf.formula = replaceFormulaKey(nf.formula, oldKey, newKey);
    if (nf.defaultFormula) nf.defaultFormula = replaceFormulaKey(nf.defaultFormula, oldKey, newKey);
    if (nf.validationFormula) nf.validationFormula = replaceFormulaKey(nf.validationFormula, oldKey, newKey);
    if (nf.compareRules) nf.compareRules = nf.compareRules.map((r) => (r.field === oldKey ? { ...r, field: newKey } : r));
    if (nf.columns) nf.columns = nf.columns.map((c) => ({ ...c, fields: renameFieldKey(c.fields, oldKey, newKey) }));
    if (nf.panes) nf.panes = nf.panes.map((p) => ({ ...p, fields: renameFieldKey(p.fields, oldKey, newKey) }));
    if (nf.children) nf.children = renameFieldKey(nf.children, oldKey, newKey);
    return nf;
  });
}

/** 公式是否引用了某字段 key（含明细列引用 {key.col}） */
export function formulaReferencesKey(formula: string | undefined, key: string): boolean {
  if (!formula) return false;
  return new RegExp(`\\{\\s*${escapeRegExp(key)}(\\.[^}\\s]*)?\\s*\\}`).test(formula);
}

export interface FieldDependent {
  field: WorkflowFormField;
  reasons: string[];
}

/** 找出所有依赖某字段（显隐/必填/只读/级联/天数/公式）的字段，用于删除前提示 */
export function findFieldDependents(fields: WorkflowFormField[], key: string): FieldDependent[] {
  const out: FieldDependent[] = [];
  for (const f of flattenAllFields(fields)) {
    if (f.key === key) continue;
    const reasons: string[] = [];
    if (f.visibilityCondition?.field === key) reasons.push('显隐条件');
    if (f.visibilityRules?.rules?.some((r) => r.field === key)) reasons.push('联动规则');
    if (f.requiredRules?.rules?.some((r) => r.field === key)) reasons.push('条件必填');
    if (f.readOnlyRules?.rules?.some((r) => r.field === key)) reasons.push('条件只读');
    if (f.optionsFrom?.sourceKey === key) reasons.push('级联父字段');
    if (f.autoFill?.targets?.includes(key)) reasons.push('联动赋值目标');
    if (f.daysFromKey === key) reasons.push('日期天数联动');
    if (formulaReferencesKey(f.formula, key)) reasons.push('公式引用');
    if (formulaReferencesKey(f.defaultFormula, key)) reasons.push('默认值公式引用');
    if (formulaReferencesKey(f.validationFormula, key)) reasons.push('校验公式引用');
    if (f.compareRules?.some((r) => r.field === key)) reasons.push('比较校验');
    if (reasons.length > 0) out.push({ field: f, reasons });
  }
  return out;
}

const pruneRuleGroup = (group: WorkflowFormField['visibilityRules'], key: string) => {
  if (!group) return undefined;
  const rules = group.rules.filter((r) => r.field !== key);
  return rules.length > 0 ? { ...group, rules } : undefined;
};

function cleanFieldRefs(f: WorkflowFormField, key: string): WorkflowFormField {
  const nf: WorkflowFormField = { ...f };
  if (nf.visibilityCondition?.field === key) nf.visibilityCondition = undefined;
  nf.visibilityRules = pruneRuleGroup(nf.visibilityRules, key);
  nf.requiredRules = pruneRuleGroup(nf.requiredRules, key);
  nf.readOnlyRules = pruneRuleGroup(nf.readOnlyRules, key);
  if (nf.optionsFrom?.sourceKey === key) nf.optionsFrom = undefined;
  if (nf.autoFill) {
    const targets = nf.autoFill.targets.filter((t) => t !== key);
    const byOption = Object.fromEntries(
      Object.entries(nf.autoFill.byOption).map(([opt, m]) => {
        const m2 = { ...m };
        delete m2[key];
        return [opt, m2];
      }),
    );
    nf.autoFill = targets.length > 0 ? { targets, byOption } : undefined;
  }
  if (nf.daysFromKey === key) nf.daysFromKey = undefined;
  if (nf.compareRules) {
    const kept = nf.compareRules.filter((r) => r.field !== key);
    nf.compareRules = kept.length > 0 ? kept : undefined;
  }
  return nf;
}

/** 删除字段后清理依赖它的孤儿引用（显隐/级联/天数/比较）。公式保留以便校验提示。 */
export function pruneFieldReferences(fields: WorkflowFormField[], key: string): WorkflowFormField[] {
  return fields.map((f) => {
    let nf = cleanFieldRefs(f, key);
    if (nf.columns) nf = { ...nf, columns: nf.columns.map((col) => ({ ...col, fields: pruneFieldReferences(col.fields, key) })) };
    if (nf.panes) nf = { ...nf, panes: nf.panes.map((pane) => ({ ...pane, fields: pruneFieldReferences(pane.fields, key) })) };
    if (nf.children) nf = { ...nf, children: pruneFieldReferences(nf.children, key) };
    return nf;
  });
}

/** 父字段选项变化后，裁剪所有依赖它的子字段级联 mapping 中已失效的父选项键 */
export function pruneCascadeMappings(
  fields: WorkflowFormField[],
  parentKey: string,
  allowedOptions: string[],
): { fields: WorkflowFormField[]; affected: string[] } {
  const allowed = new Set(allowedOptions);
  const affected: string[] = [];
  const walk = (list: WorkflowFormField[]): WorkflowFormField[] =>
    list.map((f) => {
      let nf = f;
      if (f.optionsFrom?.sourceKey === parentKey) {
        const entries = Object.entries(f.optionsFrom.mapping);
        const kept = entries.filter(([k]) => allowed.has(k));
        if (kept.length !== entries.length) {
          affected.push(f.label || f.key);
          nf = { ...f, optionsFrom: { ...f.optionsFrom, mapping: Object.fromEntries(kept) } };
        }
      }
      if (nf.columns) nf = { ...nf, columns: nf.columns.map((col) => ({ ...col, fields: walk(col.fields) })) };
      if (nf.panes) nf = { ...nf, panes: nf.panes.map((pane) => ({ ...pane, fields: walk(pane.fields) })) };
      if (nf.children) nf = { ...nf, children: walk(nf.children) };
      return nf;
    });
  return { fields: walk(fields), affected };
}
