import type { TaskAction } from '../../../lib/workflow-engine';

/**
 * 根据子流程节点配置的 subProcessFieldMapping，构造子实例 formData。
 * value 支持模板占位：
 * - `{{form.x}}` / `{{x}}` 引用父实例 formData 字段
 * - `{{item}}` 引用当前循环项的值（多实例）；`{{item.prop}}` 取循环项对象的属性
 */
export function buildChildFormData(
  mapping: Record<string, string> | undefined,
  parentFormData: Record<string, unknown>,
  item?: unknown,
): Record<string, unknown> {
  if (!mapping) return {};
  const resolveSingle = (rawKey: string): unknown => {
    const k = rawKey.trim();
    if (k === 'item') return item;
    if (k.startsWith('item.')) {
      const prop = k.slice(5).trim();
      return item && typeof item === 'object' ? (item as Record<string, unknown>)[prop] : undefined;
    }
    if (k.startsWith('form.')) return parentFormData[k.slice(5).trim()];
    return parentFormData[k];
  };
  const out: Record<string, unknown> = {};
  for (const [childKey, expr] of Object.entries(mapping)) {
    if (typeof expr !== 'string') continue;
    if (expr.includes('{{')) {
      const tplMatch = expr.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
      if (tplMatch) {
        // 整段就是单个引用：保留原值类型
        out[childKey] = resolveSingle(tplMatch[1]);
      } else {
        out[childKey] = expr.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => {
          const v = resolveSingle(k);
          if (v == null || typeof v === 'object') return '';
          return String(v);
        });
      }
    } else {
      out[childKey] = expr;
    }
  }
  return out;
}


export function resolveMultiItems(nodeCfg: TaskAction['nodeConfig'], parentFormData: Record<string, unknown>): unknown[] {
  const raw = nodeCfg.subProcessMultiSource ? parentFormData[nodeCfg.subProcessMultiSource] : undefined;
  if (Array.isArray(raw)) return raw;
  if (raw == null || raw === '') return [];
  return [raw];
}
