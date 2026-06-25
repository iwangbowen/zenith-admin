import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Form, Space, Switch, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { RotateCcw } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentMethod, PaymentMethodConfig } from '@zenith/shared';

interface MethodFormValues { label: string; icon?: string; sort?: number; enabled?: boolean; }

export default function PaymentMethodsPage() {
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('payment:method:update');
  const formApi = useRef<FormApi | null>(null);
  const [list, setList] = useState<PaymentMethodConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<PaymentMethodConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<PaymentMethodConfig[]>('/api/payment/methods');
      if (res.code === 0) setList(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchList(); }, [fetchList]);

  function openEdit(record: PaymentMethodConfig) { setEditing(record); }
  function closeModal() { setEditing(null); }

  function handleToggle(record: PaymentMethodConfig, checked: boolean) {
    setTogglingIds((prev) => new Set(prev).add(record.id));
    request
      .put<PaymentMethodConfig>(`/api/payment/methods/${record.id}`, { enabled: checked })
      .then((res) => { if (res.code === 0) { Toast.success(checked ? '已启用' : '已停用'); void fetchList(); } })
      .finally(() => setTogglingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; }));
  }

  async function handleOk() {
    let values: MethodFormValues;
    try { values = (await formApi.current?.validate()) as MethodFormValues; } catch { throw new Error('validation'); }
    if (!editing) return;
    setSubmitting(true);
    try {
      const res = await request.put<PaymentMethodConfig>(`/api/payment/methods/${editing.id}`, {
        label: values.label,
        icon: values.icon || undefined,
        sort: values.sort ?? 0,
      });
      if (res.code === 0) { Toast.success('更新成功'); closeModal(); void fetchList(); }
      else throw new Error(res.message);
    } finally {
      setSubmitting(false);
    }
  }

  const columns: ColumnProps<PaymentMethodConfig>[] = [
    { title: '排序', dataIndex: 'sort', width: 70 },
    { title: '支付方式', dataIndex: 'method', width: 150, render: (v: PaymentMethod) => PAYMENT_METHOD_LABELS[v] },
    { title: '展示名称', dataIndex: 'label', width: 160 },
    { title: '渠道', dataIndex: 'channel', width: 110, render: (v: PaymentChannel) => <Tag color={v === 'wechat' ? 'green' : 'blue'}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '图标', dataIndex: 'icon', width: 140, render: (v: string | null) => v || '-' },
    {
      title: '状态', dataIndex: 'enabled', width: 90, fixed: 'right',
      render: (_: unknown, r: PaymentMethodConfig) => (
        <Switch checked={r.enabled} loading={togglingIds.has(r.id)} disabled={!canUpdate} size="small" onChange={(c) => handleToggle(r, c)} />
      ),
    },
    {
      title: '操作', fixed: 'right', width: 90,
      render: (_: unknown, r: PaymentMethodConfig) => (
        <Space>
          {canUpdate && <Button theme="borderless" size="small" onClick={() => openEdit(r)}>编辑</Button>}
        </Space>
      ),
    },
  ];

  const renderRefreshButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => void fetchList()}>刷新</Button>
  );

  return (
    <div className="page-container">
      <SearchToolbar actions={renderRefreshButton()} mobileActions={renderRefreshButton()} />

      <ConfigurableTable
        bordered columns={columns} dataSource={list} loading={loading} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={false}
      />

      <AppModal title="编辑支付方式" visible={!!editing} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: submitting }} width={480} closeOnEsc>
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
