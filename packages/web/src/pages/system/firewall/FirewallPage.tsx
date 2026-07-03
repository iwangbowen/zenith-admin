import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Space,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, RefreshCw, RotateCcw, Search, Shield, ShieldOff } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import {
  useAddFirewallRule,
  useDeleteFirewallRule,
  useFirewallRules,
  useFirewallStatus,
  useToggleFirewall,
  type AddFirewallRuleFormValues,
  type FirewallRule,
  type FirewallStatus,
} from '@/hooks/queries/firewall';

const RULE_TYPE_CONFIG: Record<FirewallRule['type'], { label: string; color: 'green' | 'red' | 'orange' }> = {
  allow: { label: '允许', color: 'green' },
  deny: { label: '拒绝', color: 'red' },
  reject: { label: '拒止', color: 'orange' },
};

const DIRECTION_LABELS: Record<FirewallRule['direction'], string> = {
  in: '入站',
  out: '出站',
  any: '任意',
};

const PROTOCOL_LABELS: Record<FirewallRule['protocol'], string> = {
  tcp: 'TCP',
  udp: 'UDP',
  any: 'ANY',
};

const STATUS_TYPE_LABELS: Record<FirewallStatus['type'], string> = {
  ufw: 'UFW',
  firewalld: 'firewalld',
  iptables: 'iptables',
  unknown: '未知',
};
const EMPTY_RULES: FirewallRule[] = [];

function FieldBlock({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div style={{ minWidth: 140 }}>
      <div style={{ marginBottom: 6, color: 'var(--semi-color-text-2)', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 14 }}>{children}</div>
    </div>
  );
}

