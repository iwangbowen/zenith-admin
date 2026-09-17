import { FormPasswordInput } from '@/components/PasswordInput';
import { useState } from 'react';
import { Form, Button, Toast, Space, Typography, Divider, Tabs, TabPane } from '@douyinfe/semi-ui';
import PageLoading from '@/components/PageLoading';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Save } from 'lucide-react';
import { OAUTH_PROVIDERS, OAUTH_PROVIDER_LABELS } from '@zenith/shared/identity';
import type { OAuthProviderType, UpdateOauthConfigInput } from '@zenith/shared/identity';
import { OAuthProviderIcon } from '@/components/OAuthProviderIcon';
import { usePermission } from '@/hooks/usePermission';
import { useOAuthConfigs, useSaveOAuthConfig } from '@/hooks/queries/oauth-config';

const { Title, Text } = Typography;

/** 各提供方额外需要的凭据字段（钉钉 Agent ID；企业微信 Agent ID + Corp ID） */
const EXTRA_FIELDS: Partial<Record<OAuthProviderType, { agentId?: boolean; corpId?: boolean }>> = {
  dingtalk: { agentId: true },
  wechat_work: { agentId: true, corpId: true },
};

export default function OAuthConfigPage() {
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('system:oauth-config:update');
  const [formApis, setFormApis] = useState<Record<string, FormApi>>({});
  const configsQuery = useOAuthConfigs();
  const saveMutation = useSaveOAuthConfig();
  const configs = configsQuery.data ?? [];
  const savingProvider = saveMutation.isPending ? (saveMutation.variables?.params.provider ?? null) : null;

  const handleSave = async (provider: OAuthProviderType) => {
    const api = formApis[provider];
    if (!api) return;
    try {
      // 表单字段与整体替换入参一一对应（必填由表单 rules 保证，服务端 schema 兜底）
      const values = (await api.validate()) as UpdateOauthConfigInput;
      await saveMutation.mutateAsync({ params: { provider }, body: values });
      Toast.success(`${OAUTH_PROVIDER_LABELS[provider]} 配置保存成功`);
    } catch {
      // validation failed
    }
  };

  if (configsQuery.isFetching) {
    return <PageLoading inline />;
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
        {OAUTH_PROVIDERS.map((provider) => {
          const cfg = configs.find((c) => c.provider === provider);
          const extra = EXTRA_FIELDS[provider];
          return (
            <TabPane
              key={provider}
              itemKey={provider}
              tab={
                <Space>
                  <OAuthProviderIcon provider={provider} />
                  {OAUTH_PROVIDER_LABELS[provider]}
                </Space>
              }
            >
              <div style={{ maxWidth: 520, paddingLeft: 16 }}>
                <Form
                  getFormApi={(api) => {
                    setFormApis((prev) => ({ ...prev, [provider]: api }));
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
                    autoLinkByEmail: cfg?.autoLinkByEmail ?? false,
                  }}
                >
                  <Form.Input field="clientId" label="Client ID" placeholder="请输入 Client ID" />
                  <FormPasswordInput
                    field="clientSecret"
                    label="Client Secret"
                    placeholder="请输入 Client Secret"
                  />
                  {extra?.agentId && (
                    <Form.Input field="agentId" label="Agent ID" placeholder="请输入 Agent ID" />
                  )}
                  {extra?.corpId && (
                    <Form.Input field="corpId" label="Corp ID" placeholder="请输入企业 Corp ID" />
                  )}
                  <Divider margin="12px 0" />
                  <Form.Switch field="enabled" label="启用" />
                  <Form.Switch
                    field="autoLinkByEmail"
                    label="按邮箱自动关联"
                    extraText="首次第三方登录时，把提供方断言为已验证的邮箱关联到唯一匹配的既有账号并直接登录；默认关闭，未匹配 / 未开启时需先用密码登录再在个人中心绑定。平台超管永不自动关联"
                  />
                </Form>

                {canUpdate && (
                  <div style={{ marginTop: 16 }}>
                    <Button
                      type="primary"
                      icon={<Save size={14} />}
                      loading={savingProvider === provider}
                      onClick={() => handleSave(provider)}
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
