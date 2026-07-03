import { useState } from 'react';
import { Form, Button, Toast, Space, Spin, Typography, Divider, Tabs, TabPane } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Save } from 'lucide-react';
import { Icon } from '@iconify/react';
import type { OAuthProviderType } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { useOAuthConfigs, useSaveOAuthConfig } from '@/hooks/queries/oauth-config';

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
    icon: <Icon icon="simple-icons:github" width="16" height="16" />,
  },
  {
    key: 'dingtalk',
    label: '钉钉',
    icon: <Icon icon="ant-design:dingtalk-outlined" width="16" height="16" />,
    extra: { agentId: true },
  },
  {
    key: 'wechat_work',
    label: '企业微信',
    icon: <Icon icon="ant-design:wechat-work-filled" width="16" height="16" />,
    extra: { agentId: true, corpId: true },
  },
];

export default function OAuthConfigPage() {
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('system:oauth-config:update');
  const [formApis, setFormApis] = useState<Record<string, FormApi>>({});
  const configsQuery = useOAuthConfigs();
  const saveMutation = useSaveOAuthConfig();
  const configs = configsQuery.data ?? [];
  const savingProvider = saveMutation.isPending ? (saveMutation.variables?.provider ?? null) : null;

  const handleSave = async (provider: OAuthProviderType) => {
    const api = formApis[provider];
    if (!api) return;
    try {
      const values = await api.validate();
      await saveMutation.mutateAsync({ provider, values: values as Record<string, unknown> });
      Toast.success(`${PROVIDERS.find((p) => p.key === provider)?.label} 配置保存成功`);
    } catch {
      // validation failed
    }
  };

  if (configsQuery.isFetching) {
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
                  allowEmpty
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
