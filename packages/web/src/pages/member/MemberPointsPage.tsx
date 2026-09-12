import { useMemo } from 'react';
import { Button, Form } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Coins } from 'lucide-react';
import type { AdjustMemberPointsInput, MemberPointTransaction } from '@zenith/shared/member';
import { POINT_TX_TYPES, POINT_TX_TYPE_LABELS } from '@zenith/shared/member';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { listTableProps } from '@/components/list-page';
import { MemberSelect } from '@/components/MemberSelect';
import { memberAdminKeys, useAdjustMemberPoints, useMemberPointTransactions } from '@/hooks/queries/member-admin';
import { useEditModal } from '@/hooks/useEditModal';
import { signedNumberChange } from './member-admin-display';
import { compactParams } from '@/lib/query';
import {
  MemberLedgerToolbar,
  ledgerMemberColumn,
  ledgerTailColumns,
  ledgerTypeColumn,
  ledgerTypeOptions,
  useMemberLedgerSearch,
} from './member-ledger';

const typeOptions = ledgerTypeOptions(POINT_TX_TYPE_LABELS);
const TYPE_COLORS: Record<string, string> = { earn: 'green', redeem: 'orange', expire: 'grey', adjust: 'blue', refund: 'cyan' };

type AdjustPointFormValues = AdjustMemberPointsInput;

interface AdjustPointModalRecord {
  id: number;
}

export default function MemberPointsPage() {
  const { hasPermission } = usePermission();
  const search = useMemberLedgerSearch(memberAdminKeys.pointLists);
  const { page, pageSize, buildPagination, submittedParams } = search;
  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    memberKeyword: submittedParams.memberKeyword,
    type: enumValueOf(POINT_TX_TYPES, submittedParams.type),
  }), [submittedParams]);
  const listQuery = useMemberPointTransactions({
    page,
    pageSize,
    ...filterQuery,
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
    ledgerMemberColumn<MemberPointTransaction>(),
    ledgerTypeColumn<MemberPointTransaction>(POINT_TX_TYPE_LABELS, TYPE_COLORS),
    { title: '变动', dataIndex: 'amount', width: 100, align: 'right', render: signedNumberChange },
    { title: '变动后', dataIndex: 'balanceAfter', width: 100, align: 'right' },
    ...ledgerTailColumns<MemberPointTransaction>(),
  ];

  return (
    <div className="page-container">
      <MemberLedgerToolbar
        search={search}
        typeOptions={typeOptions}
        exportEntity="member.point-transactions"
        exportPermission="member:point:list"
        filterTitle="积分流水筛选"
        create={(
          hasPermission('member:point:adjust') ? (
            <Button type="primary" icon={<Coins size={14} />} onClick={adjustModal.openCreate}>调整积分</Button>
          ) : null
        )}
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
