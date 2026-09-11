import type { ImportEntityMeta } from '@zenith/shared/tasks';

/** 可导入实体按模块分组（保持注册顺序），供实体筛选下拉与新建导入弹窗的分组选择共用 */
export function groupImportEntitiesByModule(entities: ImportEntityMeta[]): [module: string, items: ImportEntityMeta[]][] {
  const byModule = new Map<string, ImportEntityMeta[]>();
  for (const e of entities) {
    const group = byModule.get(e.module) ?? [];
    group.push(e);
    byModule.set(e.module, group);
  }
  return [...byModule.entries()];
}
