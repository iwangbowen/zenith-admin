/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react';
import { Tag } from '@douyinfe/semi-ui';
import type { ColumnProps, Data } from '@douyinfe/semi-ui/lib/es/table';
import type { QueryKey } from '@tanstack/react-query';
import { MEMBER_BIZ_TYPE_LABELS } from '@zenith/shared/member';
import { ListSearchToolbar } from '@/components/list-page';
import ExportButton from '@/components/ExportButton';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { useListSearch, type UseListSearchReturn } from '@/hooks/useListSearch';
import { compactQuery } from '@/lib/query';
import { EMPTY_PLACEHOLDER, createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { memberCellColumn, useMemberKeywordDeepLink } from './member-admin-display';

/**
 * 会员流水页（积分 / 钱包）的公共骨架：会员关键字 + 类型筛选、深链、会员 / 类型 / 业务类型 / 备注 / 时间列、
 * 带权限门的导出按钮。金额列与新增 / 调整弹窗由各页自定。
 */

export interface MemberLedgerSearchParams { memberKeyword?: string; type?: string }

/** 类型标签表 → 下拉选项 */
export function ledgerTypeOptions<L extends Record<string, string>>(labels: L) {
  return (Object.keys(labels) as (keyof L & string)[]).map((v) => ({ value: v, label: labels[v] }));
}

/** `useListSearch` + 「?memberKeyword=」深链，二者在流水页总是成对出现 */
export function useMemberLedgerSearch(listKey: QueryKey): UseListSearchReturn<MemberLedgerSearchParams> {
  const search = useListSearch<MemberLedgerSearchParams>({ defaults: {}, listKey });
  useMemberKeywordDeepLink<MemberLedgerSearchParams>({
    applySearch: search.applySearch,
    buildParams: (memberKeyword) => ({ memberKeyword }),
  });
  return search;
}

export function ledgerMemberColumn<T extends Data & { memberName?: string | null; memberId: number }>(): ColumnProps<T> {
  type Field = Extract<keyof T, string>;
  return memberCellColumn<T>({ width: 140, nameField: 'memberName' as Field, idField: 'memberId' as Field });
}

export function ledgerTypeColumn<T extends Data>(labels: Record<string, string>, colors: Record<string, string>): ColumnProps<T> {
  return {
    title: '类型',
    dataIndex: 'type',
    width: 100,
    render: (v: string) => <Tag color={colors[v] as 'green'}>{labels[v]}</Tag>,
  };
}

/** 业务类型 / 备注 / 创建时间三列 */
export function ledgerTailColumns<T extends Data>(): ColumnProps<T>[] {
  return [
    { title: '业务类型', dataIndex: 'bizType', width: 130, render: (v: string | null) => (v ? (MEMBER_BIZ_TYPE_LABELS[v] ?? v) : EMPTY_PLACEHOLDER) },
    { title: '备注', dataIndex: 'remark', width: 200, render: renderEllipsis },
    createdAtColumn,
  ];
}

interface MemberLedgerToolbarProps {
  search: UseListSearchReturn<MemberLedgerSearchParams>;
  typeOptions: { value: string; label: string }[];
  /** 导出实体（`member.point-transactions` / `member.wallet-transactions`） */
  exportEntity: string;
  /** 导出按钮的权限码（无权限时不渲染） */
  exportPermission: string;
  filterTitle: string;
  create?: ReactNode;
}

export function MemberLedgerToolbar({ search, typeOptions, exportEntity, exportPermission, filterTitle, create }: Readonly<MemberLedgerToolbarProps>) {
  const { bind, bindKeyword, submittedParams, handleSearch, handleReset } = search;
  const exportQuery = compactQuery({ memberKeyword: submittedParams.memberKeyword, type: submittedParams.type });
  const renderExportButton = (variant?: 'flat') => (
    <ExportButton entity={exportEntity} query={exportQuery} variant={variant} permission={exportPermission} />
  );
  return (
    <ListSearchToolbar
      keyword={<KeywordInput placeholder="会员ID/昵称" {...bindKeyword('memberKeyword')} width={180} />}
      filters={(
        <FilterSelect
          placeholder="全部类型"
          items={typeOptions}
          {...bind('type')}
        />
      )}
      onSearch={handleSearch}
      onReset={handleReset}
      create={create}
      actions={renderExportButton()}
      mobileActions={renderExportButton('flat')}
      filterTitle={filterTitle}
    />
  );
}
