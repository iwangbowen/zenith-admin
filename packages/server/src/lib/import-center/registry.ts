/**
 * 导入 Definition 注册表（与 export-center/registry 对偶）。
 */
import { requireRow } from '../db-assert';
import type { ImportEntityMeta } from '@zenith/shared/tasks';
import { hasPermission } from '../context';
import { DEFAULT_MAX_ROWS, type ImportDefinition } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const definitions = new Map<string, ImportDefinition<any, any>>();
let sealed = false;

export function sealImportRegistry(): void { sealed = true; }

export function registerImport<TRow, TPrepared>(def: ImportDefinition<TRow, TPrepared>): void {
  if (sealed) throw new Error('导入目录已经冻结');
  if (definitions.has(def.entity)) throw new Error(`导入实体已注册: ${def.entity}`);
  definitions.set(def.entity, def);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getImportDefinition(entity: string): ImportDefinition<any, any> {
  const maybeDef = definitions.get(entity);
  const def = requireRow(maybeDef, `未注册的导入实体：${entity}`, 400);
  return def;
}

/** 当前用户有权限的可导入实体清单 */
export async function listImportEntities(): Promise<ImportEntityMeta[]> {
  const metas: ImportEntityMeta[] = [];
  for (const def of definitions.values()) {
    if (!(await hasPermission(def.permission))) continue;
    metas.push({
      entity: def.entity,
      title: def.title,
      module: def.module,
      description: def.description ?? null,
      maxRows: def.maxRows ?? DEFAULT_MAX_ROWS,
      requiresContext: def.contextSchema != null,
      columns: def.columns,
    });
  }
  return metas.sort((a, b) => a.module.localeCompare(b.module) || a.entity.localeCompare(b.entity));
}
