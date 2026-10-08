import { useRef, useState, type CSSProperties } from 'react';
import { Banner, Button, Descriptions, Empty, Form, Space, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Copy, Download, KeyRound } from 'lucide-react';
import { SUPER_ADMIN_CODE } from '@zenith/shared/identity';
import {
  createLicensePayload,
  LICENSE_EDITION_LABELS,
  LICENSE_EDITION_PRESETS,
  LICENSE_EDITIONS,
  LICENSE_FEATURE_LABELS,
  LICENSE_FEATURE_OPTIONS,
  licenseIssuanceSchema,
  type LicenseEdition,
  type LicenseIssuanceInput,
  type LicensePayload,
} from '@zenith/shared/licensing';
import PageLoading from '@/components/PageLoading';
import DateTimeText from '@/components/DateTimeText';
import { PasswordInput } from '@/components/PasswordInput';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { useLicensingStatus } from '@/hooks/queries/licensing';
import { copyTextWithToast } from '@/utils/clipboard';
import { downloadBlob } from '@/utils/download';
import { signLicenseEnvelope } from './license-issuer';
import './license-generation.css';

const { Paragraph, Text } = Typography;

type IssuanceFormValues = Omit<LicenseIssuanceInput, 'notBefore' | 'maintenanceUntil'> & {
  keyId: string;
  notBefore?: Date | null;
  maintenanceUntil?: Date | null;
};

const gridStyle = { '--auto-grid-cols': 2, '--auto-grid-min': '280px', '--auto-grid-row-gap': '12px' } as CSSProperties;
const editionOptions = LICENSE_EDITIONS.map((value) => ({ value, label: LICENSE_EDITION_LABELS[value] }));

