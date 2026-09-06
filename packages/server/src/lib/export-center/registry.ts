import { requireRow } from '../db-assert';
import type { AnyExportDefinition, ExportDefinition } from './types';
import { DEFAULT_EXPORT_EXECUTION, DEFAULT_EXPORT_RETENTION } from './types';

const registry = new Map<string, AnyExportDefinition>();

export function defineExport<TQuery extends Record<string, unknown>, TRow extends Record<string, unknown>>(
  definition: ExportDefinition<TQuery, TRow>,
): ExportDefinition<TQuery, TRow> {
  return {
    ...definition,
    formats: definition.formats ?? ['xlsx', 'csv'],
    renderMode: definition.renderMode ?? 'table',
    execution: { ...DEFAULT_EXPORT_EXECUTION, ...definition.execution },
    retention: { ...DEFAULT_EXPORT_RETENTION, ...definition.retention },
  };
}

export function registerExport(definition: AnyExportDefinition): void {
  if (registry.has(definition.entity)) {
    throw new Error(`导出实体已注册: ${definition.entity}`);
  }
  registry.set(definition.entity, definition);
}

export function getExportDefinition(entity: string): AnyExportDefinition {
  const maybeDefinition = registry.get(entity);
  const definition = requireRow(maybeDefinition, `导出实体不存在: ${entity}`);
  return definition;
}

export function listExportDefinitions(): AnyExportDefinition[] {
  return [...registry.values()].sort((a, b) => a.moduleName.localeCompare(b.moduleName, 'zh-CN'));
}
