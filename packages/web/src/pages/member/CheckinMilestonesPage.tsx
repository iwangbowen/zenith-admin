import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Form, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { CheckinMilestone, CheckinMilestoneRewardType } from '@zenith/shared/member';
import { CHECKIN_MILESTONE_REWARD_TYPE_LABELS } from '@zenith/shared/member';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { AppModal } from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { renderEllipsis } from '../../utils/table-columns';
import {
  memberAdminKeys,
  useCheckinMilestones,
  useCouponList,
  useDeleteCheckinMilestone,
  useSaveCheckinMilestone,
  type CheckinMilestoneFormValues,
} from '@/hooks/queries/member-admin';
import { CreateButton, RefreshButton } from '@/components/toolbar-controls';
import { confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';

interface CouponOption {
  value: number;
  label: string;
}

export default function CheckinMilestonesPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const [rewardType, setRewardType] = useState<CheckinMilestoneRewardType>('points');
  const listQuery = useCheckinMilestones();
  const couponsQuery = useCouponList({ page: 1, pageSize: 100 });
  const data = listQuery.data ?? [];
  const coupons: CouponOption[] = (couponsQuery.data?.list ?? []).map((c) => ({ value: c.id, label: c.name }));
  const saveMutation = useSaveCheckinMilestone();
  const deleteMutation = useDeleteCheckinMilestone();
  const modal = useEditModal<CheckinMilestone, CheckinMilestoneFormValues>({
    entityName: '里程碑',
    save: saveMutation,
    defaults: { title: '', cumulativeDays: 7, rewardType: 'points', rewardPoints: 0, couponId: undefined, enabled: true, remark: '' },
    beforeSave: (values) => ({
      ...values,
      couponId: values.rewardType === 'coupon' ? values.couponId : null,
      rewardPoints: values.rewardType === 'points' ? values.rewardPoints : 0,
    }),
    onSaved: () => setRewardType('points'),
  });

  const openModal = (record: CheckinMilestone | null) => {
    setRewardType(record?.rewardType ?? 'points');
    if (record) modal.openEdit(record);
    else modal.openCreate();
  };

  const handleDelete = (record: CheckinMilestone) => {
    confirmDelete({
      title: `确认删除里程碑「${record.title}」？`,
      content: '删除后该累计天数的奖励配置将失效。',
      onOk: async () => {
        await deleteMutation.mutateAsync({ params: { id: record.id } });
        Toast.success('删除成功');
      },
    });
  };

  const columns: ColumnProps<CheckinMilestone>[] = [
    { title: '名称', dataIndex: 'title', minWidth: 160, render: renderEllipsis },
    { title: '累计天数', dataIndex: 'cumulativeDays', width: 100, align: 'right' },
    {
      title: '奖励类型',
      dataIndex: 'rewardType',
      width: 100,
      render: (value: CheckinMilestoneRewardType) => (
        <Tag color={value === 'coupon' ? 'orange' : 'blue'} size="small">
          {CHECKIN_MILESTONE_REWARD_TYPE_LABELS[value]}
        </Tag>
      ),
    },
    {
      title: '奖励内容',
      width: 160,
      render: (_: unknown, record: CheckinMilestone) =>
        record.rewardType === 'coupon' ? (record.couponName || `券#${record.couponId ?? '-'}`) : `${record.rewardPoints} 积分`,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 90,
      fixed: 'right',
      render: (value: boolean) => (
        <Tag color={value ? 'green' : 'grey'} size="small">{value ? '启用' : '停用'}</Tag>
      ),
    },
    createOperationColumn<CheckinMilestone>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !hasPermission('member:checkin:milestone:update'), onClick: () => openModal(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !hasPermission('member:checkin:milestone:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderRefreshButton = () => (
    <RefreshButton onClick={() => void queryClient.invalidateQueries({ queryKey: memberAdminKeys.checkinMilestones })} />
  );

  const renderCreateButton = () => hasPermission('member:checkin:milestone:create') ? (
    <CreateButton onClick={() => openModal(null)} />
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderRefreshButton()}
            {renderCreateButton()}
          </>
        )}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="id"
        size="small"
        pagination={false}
        empty="暂无里程碑配置"
      />

      <AppModal
        {...modal.modalProps}
        width={560}
      >
        <Form
          key={modal.formKey} {...modal.formProps}
          onValueChange={(values) => setRewardType(values.rewardType as CheckinMilestoneRewardType)}
        >
          <Form.Input field="title" label="名称" maxLength={64} rules={[{ required: true, message: '请输入名称' }]} />
          <Form.InputNumber field="cumulativeDays" label="累计天数" min={1} style={{ width: '100%' }} rules={[{ required: true, message: '请输入累计天数' }]} />
          <Form.Select field="rewardType" label="奖励类型" style={{ width: '100%' }} rules={[{ required: true, message: '请选择奖励类型' }]}>
            <Form.Select.Option value="points">积分</Form.Select.Option>
            <Form.Select.Option value="coupon">优惠券</Form.Select.Option>
          </Form.Select>
          {rewardType === 'points' ? (
            <Form.InputNumber field="rewardPoints" label="积分奖励" min={0} style={{ width: '100%' }} rules={[{ required: true, message: '请输入积分奖励' }]} />
          ) : (
            <Form.Select field="couponId" label="优惠券" style={{ width: '100%' }} optionList={coupons} filter rules={[{ required: true, message: '请选择优惠券' }]} placeholder="请选择优惠券" />
          )}
          <Form.Switch field="enabled" label="启用" />
          <Form.TextArea field="remark" label="备注" maxCount={256} placeholder="请输入备注" />
        </Form>
      </AppModal>
    </div>
  );
}
