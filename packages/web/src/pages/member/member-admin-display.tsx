import type { ReactNode } from 'react';
import type { ColumnProps, Data } from '@douyinfe/semi-ui/lib/es/table';
import { useListDeepLink } from '@/hooks/useListDeepLink';

interface RenderMemberNameOptions {
  name?: string | null;
  nickname?: string | null;
  memberId?: number | string | null;
  empty?: ReactNode;
}

export function renderMemberName({ name, nickname, memberId, empty = '—' }: RenderMemberNameOptions): ReactNode {
  const displayName = nickname || name;
  if (displayName) return displayName;
  return memberId == null || memberId === '' ? empty : `#${memberId}`;
}

type FieldKey<T> = Extract<keyof T, string>;

export function memberCellColumn<T extends Data>({
  title = '会员',
  width,
  nameField,
  nicknameField,
  idField,
}: {
  title?: ReactNode;
  width?: number;
  nameField: FieldKey<T>;
  nicknameField?: FieldKey<T>;
  idField: FieldKey<T>;
}): ColumnProps<T> {
  return {
    title,
    dataIndex: nameField,
    width,
    render: (_value: unknown, record: T) => renderMemberName({
      name: record[nameField] as string | null | undefined,
      nickname: nicknameField ? (record[nicknameField] as string | null | undefined) : undefined,
      memberId: record[idField] as number | string | null | undefined,
    }),
  };
}

export function signedNumberChange(value: number): ReactNode {
  return (
    <span style={{ color: value >= 0 ? 'var(--semi-color-success)' : 'var(--semi-color-danger)' }}>
      {value >= 0 ? `+${value}` : value}
    </span>
  );
}

export function signedYuanChange(cents: number): ReactNode {
  const yuan = (cents / 100).toFixed(2);
  return (
    <span style={{ color: cents >= 0 ? 'var(--semi-color-success)' : 'var(--semi-color-danger)' }}>
      {cents >= 0 ? `+${yuan}` : yuan}
    </span>
  );
}

export function useMemberKeywordDeepLink<SearchParams>({
  applySearch,
  buildParams,
}: {
  applySearch: (params: SearchParams) => void;
  buildParams: (memberKeyword: string | undefined) => SearchParams;
}) {
  useListDeepLink(['memberKeyword'], (params) => applySearch(buildParams(params.memberKeyword)));
}
