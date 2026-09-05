import { useState } from 'react';
import {
  Button, Col, Descriptions, Dropdown, Form, Row, SideSheet, Space, Spin, Tag, Toast, Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { KeyRound, Radar, RotateCcw } from 'lucide-react';
import type { CreateOpsHostInput, OpsHost, OpsHostAuthType } from '@zenith/shared/ops';
import AppModal from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import PageLoading from '@/components/PageLoading';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { CreateButton, RefreshButton } from '@/components/toolbar-controls';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';
import { confirmDanger, confirmDelete } from '@/utils/confirm';
import { copyableNoColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import {
  useDeleteOpsHosts,
  useImportOpsHost,
  useOpsHost,
  useOpsHosts,
  useProbeAllOpsHosts,
  useProbeOpsHost,
  useResetOpsHostKey,
  useSaveOpsHost,
  useTestOpsHost,
} from '@/hooks/queries/ops-hosts';
import { useSshProfiles } from '@/hooks/queries/terminal';
import { formatBytes } from '@zenith/shared/core';

const { Text } = Typography;

type HostFormValues = {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: OpsHostAuthType;
  password?: string;
  keyContent?: string;
  keyPassphrase?: string;
  enabled: boolean;
  remark?: string;
};

const STATUS_META = {
  unknown: { label: '未探测', color: 'grey' },
  online: { label: '在线', color: 'green' },
  offline: { label: '离线', color: 'red' },
} as const;

function snapshotSummary(host: OpsHost): string {
  const s = host.snapshot;
  if (!s) return '—';
  return [
    s.cpuCores != null ? `${s.cpuCores} 核` : null,
    s.memUsagePercent != null ? `内存 ${s.memUsagePercent}%` : null,
    s.diskUsagePercent != null ? `磁盘 ${s.diskUsagePercent}%` : null,
  ].filter(Boolean).join(' · ') || '—';
}

export default function HostsPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:host:manage');
  const canReadSshProfiles = hasPermission('system:terminal:execute');
  const hostsQuery = useOpsHosts();
  const hosts = hostsQuery.data ?? [];
  const saveMutation = useSaveOpsHost();
  const deleteMutation = useDeleteOpsHosts();
  const testMutation = useTestOpsHost();
  const probeMutation = useProbeOpsHost();
  const probeAllMutation = useProbeAllOpsHosts();
  const resetKeyMutation = useResetOpsHostKey();
  const importMutation = useImportOpsHost();
  const sshProfilesQuery = useSshProfiles(canManage && canReadSshProfiles);
  const [detailId, setDetailId] = useState<number>();
  const [formAuthType, setFormAuthType] = useState<OpsHostAuthType>('password');
  const detailQuery = useOpsHost(detailId, detailId != null);
  const detail = detailQuery.data ?? hosts.find((item) => item.id === detailId);

  const modal = useEditModal<OpsHost, HostFormValues, CreateOpsHostInput>({
    entityName: '主机',
    save: saveMutation,
    useDetail: useOpsHost,
    defaults: {
      port: 22,
      authType: 'password',
      enabled: true,
    },
    toValues: (host) => ({
      name: host.name,
      host: host.host,
      port: host.port,
      username: host.username,
      authType: host.authType,
      password: '',
      keyContent: '',
      keyPassphrase: '',
      enabled: host.enabled,
      remark: host.remark ?? '',
    }),
    beforeSave: (values, { isEdit, editing }) => {
      const secretPresent = values.authType === 'password' ? values.password : values.keyContent;
      const alreadyConfigured = values.authType === 'password'
        ? editing?.hasPassword
        : editing?.hasKeyContent;
      if (!secretPresent && (!isEdit || !alreadyConfigured || editing?.authType !== values.authType)) {
        Toast.warning(values.authType === 'password' ? '请填写 SSH 密码' : '请粘贴 SSH 私钥内容');
        abortSubmit();
      }
      return {
        ...values,
        password: values.password || undefined,
        keyContent: values.keyContent || undefined,
        keyPassphrase: values.keyPassphrase || undefined,
        remark: values.remark?.trim() ?? '',
      };
    },
    labelWidth: 110,
  });

  const handleTest = async (id: number) => {
    const result = await testMutation.mutateAsync({ params: { id } });
    if (result.ok) Toast.success(`连接成功${result.latencyMs != null ? `（${result.latencyMs}ms）` : ''}`);
    else Toast.error(result.message);
  };

  const handleProbe = async (id: number) => {
    const result = await probeMutation.mutateAsync({ params: { id } });
    if (result.status === 'online') Toast.success('探测完成，主机在线');
    else Toast.error(result.probeError ?? '主机离线');
  };

  const columns: ColumnProps<OpsHost>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 160, render: renderEllipsis },
    copyableNoColumn('连接地址', 'host', {
      width: 230,
      displayText: (_v, record) => `${record.username}@${record.host}:${record.port}`,
      copyContent: (_v, record) => `${record.username}@${record.host}:${record.port}`,
    }),
    {
      title: '认证',
      dataIndex: 'authType',
      width: 100,
      render: (value: OpsHostAuthType) => <Tag size="small">{value === 'password' ? '密码' : '私钥'}</Tag>,
    },
    { title: '资源快照', width: 230, render: (_value: unknown, record) => snapshotSummary(record) },
    dateTimeColumn('最近探测', 'probedAt', { empty: '从未探测' }) as ColumnProps<OpsHost>,
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      fixed: 'right',
      render: (value: OpsHost['status']) => (
        <Tag color={STATUS_META[value].color} size="small">{STATUS_META[value].label}</Tag>
      ),
    },
    createOperationColumn<OpsHost>({
      width: 180,
      desktopInlineKeys: ['detail', 'probe'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => setDetailId(record.id) },
        {
          key: 'probe',
          label: '探测',
          loading: probeMutation.isPending && probeMutation.variables?.params.id === record.id,
          onClick: () => { void handleProbe(record.id); },
        },
        {
          key: 'test',
          label: '测试连接',
          hidden: !canManage,
          loading: testMutation.isPending && testMutation.variables?.params.id === record.id,
          onClick: () => { void handleTest(record.id); },
        },
        {
          key: 'edit',
          label: '编辑',
          hidden: !canManage,
          onClick: () => {
            setFormAuthType(record.authType);
            modal.openEdit(record);
          },
        },
        {
          key: 'resetKey',
          label: '重置指纹',
          hidden: !canManage || !record.hostKeyFingerprint,
          onClick: () => {
            confirmDanger({
              title: '重置 SSH host key 指纹？',
              content: '仅在确认主机已安全重装或密钥已合法变更时执行。下次连接将重新信任收到的指纹。',
              okText: '确认重置',
              onOk: async () => {
                await resetKeyMutation.mutateAsync({ params: { id: record.id } });
                Toast.success('指纹已重置');
              },
            });
          },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canManage,
          onClick: () => {
            confirmDelete({
              content: `确认删除主机「${record.name}」？`,
              onOk: async () => {
                await deleteMutation.mutateAsync([record.id]);
                Toast.success('主机已删除');
              },
            });
          },
        },
      ],
    }),
  ];

  if (hostsQuery.isPending) return <PageLoading inline />;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <RefreshButton onClick={() => void hostsQuery.refetch()} loading={hostsQuery.isFetching} />
            <Button
              icon={<Radar size={14} />}
              loading={probeAllMutation.isPending}
              onClick={async () => {
                const list = await probeAllMutation.mutateAsync({});
                const online = list.filter((host) => host.status === 'online').length;
                Toast.success(`探测完成：在线 ${online} / ${list.length}`);
              }}
            >
              探测全部
            </Button>
            {canManage && (
              <>
                {canReadSshProfiles && <Dropdown
                  trigger="click"
                  render={(
                    <Dropdown.Menu>
                      {(sshProfilesQuery.data ?? []).length === 0 ? (
                        <Dropdown.Item disabled>暂无 SSH 配置</Dropdown.Item>
                      ) : (sshProfilesQuery.data ?? []).map((profile) => (
                        <Dropdown.Item
                          key={profile.id}
                          onClick={async () => {
                            await importMutation.mutateAsync({ params: { profileId: profile.id } });
                            Toast.success('SSH 配置已导入');
                          }}
                        >
                          {profile.name} ({profile.username}@{profile.host})
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                  )}
                >
                  <Button loading={importMutation.isPending}>从 SSH 配置导入</Button>
                </Dropdown>}
                <CreateButton onClick={() => {
                  setFormAuthType('password');
                  modal.openCreate();
                }}>
                  新增主机
                </CreateButton>
              </>
            )}
          </>
        )}
      />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={hosts}
        rowKey="id"
        pagination={false}
        onRefresh={() => void hostsQuery.refetch()}
        refreshLoading={hostsQuery.isFetching}
      />

      <AppModal {...modal.modalProps} width={760}>
        <Spin spinning={modal.detailLoading}>
          <Form {...modal.formProps}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="name" label="名称" rules={[{ required: true }]} />
              </Col>
              <Col span={12}>
                <Form.Input field="host" label="主机地址" placeholder="IP 或域名" rules={[{ required: true }]} />
              </Col>
              <Col span={12}>
                <Form.InputNumber
                  field="port"
                  label="SSH 端口"
                  min={1}
                  max={65535}
                  style={{ width: '100%' }}
                  rules={[{ required: true }]}
                />
              </Col>
              <Col span={12}>
                <Form.Input field="username" label="SSH 用户名" rules={[{ required: true }]} />
              </Col>
              <Col span={12}>
                <Form.Select
                  field="authType"
                  label="认证方式"
                  style={{ width: '100%' }}
                  optionList={[
                    { label: '密码', value: 'password' },
                    { label: '私钥内容', value: 'key_content' },
                  ]}
                  onChange={(value) => setFormAuthType(value as OpsHostAuthType)}
                  rules={[{ required: true }]}
                />
              </Col>
              <Col span={12}>
                <Form.Switch field="enabled" label="启用状态" />
              </Col>
            </Row>
            {formAuthType === 'key_content' ? (
              <>
                <Form.TextArea
                  field="keyContent"
                  label="SSH 私钥"
                  rows={8}
                  placeholder={modal.isEdit ? '留空表示不修改' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
                />
                <Form.Input mode="password" field="keyPassphrase" label="私钥口令" placeholder="可选，留空表示不修改" />
              </>
            ) : (
              <Form.Input mode="password" field="password" label="SSH 密码" placeholder={modal.isEdit ? '留空表示不修改' : ''} />
            )}
            <Form.TextArea field="remark" label="备注" rows={2} />
          </Form>
        </Spin>
      </AppModal>

      <SideSheet
        title={detail ? `主机详情：${detail.name}` : '主机详情'}
        visible={detailId != null}
        onCancel={() => setDetailId(undefined)}
        width={620}
      >
        <Spin spinning={detailQuery.isFetching}>
          {detail && (
            <>
              <Descriptions
                align="plain"
                column={1}
                data={[
                  { key: '连接地址', value: `${detail.username}@${detail.host}:${detail.port}` },
                  { key: '认证方式', value: detail.authType === 'password' ? '密码' : '私钥内容' },
                  {
                    key: 'Host Key 指纹',
                    value: detail.hostKeyFingerprint
                      ? <Text copyable>{detail.hostKeyFingerprint}</Text>
                      : '尚未建立信任',
                  },
                  { key: '探测状态', value: STATUS_META[detail.status].label },
                  { key: '最近探测', value: detail.probedAt ?? '从未探测' },
                  { key: '错误', value: detail.probeError ?? '—' },
                  { key: '备注', value: detail.remark ?? '—' },
                ]}
              />
              {detail.snapshot && (
                <>
                  <Typography.Title heading={6} style={{ marginTop: 24 }}>资源快照</Typography.Title>
                  <Descriptions
                    align="plain"
                    column={1}
                    data={[
                      { key: '操作系统', value: detail.snapshot.osName ?? '—' },
                      { key: '内核', value: detail.snapshot.kernel ?? '—' },
                      { key: 'CPU / 负载', value: `${detail.snapshot.cpuCores ?? '—'} 核 / ${detail.snapshot.load1 ?? '—'}` },
                      {
                        key: '内存',
                        value: detail.snapshot.memTotalBytes
                          ? `${formatBytes(detail.snapshot.memUsedBytes ?? 0)} / ${formatBytes(detail.snapshot.memTotalBytes)} (${detail.snapshot.memUsagePercent ?? '—'}%)`
                          : '—',
                      },
                      {
                        key: '根磁盘',
                        value: detail.snapshot.diskTotalBytes
                          ? `${formatBytes(detail.snapshot.diskUsedBytes ?? 0)} / ${formatBytes(detail.snapshot.diskTotalBytes)} (${detail.snapshot.diskUsagePercent ?? '—'}%)`
                          : '—',
                      },
                    ]}
                  />
                </>
              )}
              {canManage && detail.hostKeyFingerprint && (
                <Button
                  type="danger"
                  theme="borderless"
                  icon={<RotateCcw size={14} />}
                  style={{ marginTop: 20 }}
                  onClick={() => {
                    confirmDanger({
                      title: '重置 SSH host key 指纹？',
                      content: '下次连接将重新信任收到的主机指纹。',
                      onOk: async () => {
                        await resetKeyMutation.mutateAsync({ params: { id: detail.id } });
                        Toast.success('指纹已重置');
                      },
                    });
                  }}
                >
                  重置 Host Key 指纹
                </Button>
              )}
              <Space style={{ marginTop: 20 }}>
                <KeyRound size={14} />
                <Text type="tertiary" size="small">凭据经服务端 AES-256-GCM 加密存储，接口永不回传明文。</Text>
              </Space>
            </>
          )}
        </Spin>
      </SideSheet>
    </div>
  );
}
