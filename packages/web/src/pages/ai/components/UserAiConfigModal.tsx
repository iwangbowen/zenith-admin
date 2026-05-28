import React, { useEffect, useState } from 'react';
import { Button, Collapse, List, SideSheet, Space, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { Edit2, Plus } from 'lucide-react';
import type { AiProvider, AiProviderConfig, UserAiConfig } from '@zenith/shared';
import { request } from '@/utils/request';
import AiProviderFormModal from './AiProviderFormModal';

const { Text } = Typography;

const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai_compatible: 'OpenAI Compatible',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  baidu: '百度千帆',
};

const PROVIDERS_ORDER: AiProvider[] = ['openai_compatible', 'anthropic', 'gemini', 'baidu'];

interface UserAiConfigModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSaved: (config: UserAiConfig) => void;
}

interface GroupedItem {
  type: 'system' | 'user';
  config: AiProviderConfig | UserAiConfig;
}

export default function UserAiConfigModal({ visible, onClose, onSaved }: UserAiConfigModalProps) {
  const [loading, setLoading] = useState(false);
  const [systemConfigs, setSystemConfigs] = useState<AiProviderConfig[]>([]);
  const [userConfig, setUserConfig] = useState<UserAiConfig | null>(null);
  const [formVisible, setFormVisible] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sysRes, userRes] = await Promise.all([
        request.get<AiProviderConfig[]>('/api/ai/providers'),
        request.get<UserAiConfig | null>('/api/ai/user-config').catch(() => ({ data: null, code: 0, message: '' })),
      ]);
      setSystemConfigs(sysRes.data ?? []);
      setUserConfig(userRes.data ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) void loadData();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // 按供应商类型分组
  const grouped = PROVIDERS_ORDER.reduce<Record<AiProvider, GroupedItem[]>>((acc, pType) => {
    const sys = systemConfigs
      .filter((c) => c.provider === pType)
      .map((c) => ({ type: 'system' as const, config: c }));
    const user =
      userConfig?.provider === pType ? [{ type: 'user' as const, config: userConfig }] : [];
    acc[pType] = [...sys, ...user];
    return acc;
  }, {} as Record<AiProvider, GroupedItem[]>);

  const activeProviders = PROVIDERS_ORDER.filter((p) => grouped[p].length > 0);

  const openUserForm = () => {
    setFormVisible(true);
  };

  return (
    <>
      <SideSheet
        title="AI 配置"
        visible={visible}
        onCancel={onClose}
        width={480}
        footer={null}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: '64px 0' }}>
            <Spin size="large" />
          </div>
        ) : (
          <>
            {/* 操作栏 */}
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button
                type="primary"
                size="small"
                icon={userConfig ? <Edit2 size={13} /> : <Plus size={13} />}
                onClick={openUserForm}
              >
                {userConfig ? '编辑我的配置' : '新增我的配置'}
              </Button>
            </div>

            {activeProviders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <Text type="tertiary">暂无可用配置</Text>
              </div>
            ) : (
              <Collapse defaultActiveKey={activeProviders} keepDOM>
                {activeProviders.map((pType) => (
                  <Collapse.Panel
                    key={pType}
                    header={
                      <Space>
                        <span>{PROVIDER_LABELS[pType]}</span>
                        <Tag size="small" color="blue">{grouped[pType].length}</Tag>
                      </Space>
                    }
                    itemKey={pType}
                  >
                    <List
                      size="small"
                      split
                      dataSource={grouped[pType]}
                      renderItem={({ type, config }) => {
                        const isUser = type === 'user';
                        const name = isUser
                          ? ((config as UserAiConfig).name ?? '我的配置')
                          : (config as AiProviderConfig).name;
                        const model = config.model;
                        const isEnabled = config.isEnabled;
                        return (
                          <List.Item
                            key={isUser ? 'user' : `sys-${(config as AiProviderConfig).id}`}
                            main={
                              <Space align="center" style={{ gap: 6 }}>
                                <Tag color={isUser ? 'violet' : 'blue'} size="small">
                                  {isUser ? '我的' : '系统'}
                                </Tag>
                                <Text style={{ fontSize: 13, fontWeight: 600 }}>{name}</Text>
                                {!isUser && (config as AiProviderConfig).isDefault && (
                                  <Tag color="cyan" size="small">默认</Tag>
                                )}
                                <Tag color={isEnabled ? 'green' : 'grey'} size="small">
                                  {isEnabled ? '启用' : '禁用'}
                                </Tag>
                                {model && (
                                  <Text type="tertiary" style={{ fontSize: 12 }}>{model}</Text>
                                )}
                              </Space>
                            }
                            extra={isUser ? (
                              <Button theme="borderless" size="small" onClick={openUserForm}>编辑</Button>
                            ) : null}
                          />
                        );
                      }}
                    />
                  </Collapse.Panel>
                ))}
              </Collapse>
            )}
          </>
        )}
      </SideSheet>

      {/* 用户配置表单 */}
      <AiProviderFormModal
        mode="user"
        visible={formVisible}
        onClose={() => setFormVisible(false)}
        userConfig={userConfig}
        onSaved={(savedCfg) => {
          setUserConfig(savedCfg);
          setFormVisible(false);
          onSaved(savedCfg);
        }}
      />
    </>
  );
}
