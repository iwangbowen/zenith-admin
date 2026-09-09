import { useMemo } from 'react';
import { Button, Form, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Coins } from 'lucide-react';
import type { AdjustMemberPointsInput, MemberPointTransaction } from '@zenith/shared/member';
import { MEMBER_BIZ_TYPE_LABELS, POINT_TX_TYPES, POINT_TX_TYPE_LABELS } from '@zenith/shared/member';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import ExportButton from '@/components/ExportButton';
import { MemberSelect } from '@/components/MemberSelect';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { memberAdminKeys, useAdjustMemberPoints, useMemberPointTransactions } from '@/hooks/queries/member-admin';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { memberCellColumn, signedNumberChange, useMemberKeywordDeepLink } from './member-admin-display';
import { compactQuery } from '@/lib/query';

const typeOptions = (Object.keys(POINT_TX_TYPE_LABELS) as (keyof typeof POINT_TX_TYPE_LABELS)[]).map((v) => ({ value: v, label: POINT_TX_TYPE_LABELS[v] }));
const TYPE_COLORS: Record<string, string> = { earn: 'green', redeem: 'orange', expire: 'grey', adjust: 'blue', refund: 'cyan' };

interface SearchParams { memberKeyword?: string; type?: string }

type AdjustPointFormValues = AdjustMemberPointsInput;

interface AdjustPointModalRecord {
  id: number;
}

export default function MemberPointsPage() {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset, applySearch,
  } = useListSearch<SearchParams>({ defaults: {}, listKey: memberAdminKeys.pointLists });
  useMemberKeywordDeepLink<SearchParams>({ applySearch, buildParams: (memberKeyword) => ({ memberKeyword }) });
  const listQuery = useMemberPointTransactions({
    page,
    pageSize,
    memberKeyword: submittedParams.memberKeyword || undefined,
    type: enumValueOf(POINT_TX_TYPES, submittedParams.type),
  });
  const adjustMutation = useAdjustMemberPoints();
  const adjustSave = useMemo(() => ({
    mutateAsync: async ({ values }: { id?: number; values: AdjustPointFormValues }) => {
      await adjustMutation.mutateAsync({ body: values });
      return { id: 0 };
    },
    isPending: adjustMutation.isPending,
  }), [adjustMutation]);
  const adjustModal = useEditModal<AdjustPointModalRecord, AdjustPointFormValues>({
    save: adjustSave,
    successMessage: () => '调整成功',
  });

  const columns: ColumnProps<MemberPointTransaction>[] = [
    memberCellColumn<MemberPointTransaction>({ width: 140, nameField: 'memberName', idField: 'memberId' }),
    { title: '类型', dataIndex: 'type', width: 100, render: (v: string) => <Tag color={TYPE_COLORS[v] as 'green'}>{POINT_TX_TYPE_LABELS[v as keyof typeof POINT_TX_TYPE_LABELS]}</Tag> },
    { title: '变动', dataIndex: 'amount', width: 100, align: 'right', render: signedNumberChange },
    { title: '变动后', dataIndex: 'balanceAfter', width: 100, align: 'right' },
    { title: '业务类型', dataIndex: 'bizType', width: 130, render: (v: string | null) => (v ? (MEMBER_BIZ_TYPE_LABELS[v] ?? v) : '-') },
    { title: '备注', dataIndex: 'remark', width: 200, render: renderEllipsis },
    createdAtColumn,
  ];

  const buildExportQuery = () => compactQuery({
    memberKeyword: submittedParams.memberKeyword,
    type: submittedParams.type,
  });
  const renderExportButton = (variant?: 'flat') => hasPermission('member:point:list') ? (
    <ExportButton entity="member.point-transactions" query={buildExportQuery()} variant={variant} />
  ) : null;

  return (
    <div className="page-container">
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
        create={(
          hasPermission('member:point:adjust') ? (
            <Button type="primary" icon={<Coins size={14} />} onClick={adjustModal.openCreate}>调整积分</Button>
          ) : null
        )}
        actions={renderExportButton()}
        mobileActions={renderExportButton('flat')}
        filterTitle="积分流水筛选"
      />

      <ConfigurableTable<MemberPointTransaction> columns={columns} {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无积分流水' })} />

      <AppModal {...adjustModal.modalProps} title="调整会员积分" width={480}>
        <Form key={adjustModal.formKey} {...adjustModal.formProps}>
          <MemberSelect field="memberId" required />
          <Form.InputNumber field="delta" label="变动量" style={{ width: '100%' }} placeholder="正数增加，负数扣减"
            rules={[{ required: true, message: '请输入变动量' }]} />
          <Form.TextArea field="remark" label="备注" placeholder="调整原因" maxCount={256} />
        </Form>
      </AppModal>
    </div>
  );
}
