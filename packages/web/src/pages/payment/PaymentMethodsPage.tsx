import { useState, useRef } from 'react';
import { PAYMENT_CHANNEL_TAG_COLOR } from '@/utils/payment';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Switch, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { RotateCcw } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentMethod, PaymentMethodConfig } from '@zenith/shared';
import { paymentMethodKeys, usePaymentMethodList, useSavePaymentMethod } from '@/hooks/queries/payment-methods';

interface MethodFormValues { label: string; icon?: string; sort?: number; enabled?: boolean; }

export default function PaymentMethodsPage() {
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('payment:method:update');
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const [editing, setEditing] = useState<PaymentMethodConfig | null>(null);
  const listQuery = usePaymentMethodList();
  const list = listQuery.data ?? [];
  const saveMutation = useSavePaymentMethod();
  const toggleMutation = useSavePaymentMethod();
  const togglingId = toggleMutation.isPending ? (toggleMutation.variables?.id ?? null) : null;

  function openEdit(record: PaymentMethodConfig) { setEditing(record); }
  function closeModal() { setEditing(null); }

  function handleToggle(record: PaymentMethodConfig, checked: boolean) {
    toggleMutation.mutate(
      { id: record.id, values: { enabled: checked } },
      { onSuccess: () => Toast.success(checked ? '已启用' : '已停用') },
    );
  }

  async function handleOk() {
    let values: MethodFormValues;
    try { values = (await formApi.current?.validate()) as MethodFormValues; } catch { throw new Error('validation'); }
    if (!editing) return;
    await saveMutation.mutateAsync({
      id: editing.id,
      values: { label: values.label, icon: values.icon || undefined, sort: values.sort ?? 0 },
    });
    Toast.success('更新成功');
    closeModal();
  }

  const columns: ColumnProps<PaymentMethodConfig>[] = [
    { title: '排序', dataIndex: 'sort', width: 70 },
    { title: '支付方式', dataIndex: 'method', width: 150, render: (v: PaymentMethod) => PAYMENT_METHOD_LABELS[v] },
    { title: '展示名称', dataIndex: 'label', width: 160 },
    { title: '渠道', dataIndex: 'channel', width: 110, render: (v: PaymentChannel) => <Tag color={PAYMENT_CHANNEL_TAG_COLOR[v]}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '图标', dataIndex: 'icon', width: 140, render: (v: string | null) => v || '-' },
    {
      title: '状态', dataIndex: 'enabled', width: 90, fixed: 'right',
      render: (_: unknown, r: PaymentMethodConfig) => (
        <Switch checked={r.enabled} loading={togglingId === r.id} disabled={!canUpdate} size="small" onChange={(c) => handleToggle(r, c)} />
      ),
    },
    createOperationColumn<PaymentMethodConfig>({
      width: 90,
      actions: (r) => [
        ...(canUpdate ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(r),
        }] : []),
      ],
    }),
  ];

  const renderRefreshButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { void queryClient.invalidateQueries({ queryKey: paymentMethodKeys.lists }); }}>刷新</Button>
  );

  return (
    <div className="page-container">
      <SearchToolbar actions={renderRefreshButton()} mobileActions={renderRefreshButton()} />

      <ConfigurableTable
        bordered columns={columns} dataSource={list} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={false}
      />

      <AppModal title="编辑支付方式" visible={!!editing} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: saveMutation.isPending }} width={480} closeOnEsc>
        {editing && (
          <Form key={editing.id} getFormApi={(api) => { formApi.current = api; }} initValues={{ label: editing.label, icon: editing.icon ?? '', sort: editing.sort }} labelPosition="left" labelWidth={90}>
            <Form.Input field="label" label="展示名称" rules={[{ required: true, message: '名称不能为空' }]} />
            <Form.Input field="icon" label="图标" placeholder="lucide 图标名，可选" />
            <Form.InputNumber field="sort" label="排序" min={0} max={9999} step={1} precision={0} style={{ width: '100%' }} extraText="数值越小越靠前" />
          </Form>
        )}
      </AppModal>
    </div>
  );
}
