import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { CanonicalEntityType } from '@zenith/shared/platform/entity-catalog';
import EntityRelationButton from './EntityRelationButton';

/**
 * A notification dispatch points to its outbox; an absent key never falls back to the row ID.
 *
 * `fixed: 'right'` 只用于把本列并入表格尾部连续的右固定块（紧邻状态 / 操作列左侧）：
 * Semi 以「其后所有列宽之和」作为每个右固定列的 sticky 偏移，非固定列夹在固定块中间时，
 * 它前面那一列的偏移会为它留出一道缝、普通列从缝里滑过（见 ui-patterns.md → 表格列宽）。
 */
export function entityRelationColumn<T extends { id: number }>(
  entityType: CanonicalEntityType,
  keyOf: (record: T) => number | null | undefined = (record) => record.id,
  { fixed }: { fixed?: 'right' } = {},
): ColumnProps<T> {
  return {
    title: '关联信息', key: 'entityRelations', width: 120, fixed,
    render: (_: unknown, record: T) => {
      const key = keyOf(record);
      return key == null ? null : <EntityRelationButton entityRef={{ type: entityType, key: String(key) }} />;
    },
  };
}
