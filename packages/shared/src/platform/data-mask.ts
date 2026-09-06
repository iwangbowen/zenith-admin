import type { DataMaskField } from './contracts/data-mask';

export interface DataMaskFieldFilter {
  keyword?: string;
  entity?: string;
  maskType?: string;
  enabled?: boolean;
  overridden?: boolean;
}

/**
 * 敏感字段清单的筛选谓词：关键词对实体 / 字段 / 标签 / 键做大小写无关的模糊匹配，其余条件精确匹配。
 * 服务端 `/api/data-mask/fields` 与 Demo Mock 共用。
 */
export function matchesDataMaskFieldQuery(
  item: Pick<DataMaskField, 'entity' | 'field' | 'label' | 'key' | 'maskType' | 'enabled' | 'overridden'>,
  query: DataMaskFieldFilter,
): boolean {
  const keyword = query.keyword?.trim().toLowerCase();
  if (keyword && ![item.entity, item.field, item.label, item.key].some((v) => v.toLowerCase().includes(keyword))) return false;
  if (query.entity && item.entity !== query.entity) return false;
  if (query.maskType && item.maskType !== query.maskType) return false;
  if (query.enabled !== undefined && item.enabled !== query.enabled) return false;
  if (query.overridden !== undefined && item.overridden !== query.overridden) return false;
  return true;
}
