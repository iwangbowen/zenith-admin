import { useMemo } from 'react';
import { Button, Form, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Coins } from 'lucide-react';
import type { AdjustMemberPointsInput, MemberPointTransaction } from '@zenith/shared/member';
import { MEMBER_BIZ_TYPE_LABELS, POINT_TX_TYPES, POINT_TX_TYPE_LABELS } from '@zenith/shared/member';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { MemberSelect } from '@/components/MemberSelect';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { memberAdminKeys, useAdjustMemberPoints, useMemberPointTransactions } from '@/hooks/queries/member-admin';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';

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
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset, applySearch,
  } = useListSearch<SearchParams>({ defaults: {}, listKey: memberAdminKeys.pointLists });
  // 会员详情等入口的深链筛选（?memberKeyword=，消费后即从 URL 移除）
  useListDeepLink(['memberKeyword'], (p) => applySearch({ memberKeyword: p.memberKeyword }));
  const listQuery = useMemberPointTransactions({
    page,
    pageSize,
    memberKeyword: submittedParams.memberKeyword || undefined,
    type: enumValueOf(POINT_TX_TYPES, submittedParams.type),
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
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
    { title: '会员', dataIndex: 'memberName', width: 140, render: (v?: string, r?: MemberPointTransaction) => v || `#${r?.memberId}` },
    { title: '类型', dataIndex: 'type', width: 100, render: (v: string) => <Tag color={TYPE_COLORS[v] as 'green'}>{POINT_TX_TYPE_LABELS[v as keyof typeof POINT_TX_TYPE_LABELS]}</Tag> },
    { title: '变动', dataIndex: 'amount', width: 100, align: 'right', render: (v: number) => <span style={{ color: v >= 0 ? 'var(--semi-color-success)' : 'var(--semi-color-danger)' }}>{v >= 0 ? `+${v}` : v}</span> },
    { title: '变动后', dataIndex: 'balanceAfter', width: 100, align: 'right' },
    { title: '业务类型', dataIndex: 'bizType', width: 130, render: (v: string | null) => (v ? (MEMBER_BIZ_TYPE_LABELS[v] ?? v) : '-') },
    { title: '备注', dataIndex: 'remark', width: 200, render: renderEllipsis },
    createdAtColumn,
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="会员ID/昵称" value={draftParams.memberKeyword} onChange={(v) => setDraftParams((p) => ({ ...p, memberKeyword: v }))} onSearch={handleSearch} width={180} />
  );

  const renderTypeFilter = () => (
    <FilterSelect
      placeholder="全部类型"
      items={typeOptions}
      value={draftParams.type}
      onChange={(v) => setDraftParams((p) => ({ ...p, type: v as string | undefined }))}
    />
  );

  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const buildExportQuery = () => ({
    ...(submittedParams.memberKeyword ? { memberKeyword: submittedParams.memberKeyword } : {}),
    ...(submittedParams.type ? { type: submittedParams.type } : {}),
  });
  const renderExportButton = (variant?: 'flat') => hasPermission('member:point:list') ? (
    <ExportButton entity="member.point-transactions" query={buildExportQuery()} variant={variant} />
  ) : null;
  const renderAdjustButton = () => hasPermission('member:point:adjust') ? (
    <Button type="primary" icon={<Coins size={14} />} onClick={adjustModal.openCreate}>调整积分</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderTypeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderExportButton()}
            {renderAdjustButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderAdjustButton()}
          </>
        )}
        mobileFilters={renderTypeFilter()}
        mobileActions={renderExportButton('flat')}
        filterTitle="积分流水筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable bordered columns={columns} dataSource={data} loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} rowKey="id" size="small"
        pagination={buildPagination(total)} empty="暂无积分流水" />

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
