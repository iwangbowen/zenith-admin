/**
 * 我的字段模板 — localStorage 持久化的个人字段配置模板。
 * 在设计器右键「存为我的模板」保存，控件面板「我的模板」分组一键插入（插入时重新生成 key）。
 */
import type { WorkflowFormField } from '@zenith/shared';

const STORAGE_KEY = 'zenith_form_field_templates';
/** 模板列表变更事件（同页面内各组件同步刷新） */
export const FIELD_TEMPLATES_CHANGED_EVENT = 'zenith:field-templates-changed';

export interface FieldTemplateEntry {
  id: string;
  name: string;
  field: WorkflowFormField;
  createdAt: string;
}

export function loadFieldTemplates(): FieldTemplateEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FieldTemplateEntry[];
    return Array.isArray(parsed) ? parsed.filter((t) => t && t.id && t.field?.type) : [];
  } catch {
    return [];
  }
}

function persist(list: FieldTemplateEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(FIELD_TEMPLATES_CHANGED_EVENT));
  } catch {
    /* 存储满/隐私模式等场景静默失败 */
  }
}

export function saveFieldTemplate(name: string, field: WorkflowFormField): void {
  const entry: FieldTemplateEntry = {
    id: globalThis.crypto?.randomUUID?.() ?? `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    field: structuredClone(field),
    createdAt: new Date().toISOString(),
  };
  persist([entry, ...loadFieldTemplates()].slice(0, 50));
}

export function removeFieldTemplate(id: string): void {
  persist(loadFieldTemplates().filter((t) => t.id !== id));
}
