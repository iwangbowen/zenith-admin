import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Form, Toast, Tag } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw, Coins } from 'lucide-react';
import type { MemberPointTransaction } from '@zenith/shared';
import { POINT_TX_TYPE_LABELS } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { MemberSelect } from '@/components/MemberSelect';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { memberAdminKeys, useAdjustMemberPoints, useMemberPointTransactions } from '@/hooks/queries/member-admin';

const typeOptions = (Object.keys(POINT_TX_TYPE_LABELS) as (keyof typeof POINT_TX_TYPE_LABELS)[]).map((v) => ({ value: v, label: POINT_TX_TYPE_LABELS[v] }));
const TYPE_COLORS: Record<string, string> = { earn: 'green', redeem: 'orange', expire: 'grey', adjust: 'blue', refund: 'cyan' };

interface SearchParams { memberKeyword?: string; type?: string }

export default function MemberPointsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const adjustFormApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>({});
  const [submittedParams, setSubmittedParams] = useState<SearchParams>({});
  const [adjustVisible, setAdjustVisible] = useState(false);
  const listQuery = useMemberPointTransactions({
    page,
    pageSize,
    memberKeyword: submittedParams.memberKeyword || undefined,
    type: submittedParams.type || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const adjustMutation = useAdjustMemberPoints();

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: memberAdminKeys.pointLists });
  };
  const handleReset = () => {
    setDraftParams({});
    setSubmittedParams({});
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: memberAdminKeys.pointLists });
  };

  const handleAdjust = async () => {
    let values;
    try { values = await adjustFormApi.current!.validate(); } catch { throw new Error('validation'); }
    await adjustMutation.mutateAsync(values);
    Toast.success('调整成功');
    setAdjustVisible(false);
  };

  const columns: ColumnProps<MemberPointTransaction>[] = [
    { title: '会员', dataIndex: 'memberName', width: 140, render: (v?: string, r?: MemberPointTransaction) => v || `#${r?.memberId}` },
    { title: '类型', dataIndex: 'type', width: 100, render: (v: string) => <Tag color={TYPE_COLORS[v] as 'green'}>{POINT_TX_TYPE_LABELS[v as keyof typeof POINT_TX_TYPE_LABELS]}</Tag> },
    { title: '变动', dataIndex: 'amount', width: 100, render: (v: number) => <span style={{ color: v >= 0 ? 'var(--semi-color-success)' : 'var(--semi-color-danger)' }}>{v >= 0 ? `+${v}` : v}</span> },
    { title: '变动后', dataIndex: 'balanceAfter', width: 100 },
    { title: '业务类型', dataIndex: 'bizType', width: 130, render: (v: string | null) => v || '-' },
    { title: '备注', dataIndex: 'remark', width: 200, render: renderEllipsis },
    createdAtColumn,
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="会员ID/昵称"
      value={draftParams.memberKeyword}
      showClear
      style={{ width: 180 }}
      onChange={(v) => setDraftParams((p) => ({ ...p, memberKeyword: v || undefined }))}
      onEnterPress={handleSearch}
    />
  );

  const renderTypeFilter = () => (
    <Select
      placeholder="全部类型"
      value={draftParams.type}
      style={{ width: 130 }}
      showClear
      onChange={(v) => setDraftParams((p) => ({ ...p, type: v as string | undefined }))}
      optionList={typeOptions}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderAdjustButton = () => hasPermission('member:point:adjust') ? (
    <Button type="primary" icon={<Coins size={14} />} onClick={() => setAdjustVisible(true)}>调整积分</Button>
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
        filterTitle="积分流水筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable bordered columns={columns} dataSource={data} loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} rowKey="id" size="small"
        pagination={buildPagination(total)} empty="暂无积分流水" />

      <AppModal title="调整会员积分" visible={adjustVisible} width={480} onCancel={() => setAdjustVisible(false)} onOk={handleAdjust}>
        <Form getFormApi={(api) => { adjustFormApi.current = api; }} labelPosition="left" labelWidth={90}>
          <MemberSelect field="memberId" required />
          <Form.InputNumber field="delta" label="变动量" style={{ width: '100%' }} placeholder="正数增加，负数扣减"
            rules={[{ required: true, message: '请输入变动量' }]} />
          <Form.TextArea field="remark" label="备注" placeholder="调整原因" maxCount={256} />
        </Form>
      </AppModal>
    </div>
  );
}
