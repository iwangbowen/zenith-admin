import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Form,
  Input,
  Popconfirm,
  Space,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, RefreshCw, RotateCcw, Search, Shield, ShieldOff } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';

interface FirewallStatus {
  enabled: boolean;
  type: 'ufw' | 'firewalld' | 'iptables' | 'unknown';
  version: string | null;
  defaultIncoming: string | null;
  defaultOutgoing: string | null;
}

interface FirewallRule {
  id: string;
  type: 'allow' | 'deny' | 'reject';
  protocol: 'tcp' | 'udp' | 'any';
  port: string;
  from: string;
  to: string;
  direction: 'in' | 'out' | 'any';
  comment: string | null;
  raw?: string;
}

interface FirewallRuleList {
  type: FirewallStatus['type'];
  rules: FirewallRule[];
}

interface AddFirewallRuleFormValues {
  type: FirewallRule['type'];
  protocol: FirewallRule['protocol'];
  port: string;
  from: string;
  to: string;
  direction: FirewallRule['direction'];
  comment?: string;
}

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

  const [status, setStatus] = useState<FirewallStatus | null>(null);
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await request.get<FirewallStatus>('/api/firewall', { silent: true });
      if (res.code === 0 && res.data) {
        setStatus(res.data);
      }
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const fetchRules = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await request.get<FirewallRuleList>('/api/firewall/rules', { silent: true });
      if (res.code === 0 && res.data) {
        setRules(res.data.rules ?? []);
        setStatus((prev) => (prev ? { ...prev, type: res.data.type } : prev));
      }
    } finally {
      setListLoading(false);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchStatus(), fetchRules()]);
  }, [fetchRules, fetchStatus]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

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

    setSubmitting(true);
    try {
      const res = await request.post('/api/firewall/rules', {
        ...values,
        from: values.from?.trim() || 'any',
        to: values.to?.trim() || 'any',
        comment: values.comment?.trim() || undefined,
      });
      if (res.code === 0) {
        Toast.success('规则已添加');
        closeModal();
        await fetchAll();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await request.delete(`/api/firewall/rules/${encodeURIComponent(id)}`);
      if (res.code === 0) {
        Toast.success('规则已删除');
        await fetchAll();
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggle(enabled: boolean) {
    setSwitching(true);
    try {
      const res = await request.post(enabled ? '/api/firewall/enable' : '/api/firewall/disable');
      if (res.code === 0) {
        Toast.success(enabled ? '防火墙已启用' : '防火墙已关闭');
        await fetchAll();
      }
    } finally {
      setSwitching(false);
    }
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
    {
      title: '操作',
      fixed: 'right',
      width: 100,
      render: (_: unknown, record: FirewallRule) => (
        canManage ? (
          <Space>
            <Popconfirm title="确定要删除该规则吗？" onConfirm={() => handleDelete(record.id)}>
              <Button theme="borderless" type="danger" size="small" loading={deletingId === record.id}>删除</Button>
            </Popconfirm>
          </Space>
        ) : <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>
      ),
    },
  ];

  const currentStatus = status ?? {
    enabled: false,
    type: 'unknown' as const,
    version: null,
    defaultIncoming: null,
    defaultOutgoing: null,
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
            <Button icon={<RefreshCw size={14} />} loading={statusLoading || listLoading} onClick={() => void fetchAll()}>刷新</Button>
            {canManage && (
              currentStatus.enabled ? (
                <Button type="danger" icon={<ShieldOff size={14} />} loading={switching} onClick={() => void handleToggle(false)}>禁用</Button>
              ) : (
                <Button type="primary" icon={<Shield size={14} />} loading={switching} onClick={() => void handleToggle(true)}>启用</Button>
              )
            )}
          </Space>
        </div>
      </div>

      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索端口/来源/目标/备注"
          value={keyword}
          onChange={setKeyword}
          showClear
          style={{ width: 240 }}
        />
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setKeyword(''); void fetchAll(); }}>重置</Button>
        <Button icon={<RefreshCw size={14} />} loading={listLoading} onClick={() => void fetchAll()}>刷新</Button>
        {canManage && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增规则</Button>}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        rowKey="id"
        columns={columns}
        dataSource={filteredRules}
        loading={listLoading}
        onRefresh={() => void fetchAll()}
        refreshLoading={listLoading}
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
        okButtonProps={{ loading: submitting }}
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
