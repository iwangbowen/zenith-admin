import { Banner, Button, Descriptions, Empty, Popconfirm, Space, Table, Tabs, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import PageLoading from '@/components/PageLoading';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useState } from 'react';
import { Copy, KeyRound, ShieldCheck, Upload } from 'lucide-react';
import { LICENSE_FEATURE_OPTIONS, LICENSE_STATUS_LABELS, type LicenseEventItem, type LicenseStatus } from '@zenith/shared/licensing';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useActivateLicense, useDeactivateLicense, useLicenseEvents, useLicensingStatus } from '@/hooks/queries/licensing';
import { copyTextWithToast } from '@/utils/clipboard';

const { Text, Paragraph } = Typography;

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--semi-color-text-0)',
  marginBottom: 12,
};

const STATUS_COLORS: Record<string, 'green' | 'orange' | 'red' | 'grey' | 'blue'> = {
  active: 'green',
  grace: 'orange',
  expired: 'red',
  revoked: 'red',
  invalid: 'red',
  replaced: 'grey',
  unlicensed: 'grey',
};

function statusLabel(status: string): string {
  if (status === 'unlicensed') return '未激活';
  return LICENSE_STATUS_LABELS[status as LicenseStatus] ?? status;
}

const MODE_DESCRIPTIONS: Record<string, string> = {
  off: '未启用授权检查：全部功能可用（开发 / 演示模式）',
  warn: '观察模式：全部功能可用，未授权功能的调用会被记录到事件日志',
  required: '强制模式：仅已授权功能可用，License 失效将进入受限状态',
};

function OverviewTab() {
  const statusQuery = useLicensingStatus();
  const { hasPermission } = usePermission();
  const deactivateMutation = useDeactivateLicense();
  const data = statusQuery.data;

  if (statusQuery.isLoading) return <PageLoading inline />;
  if (!data) return <Empty title="加载失败" description="无法获取 License 状态" style={{ paddingTop: 48 }} />;

  const { installation, license, effective, usingTestKey } = data;
  const licensedFeatures = new Set(license?.features ?? []);

  const copyInstallationId = () => copyTextWithToast(installation.installationId, { success: '安装 ID 已复制' });

  return (
    <Space vertical align="start" spacing={24} style={{ width: '100%' }}>
      {usingTestKey && installation.mode !== 'off' && (
        <Banner
          fullMode={false}
          type="warning"
          closeIcon={null}
          title="正在使用内置测试签发密钥"
          description="当前未配置 LICENSE_ISSUER_PUBLIC_KEY，验签使用公开的测试密钥对，任何人都可签发有效 License。生产部署请用 license-issue.ts --gen-keys 生成自有密钥对。"
          style={{ width: '100%' }}
        />
      )}
      {effective.restricted && (
        <Banner
          fullMode={false}
          type="danger"
          closeIcon={null}
          title="部署处于受限模式"
          description={`License ${statusLabel(effective.status)}${license?.invalidReason ? `（${license.invalidReason}）` : ''}，全部增值功能已停用，核心功能不受影响。请激活有效 License 恢复。`}
          style={{ width: '100%' }}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px 48px', width: '100%' }}>
        <section>
          <div style={sectionTitleStyle}>
            当前授权
            <Tag color={STATUS_COLORS[effective.status] ?? 'grey'} style={{ marginLeft: 8 }}>{statusLabel(effective.status)}</Tag>
          </div>
          {license ? (
            <>
              <Descriptions
                align="left"
                data={[
                  { key: 'License ID', value: <Text copyable>{license.licenseId}</Text> },
                  { key: '客户', value: `${license.customerName}（${license.editionLabel}）` },
                  { key: '有效期', value: `${license.notBefore} ~ ${license.expiresAt}` },
                  { key: '宽限截止', value: license.graceUntil },
                  { key: '席位上限', value: license.limits.maxUsers ?? '不限' },
                  { key: '租户上限', value: license.limits.maxTenants ?? '不限' },
                  { key: '签发密钥', value: license.keyId },
                  { key: '激活时间', value: license.activatedAt },
                  { key: '最近校验', value: license.lastVerifiedAt ?? '—' },
                  ...(license.invalidReason ? [{ key: '异常原因', value: <Text type="danger">{license.invalidReason}</Text> }] : []),
                ]}
              />
              {hasPermission('system:license:manage') && (
                <div style={{ marginTop: 12 }}>
                  <Popconfirm
                    title="确认停用当前 License？"
                    content="required 模式下停用后全部增值功能将不可用。"
                    onConfirm={() => {
                      deactivateMutation.mutate({}, { onSuccess: () => Toast.success('已停用') });
                    }}
                  >
                    <Button type="danger" theme="light" loading={deactivateMutation.isPending}>停用 License</Button>
                  </Popconfirm>
                </div>
              )}
            </>
          ) : (
            <Empty
              image={<KeyRound size={40} style={{ color: 'var(--semi-color-text-3)' }} />}
              title="未激活 License"
              description={installation.mode === 'off' ? '当前为 off 模式，无需 License 即可使用全部功能。' : '请在「激活」页签粘贴 .zenlic 文件内容完成激活。'}
              style={{ padding: '24px 0' }}
            />
          )}
        </section>

        <section>
          <div style={sectionTitleStyle}>部署信息</div>
          <Descriptions
            align="left"
            data={[
              {
                key: '安装 ID',
                value: (
                  <Space spacing={4}>
                    <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 220 }}>{installation.installationId}</Text>
                    <Button size="small" theme="borderless" icon={<Copy size={14} />} onClick={() => void copyInstallationId()} />
                  </Space>
                ),
              },
              { key: '运行模式', value: <Tag color={installation.mode === 'required' ? 'red' : installation.mode === 'warn' ? 'orange' : 'grey'}>{installation.mode}</Tag> },
              { key: '模式说明', value: MODE_DESCRIPTIONS[installation.mode] ?? installation.mode },
              { key: '活跃节点', value: installation.activeNodes },
              { key: '授权版本号', value: installation.licenseEpoch },
              { key: '初始化时间', value: installation.createdAt },
            ]}
          />
          <Paragraph type="tertiary" size="small" style={{ marginTop: 12 }}>
            签发 License 时需提供上方安装 ID。运行模式由部署环境变量 LICENSE_MODE 控制。
          </Paragraph>
        </section>
      </div>

      <section style={{ width: '100%' }}>
        <div style={sectionTitleStyle}>功能授权矩阵</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {LICENSE_FEATURE_OPTIONS.map((opt) => {
            const enabled = effective.features.includes(opt.value);
            const inLicense = licensedFeatures.has(opt.value);
            return (
              <div
                key={opt.value}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                  borderRadius: 'var(--semi-border-radius-medium)',
                  border: '1px solid var(--semi-color-border)',
                  background: enabled ? 'var(--semi-color-success-light-default)' : 'var(--semi-color-fill-0)',
                  opacity: enabled ? 1 : 0.65,
                }}
              >
                <ShieldCheck size={16} style={{ color: enabled ? 'var(--semi-color-success)' : 'var(--semi-color-text-3)' }} />
                <span style={{ fontSize: 13 }}>{opt.label}</span>
                {enabled && !inLicense && installation.mode === 'warn' && (
                  <Tag size="small" color="orange" style={{ marginLeft: 'auto' }}>warn 放行</Tag>
                )}
              </div>
            );
          })}
        </div>
        <Paragraph type="tertiary" size="small" style={{ marginTop: 12 }}>
          核心能力（组织架构、系统管理、消息、文件、任务等）不占用授权，始终可用。
        </Paragraph>
      </section>
    </Space>
  );
}