export default function GenerateLicenseTab() {
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const statusQuery = useLicensingStatus();
  // 页面级一次性表单，不是新增 / 编辑弹窗；私钥单独保留在组件状态，避免进入表单数据。
  const formApi = useRef<FormApi<IssuanceFormValues> | null>(null);
  const [privateKey, setPrivateKey] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ payload: LicensePayload; envelope: string } | null>(null);
  const canGenerate = hasPermission('system:license:manage')
    && Boolean(user && user.tenantId == null && user.roles?.some((role) => role.code === SUPER_ADMIN_CODE));

  if (!canGenerate) return <Empty title="无生成权限" description="授权文件生成仅供拥有 License 管理权限的平台超级管理员使用。" style={{ padding: '48px 0' }} />;
  if (statusQuery.isLoading) return <PageLoading inline />;
  if (!statusQuery.data) return <Empty title="加载失败" description="无法读取当前安装信息" style={{ padding: '48px 0' }} />;

  const generate = async () => {
    let values: IssuanceFormValues;
    try {
      if (!formApi.current) return;
      values = await formApi.current.validate();
    } catch {
      return;
    }
    setError(null);
    setGenerated(null);
    setGenerating(true);
    try {
      if (!globalThis.crypto?.randomUUID) {
        throw new Error('当前浏览器不支持本地授权文件生成，请通过 HTTPS 或 localhost 打开页面。');
      }
      const input = {
        installationId: values.installationId,
        customerName: values.customerName,
        customerId: values.customerId?.trim() || undefined,
        licenseId: values.licenseId?.trim() || undefined,
        edition: values.edition,
        features: values.features,
        validDays: values.validDays,
        graceDays: values.graceDays,
        limits: {
          maxUsers: values.limits?.maxUsers ?? null,
          maxTenants: values.limits?.maxTenants ?? null,
          maxNodes: values.limits?.maxNodes ?? null,
        },
        // License 是跨系统交换文档，使用 ISO 时刻；普通业务表单仍遵循本地时间契约。
        notBefore: values.notBefore?.toISOString(),
        maintenanceUntil: values.maintenanceUntil?.toISOString() ?? null,
      } satisfies LicenseIssuanceInput;
      const validated = licenseIssuanceSchema.safeParse(input);
      if (!validated.success) throw new Error(validated.error.issues[0]?.message ?? '授权参数无效');
      const payload = createLicensePayload(validated.data, {
        now: new Date(),
        licenseId: `lic_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
        customerId: `cus_${crypto.randomUUID().slice(0, 8)}`,
      });
      const envelope = await signLicenseEnvelope(payload, { keyId: values.keyId, privateKey });
      setGenerated({ payload, envelope: JSON.stringify(envelope, null, 2) });
      Toast.success('授权文件已生成');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '授权文件生成失败，请检查输入后重试');
    } finally {
      setPrivateKey('');
      setGenerating(false);
    }
  };

  return (
    <div style={{ maxWidth: 960 }}>
      <Paragraph type="tertiary">
        使用你保管的签发私钥在当前浏览器生成 .zenlic 文件。生成后下载并交给目标部署，在「激活」页签安装授权。
      </Paragraph>
      <Form<IssuanceFormValues>
        className="license-generation-form"
        getFormApi={(api) => { formApi.current = api; }}
        disabled={generating}
        labelPosition="top"
        initValues={{
          installationId: statusQuery.data.installation.installationId,
          customerName: '',
          edition: 'pro',
          features: [...LICENSE_EDITION_PRESETS.pro],
          validDays: 365,
          graceDays: 30,
          keyId: statusQuery.data.usingTestKey ? 'test-2026' : statusQuery.data.license?.keyId ?? '',
        }}
        onValueChange={() => { setGenerated(null); setError(null); }}
      >
        <div className="auto-grid" style={gridStyle}>
          <Form.Input field="installationId" label="目标安装 ID" placeholder="填写目标部署的安装 ID" rules={[{ required: true, message: '请输入安装 ID' }]} />
          <Form.Input field="customerName" label="客户名称" maxLength={128} rules={[{ required: true, message: '请输入客户名称' }]} />
          <Form.Input field="customerId" label="客户 ID" maxLength={64} placeholder="留空自动生成" />
          <Form.Input field="licenseId" label="License ID" maxLength={64} placeholder="留空自动生成" />
          <Form.Select
            field="edition"
            label="版本预设"
            optionList={editionOptions}
            style={{ width: '100%' }}
            onChange={(value) => {
              const edition = value as LicenseEdition;
              formApi.current?.setValue('features', [...LICENSE_EDITION_PRESETS[edition]]);
            }}
            extraText="选择版本会载入默认功能，之后可按实际授权调整。"
          />
          <Form.Input field="keyId" label="签发密钥 ID" maxLength={64} placeholder="填写这把签发密钥的标识" rules={[{ required: true, message: '请输入签发密钥 ID' }]} />
          <Form.InputNumber field="validDays" label="有效天数" min={1} max={36500} precision={0} style={{ width: '100%' }} rules={[{ required: true, message: '请输入有效天数' }]} />
          <Form.InputNumber field="graceDays" label="宽限天数" min={0} max={36500} precision={0} style={{ width: '100%' }} rules={[{ required: true, message: '请输入宽限天数' }]} />
          <Form.DatePicker field="notBefore" label="生效时间" type="dateTime" style={{ width: '100%' }} placeholder="留空立即生效" />
          <Form.DatePicker field="maintenanceUntil" label="维护截止时间" type="dateTime" style={{ width: '100%' }} placeholder="可选，仅记录维护权益" />
          <Form.InputNumber field="limits.maxUsers" label="席位上限" min={1} precision={0} style={{ width: '100%' }} placeholder="留空不限" />
          <Form.InputNumber field="limits.maxTenants" label="租户上限" min={1} precision={0} style={{ width: '100%' }} placeholder="留空不限" />
          <Form.InputNumber field="limits.maxNodes" label="节点上限" min={1} precision={0} style={{ width: '100%' }} placeholder="留空不限" extraText="节点上限仅作为授权信息记录。" />
        </div>
        <Form.CheckboxGroup field="features" label="授权功能" options={LICENSE_FEATURE_OPTIONS} direction="horizontal" />
      </Form>

      <div className="rr-block rr-ignore" data-sensitive style={{ margin: '16px 0' }}>
        <label htmlFor="license-signing-private-key" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>签发私钥</label>
        <PasswordInput
          id="license-signing-private-key"
          value={privateKey}
          autoComplete="off"
          disabled={generating}
          onChange={(value) => { setPrivateKey(value); setError(null); }}
          placeholder="Ed25519 PKCS8 Base64 或未加密的 PRIVATE KEY PEM"
        />
        <Paragraph type="tertiary" size="small" style={{ marginTop: 8, marginBottom: 0 }}>
          私钥不上传、不保存，也不进入会话回放。签发完成、重置或离开本页签后清空。目标部署须信任对应的签发公钥。
        </Paragraph>
      </div>
      {error && <Banner type="danger" fullMode={false} closeIcon={null} description={error} style={{ marginBottom: 16 }} />}
      <Space wrap>
        <Button theme="solid" icon={<KeyRound size={14} />} disabled={!privateKey.trim()} loading={generating} onClick={() => void generate()}>生成授权文件</Button>
        <Button disabled={generating} onClick={() => { formApi.current?.reset(); setPrivateKey(''); setGenerated(null); setError(null); }}>重置</Button>
      </Space>

      {generated && (
        <div className="rr-block" data-sensitive style={{ marginTop: 24 }}>
          <Descriptions align="left" data={[
            { key: 'License ID', value: generated.payload.licenseId },
            { key: '客户', value: generated.payload.customerName },
            { key: '生效时间', value: <DateTimeText value={generated.payload.notBefore} mode="absolute" /> },
            { key: '到期时间', value: <DateTimeText value={generated.payload.expiresAt} mode="absolute" /> },
            { key: '宽限截止', value: <DateTimeText value={generated.payload.graceUntil} mode="absolute" /> },
            { key: '授权功能', value: generated.payload.features.map((feature) => LICENSE_FEATURE_LABELS[feature]).join('、') || '仅核心能力' },
          ]} />
          <Space wrap style={{ margin: '12px 0' }}>
            <Button icon={<Download size={14} />} theme="solid" onClick={() => downloadBlob(new Blob([generated.envelope], { type: 'application/json;charset=utf-8' }), `${generated.payload.licenseId.replace(/[^\w.-]/g, '_')}.zenlic`)}>下载 .zenlic</Button>
            <Button icon={<Copy size={14} />} onClick={() => void copyTextWithToast(generated.envelope, { success: '授权文件内容已复制' })}>复制文件内容</Button>
          </Space>
          <TextArea value={generated.envelope} readOnly rows={8} aria-label="生成的授权文件内容" style={{ fontFamily: 'var(--semi-font-family-code, monospace)', fontSize: 12 }} />
          <Text type="tertiary" size="small">生成文件不改变当前授权状态，请在目标部署的「激活」页签验证并安装。</Text>
        </div>
      )}
    </div>
  );
}
