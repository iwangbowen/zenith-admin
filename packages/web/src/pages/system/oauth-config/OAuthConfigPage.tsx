import { useState, useEffect } from 'react';
import { Form, Button, Toast, Space, Spin, Typography, Divider, Tabs, TabPane } from '@douyinfe/semi-ui';
import { Save } from 'lucide-react';
import type { OAuthConfig, OAuthProviderType } from '@zenith/shared';
import { request } from '../../../utils/request';
import { usePermission } from '../../../hooks/usePermission';

const { Title, Text } = Typography;

interface ProviderMeta {
  key: OAuthProviderType;
  label: string;
  icon: React.ReactNode;
  extra?: { agentId?: boolean; corpId?: boolean };
}

const PROVIDERS: ProviderMeta[] = [
  {
    key: 'github',
    label: 'GitHub',
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
      </svg>
    ),
  },
  {
    key: 'dingtalk',
    label: '钉钉',
    icon: (
      <svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor">
        <path d="M512 0C229.2 0 0 229.2 0 512s229.2 512 512 512 512-229.2 512-512S794.8 0 512 0zm227 603.6c-6 10.2-29 31.6-72.8 66L642 690.8l13.6 59.4s1.2 5.2-2.4 7.2-7.6 0-7.6 0l-85.6-52.4c0 0-29.6 15.2-41.6 19.6-12 4.4-14.4-4.8-14-8.4l7.6-56.8-162.8-2s-6.8-0.8-8.4-6.4c-2-7.2 6.8-10.8 6.8-10.8l98-43.6-24.4-32.8s-4-6.8 0.8-9.6c4.8-2.8 9.6 1.6 9.6 1.6l114 67.2 96.4-60s28.4-18.4 42-31.2c13.6-12.8 12-22.4 12-22.4-4-36-125.2-52-204-72-78.8-20-180.8-60-162-148 0 0 8.8-50 80-98.4 0 0 47.2-46.8 52.4 15.2 0 0 4 38.8-6.4 50-10.4 11.2-48.4 40.4-48.4 40.4s-24.4 14.4-10.4 24c14 9.6 78 38 133.2 46.4 55.2 8.4 172.8 8 208 80.8 0 0 25.2 44.4 10.8 68.8z" />
      </svg>
    ),
    extra: { agentId: true },
  },
  {
    key: 'wechat_work',
    label: '企业微信',
    icon: (
      <svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor">
        <path d="M672 288c-105.6 0-198.4 52-256 131.2C358.4 340 265.6 288 160 288 71.6 288 0 359.6 0 448c0 52.4 25.2 100 64 129.6L42.4 648c-2 5.6 3.6 10.8 9.2 8.4l60-28.8C140.4 644 172 656 208 660l-2.4-12c0-119.2 96.8-216 216-216 5.6 0 11.2 0.4 16.8 0.8C465.6 345.6 560.4 288 672 288zm-160 144c-17.6 0-32-14.4-32-32s14.4-32 32-32 32 14.4 32 32-14.4 32-32 32zM352 400c0-17.6 14.4-32 32-32s32 14.4 32 32-14.4 32-32 32-32-14.4-32-32zm480 48c0 117.6-96.8 216-216 216-36 0-70-9.6-100-26l-60 28.8c-5.6 2.4-11.2-2.8-9.2-8.4l21.6-70.4c-38.8-30-64-77.6-64-129.6 0-117.6 96.8-216 216-216 98.4 0 181.2 66.4 206.8 156.8 3.2 16.4 4.8 32.8 4.8 48.8zm-272-40c-17.6 0-32-14.4-32-32s14.4-32 32-32 32 14.4 32 32-14.4 32-32 32zm160 0c-17.6 0-32-14.4-32-32s14.4-32 32-32 32 14.4 32 32-14.4 32-32 32z" />
      </svg>
    ),
    extra: { agentId: true, corpId: true },
  },
];

export default function OAuthConfigPage() {
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('system:oauth-config:update');
  const [loading, setLoading] = useState(false);
  const [configs, setConfigs] = useState<OAuthConfig[]>([]);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [formApis, setFormApis] = useState<Record<string, any>>({});

  useEffect(() => {
    setLoading(true);
    request
      .get<OAuthConfig[]>('/api/oauth-config')
      .then((res) => {
        if (res.code === 0 && res.data) {
          setConfigs(res.data);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (provider: OAuthProviderType) => {
    const api = formApis[provider];
    if (!api) return;
    try {
      const values = await api.validate();
      setSavingProvider(provider);
      const res = await request.put<OAuthConfig>(`/api/oauth-config/${provider}`, values);
      if (res.code === 0) {
        Toast.success(`${PROVIDERS.find((p) => p.key === provider)?.label} 配置保存成功`);
      }
    } catch {
      // validation failed
    } finally {
      setSavingProvider(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div style={{ marginBottom: 24 }}>
        <Title heading={5} style={{ margin: 0 }}>
          OAuth 配置
        </Title>
        <Text type="tertiary">配置第三方登录提供方，启用后用户可使用第三方账号登录系统</Text>
      </div>

      <Tabs tabPosition="left" style={{ minHeight: 360 }}>
        {PROVIDERS.map((meta) => {
          const cfg = configs.find((c) => c.provider === meta.key);
          return (
            <TabPane
              key={meta.key}
              itemKey={meta.key}
              tab={
                <Space>
                  {meta.icon}
                  {meta.label}
                </Space>
              }
            >
              <div style={{ maxWidth: 520, paddingLeft: 16 }}>
                <Form
                  getFormApi={(api) => {
                    setFormApis((prev) => ({ ...prev, [meta.key]: api }));
                  }}
                  labelPosition="left"
                  labelWidth={120}
                  style={{ width: '100%' }}
                  initValues={{
                    clientId: cfg?.clientId || '',
                    clientSecret: cfg?.clientSecret || '',
                    agentId: cfg?.agentId || '',
                    corpId: cfg?.corpId || '',
                    enabled: cfg?.enabled ?? false,
                  }}
                >
                  <Form.Input field="clientId" label="Client ID" placeholder="请输入 Client ID" />
                  <Form.Input
                    field="clientSecret"
                    label="Client Secret"
                    type="password"
                    placeholder="请输入 Client Secret"
                  />
                  {meta.extra?.agentId && (
                    <Form.Input field="agentId" label="Agent ID" placeholder="请输入 Agent ID" />
                  )}
                  {meta.extra?.corpId && (
                    <Form.Input field="corpId" label="Corp ID" placeholder="请输入企业 Corp ID" />
                  )}
                  <Divider margin="12px 0" />
                  <Form.Switch field="enabled" label="启用" />
                </Form>

                {canUpdate && (
                  <div style={{ marginTop: 16 }}>
                    <Button
                      type="primary"
                      icon={<Save size={14} />}
                      loading={savingProvider === meta.key}
                      onClick={() => handleSave(meta.key)}
                    >
                      保存
                    </Button>
                  </div>
                )}
              </div>
            </TabPane>
          );
        })}
      </Tabs>
    </div>
  );
}
