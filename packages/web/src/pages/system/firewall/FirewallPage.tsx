import { useMemo, useState } from 'react';
import { Banner, Button, Form, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RefreshCw, Shield, ShieldOff } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import {
  useAddFirewallRule,
  useDeleteFirewallRule,
  useFirewallRules,
  useFirewallStatus,
  useToggleFirewall,
} from '@/hooks/queries/firewall';
import type { AddFirewallRuleInput, FirewallRule, FirewallStatus } from '@zenith/shared/ops';
import { CreateButton, ResetButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { HostSelector } from '@/components/HostSelector';
import { useOpsHostSelection } from '@/hooks/useOpsHostSelection';
import { StatCard, StatGrid } from '@/components/charts/StatCard';

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

interface FirewallRuleModalRecord {
  id: number;
}

export default function FirewallPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:firewall:manage');
  const [hostId, setHostId] = useOpsHostSelection();
  const canManageCurrent = canManage && hostId == null;

  const [keyword, setKeyword] = useState('');
  const statusQuery = useFirewallStatus(hostId);
  const rulesQuery = useFirewallRules(hostId);
  const addRuleMutation = useAddFirewallRule();
  const deleteRuleMutation = useDeleteFirewallRule();
  const toggleFirewallMutation = useToggleFirewall();
  const status = statusQuery.data ?? null;
  const rules = rulesQuery.data?.rules ?? EMPTY_RULES;
  const fetchAll = async () => {
    await Promise.all([statusQuery.refetch(), rulesQuery.refetch()]);
  };
  const ruleModal = useEditModal<FirewallRuleModalRecord, AddFirewallRuleInput>({
    entityName: '防火墙规则',
    save: {
      mutateAsync: async ({ values }) => {
        await addRuleMutation.mutateAsync({
          query: {},
          body: {
            ...values,
            from: values.from?.trim() || 'any',
            to: values.to?.trim() || 'any',
            comment: values.comment?.trim() || undefined,
          },
        });
        return { id: 0 };
      },
      isPending: addRuleMutation.isPending,
    },
    defaults: {
      type: 'allow',
      protocol: 'tcp',
      port: '',
      from: 'any',
      to: 'any',
      direction: 'in',
      comment: '',
    },
    successMessage: () => '规则已添加',
  });

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

  async function handleDelete(id: string) {
    await deleteRuleMutation.mutateAsync({ params: { id }, query: {} });
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
          loading: deleteRuleMutation.isPending && deleteRuleMutation.variables?.params.id === record.id,
          hidden: !canManageCurrent,
          onClick: () => {
            confirmDelete({
              title: '确定要删除该规则吗？',
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
      {hostId != null && (
        <Banner
          type="info"
          fullMode={false}
          closeIcon={null}
          description="远端防火墙仅提供只读状态与规则查看，禁止远程变更以避免误封 SSH 恢复通道。"
          style={{ marginBottom: 12 }}
        />
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <HostSelector value={hostId} onChange={setHostId} />
        <Button icon={<RefreshCw size={14} />} loading={statusQuery.isFetching || rulesQuery.isFetching} onClick={() => void fetchAll()}>刷新</Button>
        {canManageCurrent && (
          currentStatus.enabled ? (
            <Button type="danger" icon={<ShieldOff size={14} />} loading={toggleFirewallMutation.isPending} onClick={() => void handleToggle(false)}>禁用</Button>
          ) : (
            <Button type="primary" icon={<Shield size={14} />} loading={toggleFirewallMutation.isPending} onClick={() => void handleToggle(true)}>启用</Button>
          )
        )}
      </div>
      <div style={{ marginBottom: 16 }}>
        <StatGrid minItemWidth={170}>
          <StatCard title="防火墙类型" value={STATUS_TYPE_LABELS[currentStatus.type]} />
          <StatCard
            title="运行状态"
            value={currentStatus.enabled ? '已启用' : '已关闭'}
            accent={currentStatus.enabled ? 'var(--semi-color-success)' : 'var(--semi-color-text-2)'}
          />
          <StatCard title="版本" value={currentStatus.version ?? '—'} />
          <StatCard title="默认入站" value={currentStatus.defaultIncoming ?? '—'} />
          <StatCard title="默认出站" value={currentStatus.defaultOutgoing ?? '—'} />
        </StatGrid>
      </div>

      <SearchToolbar
        primary={(
          <>
            <KeywordInput placeholder="搜索端口/来源/目标/备注" value={keyword} onChange={setKeyword} width={240} />
            <ResetButton onClick={() => { setKeyword(''); void fetchAll(); }} />
            <Button icon={<RefreshCw size={14} />} loading={rulesQuery.isFetching} onClick={() => void fetchAll()}>刷新</Button>
            {canManageCurrent && <CreateButton onClick={ruleModal.openCreate}>新增规则</CreateButton>}
          </>
        )}
        mobilePrimary={(
          <>
            <KeywordInput placeholder="搜索端口/来源/目标/备注" value={keyword} onChange={setKeyword} width={240} />
            {canManageCurrent && <CreateButton onClick={ruleModal.openCreate}>新增规则</CreateButton>}
          </>
        )}
        mobileActions={(
          <>
            <ResetButton onClick={() => { setKeyword(''); void fetchAll(); }} />
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
        {...ruleModal.modalProps}
        okText="保存"
        width={620}
      >
        <Form key={ruleModal.formKey} {...ruleModal.formProps}>
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
