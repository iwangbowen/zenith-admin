import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { CanonicalEntityType } from '@zenith/shared/platform/entity-catalog';
import EntityRelationButton from './EntityRelationButton';

/** A notification dispatch points to its outbox; an absent key never falls back to the row ID. */
export function entityRelationColumn<T extends { id: number }>(entityType: CanonicalEntityType, keyOf: (record: T) => number | null | undefined = (record) => record.id): ColumnProps<T> {
  return {
    title: '关联信息', key: 'entityRelations', width: 120,
    render: (_: unknown, record: T) => {
      const key = keyOf(record);
      return key == null ? null : <EntityRelationButton entityRef={{ type: entityType, key: String(key) }} />;
    },
  };
}