export default function FirewallPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi<AddFirewallRuleFormValues> | null>(null);
  const canManage = hasPermission('system:firewall:manage');

  const [keyword, setKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const statusQuery = useFirewallStatus();
  const rulesQuery = useFirewallRules();
  const addRuleMutation = useAddFirewallRule();
  const deleteRuleMutation = useDeleteFirewallRule();
  const toggleFirewallMutation = useToggleFirewall();
  const status = statusQuery.data ?? null;
  const rules = rulesQuery.data?.rules ?? EMPTY_RULES;
  const fetchAll = async () => {
    await Promise.all([statusQuery.refetch(), rulesQuery.refetch()]);
  };

  const filteredRules = useMemo(() => {
    const lowerKeyword = keyword.trim().toLowerCase();
    if (!lowerKeyword) return rules;
    return rules.filter((rule) => (
      rule.port.toLowerCase().includes(lowerKeyword)
      || rule.from.toLowerCase().includes(lowerKeyword)
      || rule.to.toLowerCase().includes(lowerKeyword)
      || rule.type.toLowerCase().includes(lowerKeyword)
      || rule.protocol.toLowerCase().includes(lowerKeyword)
      || rule.direction.toLowerCase().includes(lowerKeyword)
      || (rule.comment ?? '').toLowerCase().includes(lowerKeyword)
    ));
  }, [keyword, rules]);

  function openCreate() {
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    formApi.current?.reset();
  }

  async function handleSubmit() {
    let values: AddFirewallRuleFormValues;
    try {
      values = await formApi.current?.validate() as AddFirewallRuleFormValues;
    } catch {
      throw new Error('validation');
    }

    await addRuleMutation.mutateAsync(values);
    Toast.success('规则已添加');
    closeModal();
  }

  async function handleDelete(id: string) {
    await deleteRuleMutation.mutateAsync(id);
    Toast.success('规则已删除');
  }

  async function handleToggle(enabled: boolean) {
    await toggleFirewallMutation.mutateAsync(enabled);
    Toast.success(enabled ? '防火墙已启用' : '防火墙已关闭');
  }

  const columns: ColumnProps<FirewallRule>[] = [
    {
      title: '规则类型',
      dataIndex: 'type',
      width: 100,
      render: (value: FirewallRule['type']) => <Tag color={RULE_TYPE_CONFIG[value].color} size="small">{RULE_TYPE_CONFIG[value].label}</Tag>,
    },
    {
      title: '协议',
      dataIndex: 'protocol',
      width: 90,
      render: (value: FirewallRule['protocol']) => <Tag color="blue" size="small" type="light">{PROTOCOL_LABELS[value]}</Tag>,
    },
    {
      title: '端口',
      dataIndex: 'port',
      width: 110,
      render: (value: string) => <span style={{ fontFamily: 'monospace' }}>{value}</span>,
    },
    { title: '来源', dataIndex: 'from', width: 180 },
    { title: '目标', dataIndex: 'to', width: 180 },
    {
      title: '方向',
      dataIndex: 'direction',
      width: 90,
      render: (value: FirewallRule['direction']) => <Tag size="small" type="ghost">{DIRECTION_LABELS[value]}</Tag>,
    },
    {
      title: '备注',
      dataIndex: 'comment',
      render: (value: string | null) => value ?? <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>,
    },
    createOperationColumn<FirewallRule>({
      width: 100,
      emptyContent: <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>,
      actions: (record) => [
        {
          key: 'delete',
          label: '删除',
          danger: true,
          loading: deleteRuleMutation.isPending && deleteRuleMutation.variables === record.id,
          hidden: !canManage,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该规则吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const currentStatus = {
    ...(status ?? {
      enabled: false,
      type: 'unknown' as const,
      version: null,
      defaultIncoming: null,
      defaultOutgoing: null,
    }),
    type: rulesQuery.data?.type ?? status?.type ?? 'unknown' as const,
  };

  return (
    <div className="page-container">
      <div
        style={{
          marginBottom: 16,
          padding: 16,
          border: '1px solid var(--semi-color-border)',
          borderRadius: 8,
          background: 'var(--semi-color-bg-1)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <Space wrap align="start" spacing={24}>
            <FieldBlock label="防火墙类型">
              <Tag color="cyan" size="large" type="light">{STATUS_TYPE_LABELS[currentStatus.type]}</Tag>
            </FieldBlock>
            <FieldBlock label="运行状态">
              <Tag color={currentStatus.enabled ? 'green' : 'grey'} size="large">{currentStatus.enabled ? '已启用' : '已关闭'}</Tag>
            </FieldBlock>
            <FieldBlock label="版本">{currentStatus.version ?? '—'}</FieldBlock>
            <FieldBlock label="默认入站">{currentStatus.defaultIncoming ?? '—'}</FieldBlock>
            <FieldBlock label="默认出站">{currentStatus.defaultOutgoing ?? '—'}</FieldBlock>
          </Space>
          <Space>
            <Button icon={<RefreshCw size={14} />} loading={statusQuery.isFetching || rulesQuery.isFetching} onClick={() => void fetchAll()}>刷新</Button>
            {canManage && (
              currentStatus.enabled ? (
                <Button type="danger" icon={<ShieldOff size={14} />} loading={toggleFirewallMutation.isPending} onClick={() => void handleToggle(false)}>禁用</Button>
              ) : (
                <Button type="primary" icon={<Shield size={14} />} loading={toggleFirewallMutation.isPending} onClick={() => void handleToggle(true)}>启用</Button>
              )
            )}
          </Space>
        </div>
      </div>

      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索端口/来源/目标/备注"
              value={keyword}
              onChange={setKeyword}
              showClear
              style={{ width: 240 }}
            />
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setKeyword(''); void fetchAll(); }}>重置</Button>
            <Button icon={<RefreshCw size={14} />} loading={rulesQuery.isFetching} onClick={() => void fetchAll()}>刷新</Button>
            {canManage && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增规则</Button>}
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索端口/来源/目标/备注"
              value={keyword}
              onChange={setKeyword}
              showClear
              style={{ width: 240 }}
            />
            {canManage && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增规则</Button>}
          </>
        )}
        mobileActions={(
          <>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setKeyword(''); void fetchAll(); }}>重置</Button>
            <Button icon={<RefreshCw size={14} />} loading={rulesQuery.isFetching} onClick={() => void fetchAll()}>刷新</Button>
          </>
        )}
        actionTitle="防火墙操作"
      />

      <ConfigurableTable
        bordered
        rowKey="id"
        columns={columns}
        dataSource={filteredRules}
        loading={rulesQuery.isFetching}
        onRefresh={() => void fetchAll()}
        refreshLoading={rulesQuery.isFetching}
        empty="暂无防火墙规则"
        pagination={{ pageSize: 20, showSizeChanger: true }}
      />

      <AppModal
        title="新增防火墙规则"
        visible={modalVisible}
        onCancel={closeModal}
        onOk={handleSubmit}
        okText="保存"
        width={620}
        okButtonProps={{ loading: addRuleMutation.isPending }}
        closeOnEsc
      >
        <Form<AddFirewallRuleFormValues>
          getFormApi={(api) => { formApi.current = api; }}
          initValues={{
            type: 'allow',
            protocol: 'tcp',
            port: '',
            from: 'any',
            to: 'any',
            direction: 'in',
            comment: '',
          }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Select
            field="type"
            label="规则类型"
            style={{ width: '100%' }}
            optionList={[
              { label: '允许', value: 'allow' },
              { label: '拒绝', value: 'deny' },
              { label: '拒止', value: 'reject' },
            ]}
            rules={[{ required: true, message: '请选择规则类型' }]}
          />
          <Form.Select
            field="protocol"
            label="协议"
            style={{ width: '100%' }}
            optionList={[
              { label: 'TCP', value: 'tcp' },
              { label: 'UDP', value: 'udp' },
              { label: 'ANY', value: 'any' },
            ]}
            rules={[{ required: true, message: '请选择协议' }]}
          />
          <Form.Input field="port" label="端口" placeholder="如 22、80、443、1000:2000 或 any" rules={[{ required: true, message: '请输入端口' }]} />
          <Form.Input field="from" label="来源 IP" placeholder="默认 any" />
          <Form.Input field="to" label="目标" placeholder="默认 any" />
          <Form.Select
            field="direction"
            label="方向"
            style={{ width: '100%' }}
            optionList={[
              { label: '入站', value: 'in' },
              { label: '出站', value: 'out' },
              { label: '任意', value: 'any' },
            ]}
            rules={[{ required: true, message: '请选择方向' }]}
          />
          <Form.Input field="comment" label="备注" placeholder="可选备注" maxLength={200} />
        </Form>
      </AppModal>
    </div>
  );
}
