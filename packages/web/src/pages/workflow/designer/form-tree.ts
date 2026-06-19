/**
 * 表单字段树操作工具（纯函数，不可变）
 * 统一处理顶层字段、分栏（row.columns[].fields）、分组/明细（children）的
 * 查找 / 更新 / 删除 / 插入，供设计器画布的嵌套拖拽与字段配置复用。
 */
import type { WorkflowFormField, WorkflowFormFieldType } from '@zenith/shared';

/** 容器类型：内部可容纳子字段，禁止被拖入其它容器（避免无限嵌套） */
export const CONTAINER_TYPES: WorkflowFormFieldType[] = ['row', 'group', 'detail'];
export const isContainerType = (t: WorkflowFormFieldType): boolean => CONTAINER_TYPES.includes(t);

/** 拖放目标位置；beforeKey 为空表示追加到容器末尾 */
export type DropTarget =
  | { container: 'root'; beforeKey?: string }
  | { container: 'col'; rowKey: string; colIndex: number; beforeKey?: string }
  | { container: 'group'; groupKey: string; beforeKey?: string };

/** 递归查找字段（含分栏列 / 分组子 / 明细子） */
export function findField(fields: WorkflowFormField[], key: string): WorkflowFormField | null {
  for (const f of fields) {
    if (f.key === key) return f;
    if (f.columns) {
      for (const col of f.columns) {
        const r = findField(col.fields, key);
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
    if (f.children) {
      nf = { ...nf, children: insertAfterKey(f.children, afterKey, field) };
    }
    out.push(nf);
    if (f.key === afterKey) out.push(field);
  }
  return out;
}

/** 判断 key 是否在 ancestorKey 的子树内（防止把容器拖进自身） */
export function isDescendant(fields: WorkflowFormField[], ancestorKey: string, key: string): boolean {
  const anc = findField(fields, ancestorKey);
  if (!anc) return false;
  const sub: WorkflowFormField[] = [];
  if (anc.columns) for (const c of anc.columns) sub.push(...c.fields);
  if (anc.children) sub.push(...anc.children);
  return findField(sub, key) != null;
}
