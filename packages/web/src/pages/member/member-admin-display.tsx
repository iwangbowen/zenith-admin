import type { ReactNode } from 'react';
import type { ColumnProps, Data } from '@douyinfe/semi-ui/lib/es/table';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { renderEllipsis } from '@/utils/table-columns';

interface RenderMemberNameOptions {
  name?: string | null;
  nickname?: string | null;
  memberId?: number | string | null;
  empty?: string;
}

/** 展示名：昵称优先 → 姓名 → `#ID` → empty；始终返回字符串，便于再交给 `renderEllipsis` 等文本 render */
export function renderMemberName({ name, nickname, memberId, empty = '—' }: RenderMemberNameOptions): string {
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
  ellipsis = false,
}: {
  title?: ReactNode;
  width?: number;
  nameField: FieldKey<T>;
  nicknameField?: FieldKey<T>;
  idField: FieldKey<T>;
  /** 展示名单行省略 + 悬停 tooltip（昵称是自由文本，长昵称不再把行撑成两行） */
  ellipsis?: boolean;
}): ColumnProps<T> {
  return {
    title,
    dataIndex: nameField,
    width,
    render: (_value: unknown, record: T) => {
      const name = renderMemberName({
        name: record[nameField] as string | null | undefined,
        nickname: nicknameField ? (record[nicknameField] as string | null | undefined) : undefined,
        memberId: record[idField] as number | string | null | undefined,
      });
      return ellipsis ? renderEllipsis(name) : name;
    },
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