function ActivateTab() {
  const [envelope, setEnvelope] = useState('');
  const activateMutation = useActivateLicense();
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:license:manage');

  const handleActivate = async () => {
    if (!envelope.trim()) {
      Toast.warning('请先粘贴 .zenlic 文件内容');
      return;
    }
    const info = await activateMutation.mutateAsync({ body: { envelope: envelope.trim() } });
    Toast.success(`License「${info.licenseId}」已激活`);
    setEnvelope('');
  };

  return (
    <Space vertical align="start" spacing={12} style={{ width: '100%', maxWidth: 760 }}>
      <Paragraph type="tertiary">
        将供应商签发的 .zenlic 文件内容（JSON 文本）粘贴到下方并激活。激活新 License 会自动替换当前生效的旧 License。
      </Paragraph>
      <TextArea
        value={envelope}
        onChange={setEnvelope}
        rows={12}
        placeholder='{"version":1,"algorithm":"Ed25519","keyId":"...","payload":"...","signature":"..."}'
        style={{ fontFamily: 'var(--semi-font-family-code, monospace)', fontSize: 12 }}
        disabled={!canManage}
      />
      <Button
        theme="solid"
        icon={<Upload size={14} />}
        loading={activateMutation.isPending}
        disabled={!canManage}
        onClick={() => void handleActivate()}
      >
        验证并激活
      </Button>
      {!canManage && <Text type="tertiary" size="small">当前账号无激活权限（system:license:manage）</Text>}
    </Space>
  );
}

function EventsTab() {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const eventsQuery = useLicenseEvents({ page, pageSize });

  const columns: ColumnProps<LicenseEventItem>[] = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 200,
      render: (v: string) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span>,
    },
    {
      title: '事件',
      dataIndex: 'typeLabel',
      width: 170,
      render: (label: string, record: LicenseEventItem) => {
        const danger = ['invalid_signature', 'expired', 'clock_anomaly'].includes(record.type);
        const warn = ['entered_grace', 'feature_denied', 'limit_warning'].includes(record.type);
        return <Tag color={danger ? 'red' : warn ? 'orange' : 'blue'}>{label}</Tag>;
      },
    },
    { title: '详情', dataIndex: 'detail', render: (v?: string | null) => v ?? '—' },
  ];

  return (
    <Table
      bordered
      columns={columns}
      dataSource={eventsQuery.data?.list ?? []}
      rowKey="id"
      loading={eventsQuery.isFetching}
      pagination={{
        currentPage: page,
        pageSize,
        total: eventsQuery.data?.total ?? 0,
        onPageChange: setPage,
      }}
      empty="暂无事件"
    />
  );
}

const LICENSE_TABS = ['overview', 'activate', 'events'] as const;

export default function LicensePage() {
  const [activeTab, setActiveTab] = useUrlTabState(LICENSE_TABS, 'overview');

  return (
    <div className="page-container page-tabs-page">
      <Tabs
        type="line"
        collapsible="auto"
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as typeof activeTab)}
        lazyRender
        keepDOM={false}
      >
        <Tabs.TabPane tab="授权概览" itemKey="overview"><OverviewTab /></Tabs.TabPane>
        <Tabs.TabPane tab="激活" itemKey="activate"><ActivateTab /></Tabs.TabPane>
        <Tabs.TabPane tab="事件日志" itemKey="events"><EventsTab /></Tabs.TabPane>
      </Tabs>
    </div>
  );
}
