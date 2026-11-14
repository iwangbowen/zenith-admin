import type { ExportJobFormat, ExportPreset, ExportPreview } from '@zenith/shared/tasks';

/** Applying a template must preserve its requested fields and the entry point format boundary. */
export function resolveExportPreset(preset: Pick<ExportPreset, 'format' | 'columns'>, preview: Pick<ExportPreview, 'formats' | 'columns' | 'supportsColumns'>, entryFormats: readonly ExportJobFormat[]) {
  if (!entryFormats.includes(preset.format) || !preview.formats.includes(preset.format)) throw new Error('此模板的文件格式不适用于当前导出入口');
  const columns = preset.columns ?? preview.columns.map(column => column.key);
  const available = new Set(preview.columns.map(column => column.key));
  if (preview.supportsColumns && (!columns.length || new Set(columns).size !== columns.length || columns.some(key => !available.has(key)))) throw new Error('此模板包含已失效或重复字段，请重新保存模板');
  return { format: preset.format, columns: preview.supportsColumns ? columns : [] };
}
