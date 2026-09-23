import DOMPurify from 'dompurify';
import type { CmsModelField } from '@zenith/shared/cms';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { formatDate, formatDateTime } from '@/utils/date';

type DisplayField = Pick<CmsModelField, 'fieldType'> & Partial<Pick<CmsModelField, 'options' | 'resolvedOptions' | 'configuration'>>;

/** 按当前行冻结的字段定义展示，结构字段使用子字段标签，避免对象退化为 [object Object]。 */
export function cmsFieldDisplayText(value: unknown, field?: DisplayField): string {
  if (value == null || value === '') return EMPTY_PLACEHOLDER;
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.map((item) => cmsFieldDisplayText(item, field)).join('；');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const block = field?.configuration?.blockTypes?.find((item) => item.code === record.blockType);
    const definitions = block?.fields ?? field?.configuration?.fields ?? [];
    const summary = Object.entries(record).filter(([name]) => name !== 'blockType').map(([name, item]) => {
      const definition = definitions.find((child) => child.name === name);
      return `${definition?.label ?? name}：${cmsFieldDisplayText(item, definition)}`;
    }).join('，');
    return block ? `${block.label}（${summary}）` : summary || EMPTY_PLACEHOLDER;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    if (field?.fieldType === 'date') return formatDate(value);
    if (field?.fieldType === 'datetime') return formatDateTime(value);
  }
  if (field?.fieldType === 'richtext' && typeof value === 'string') return DOMPurify.sanitize(value, { ALLOWED_TAGS: [] });
  const options = field?.resolvedOptions ?? field?.options ?? [];
  return options.find((option) => option.value === String(value))?.label ?? String(value);
}
