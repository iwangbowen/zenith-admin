import { useQueryClient } from '@tanstack/react-query';
import { Form, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { PAYMENT_METHOD_LABELS } from '@zenith/shared/payment';
import type { PaymentChannel, PaymentMethod, PaymentMethodConfig } from '@zenith/shared/payment';
import { paymentMethodKeys, usePaymentMethodList, useSavePaymentMethod, type PaymentMethodSaveValues } from '@/hooks/queries/payment-methods';
import { RefreshButton } from '@/components/toolbar-controls';
import { renderEllipsis } from '@/utils/table-columns';
import { listTableProps, useStatusToggle } from '@/components/list-page';
import { abortSubmit } from '@/lib/abort-submit';
import { PaymentChannelTag } from './payment-display';

interface MethodFormValues { label: string; icon?: string; sort?: number; enabled?: boolean; }

export default function PaymentMethodsPage() {
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('payment:method:update');
  const queryClient = useQueryClient();
  const listQuery = usePaymentMethodList();
  const saveMutation = useSavePaymentMethod();
  const toggleMutation = useSavePaymentMethod();

  const methodSaveMutation = {
    mutateAsync: ({ id, values }: { id?: number; values: PaymentMethodSaveValues }) => {
      if (id == null) {
        Toast.error('缺少记录 ID，请刷新后重试');
        abortSubmit('missing-id');
      }
      return saveMutation.mutateAsync({ params: { id }, body: values });
    },
    isPending: saveMutation.isPending,
  };
  const methodModal = useEditModal<PaymentMethodConfig, MethodFormValues, PaymentMethodSaveValues>({
    save: methodSaveMutation,
    toValues: (method) => ({ label: method.label, icon: method.icon ?? '', sort: method.sort }),
    beforeSave: (values) => ({ label: values.label, icon: values.icon || undefined, sort: values.sort ?? 0 }),
  });

  const status = useStatusToggle<PaymentMethodConfig>({
    toggle: (record, checked) => toggleMutation.mutateAsync({ params: { id: record.id }, body: { enabled: checked } }),
    disabled: !canUpdate,
    isEnabled: (record) => record.enabled,
  });

  const columns: ColumnProps<PaymentMethodConfig>[] = [
    { title: '排序', dataIndex: 'sort', width: 70 },
    { title: '支付方式', dataIndex: 'method', width: 150, render: (v: PaymentMethod) => PAYMENT_METHOD_LABELS[v] },
    { title: '展示名称', dataIndex: 'label', minWidth: 160, render: renderEllipsis },
    { title: '渠道', dataIndex: 'channel', width: 110, render: (v: PaymentChannel) => <PaymentChannelTag channel={v} /> },
    { title: '图标', dataIndex: 'icon', width: 140, render: renderEllipsis },
    status.column({ dataIndex: 'enabled', width: 90 }),
    createOperationColumn<PaymentMethodConfig>({
      width: 100,
      actions: (r) => [
        ...(canUpdate ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => methodModal.openEdit(r),
        }] : []),
      ],
    }),
  ];

  const refreshButton = (
    <RefreshButton onClick={() => { void queryClient.invalidateQueries({ queryKey: paymentMethodKeys.lists }); }} />
  );

  return (
    <div className="page-container">
      <SearchToolbar actions={refreshButton} mobileActions={refreshButton} />

      <ConfigurableTable<PaymentMethodConfig>
        columns={columns}
        empty="暂无数据"
        {...listTableProps(listQuery)}
      />

      <AppModal {...methodModal.modalProps} title="编辑支付方式" width={480}>
        <Form key={methodModal.formKey} {...methodModal.formProps}>
          <Form.Input field="label" label="展示名称" rules={[{ required: true, message: '名称不能为空' }]} />
          <Form.Input field="icon" label="图标" placeholder="lucide 图标名，可选" />
          <Form.InputNumber field="sort" label="排序" min={0} max={9999} step={1} precision={0} style={{ width: '100%' }} extraText="数值越小越靠前" />
        </Form>
      </AppModal>
    </div>
  );
}
