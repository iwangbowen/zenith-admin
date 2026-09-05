import React, { useState } from 'react';
import { Button, Collapse, List, Popconfirm, SideSheet, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { Plus } from 'lucide-react';
import type { AiChatModel, UserAiConfig } from '@zenith/shared/ai';
import { AI_COMMON_PROVIDERS } from '@zenith/shared/ai';
import AiProviderFormModal from './AiProviderFormModal';
import { useAiChatModels } from '@/hooks/queries/ai-providers';
import { useAiUserConfigs, useDeleteAiUserConfig } from '@/hooks/queries/ai-user-config';

const { Text } = Typography;

const PROVIDER_LABELS = new Map(AI_COMMON_PROVIDERS.map((p) => [p.id, p.label]));

interface UserAiConfigModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

interface GroupedItem {
  type: 'system' | 'user';
  config: AiChatModel | UserAiConfig;
}

export default function UserAiConfigModal({ visible, onClose, onSaved }: UserAiConfigModalProps) {
  const [formVisible, setFormVisible] = useState(false);
  const [formTarget, setFormTarget] = useState<UserAiConfig | undefined>(undefined);
  const systemConfigsQuery = useAiChatModels();
  const userConfigsQuery = useAiUserConfigs(visible);
  const deleteMutation = useDeleteAiUserConfig();
  const systemConfigs = visible ? (systemConfigsQuery.data ?? []) : [];
  const userConfigs = visible ? (userConfigsQuery.data ?? []) : [];
  const loading = systemConfigsQuery.isFetching || userConfigsQuery.isFetching;
  const deletingId = deleteMutation.isPending ? (deleteMutation.variables?.params.id ?? null) : null;

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ params: { id } });
      Toast.success('删除成功');
      onSaved();
    } catch {
      // handled by interceptor
    }
  };

  // 按 providerId 分组(常用服务商排前,其余按出现顺序)
  const grouped = new Map<string, GroupedItem[]>();
  const pushItem = (providerId: string, item: GroupedItem) => {
    const list = grouped.get(providerId) ?? [];
    list.push(item);
    grouped.set(providerId, list);
  };
  for (const c of systemConfigs) pushItem(c.providerId, { type: 'system', config: c });
  for (const c of userConfigs) pushItem(c.providerId ?? 'custom', { type: 'user', config: c });
  const commonOrder = new Map(AI_COMMON_PROVIDERS.map((p, i) => [p.id, i]));
  const activeProviders = [...grouped.keys()].sort(
    (a, b) => (commonOrder.get(a) ?? 999) - (commonOrder.get(b) ?? 999) || a.localeCompare(b),
  );

  const openCreate = () => {
    setFormTarget(undefined);
    setFormVisible(true);
  };

  const openEdit = (cfg: UserAiConfig) => {
    setFormTarget(cfg);
    setFormVisible(true);
  };

  return (
    <>
      <SideSheet
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
            <span>AI 配置</span>
            <Button
              type="primary"
              size="small"
              icon={<Plus size={13} />}
              onClick={openCreate}
            >
              新增我的配置
            </Button>
          </div>
        }
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
                        <span>{PROVIDER_LABELS.get(pType) ?? pType}</span>
                        <Tag size="small" color="blue">{grouped.get(pType)?.length ?? 0}</Tag>
                      </Space>
                    }
                    itemKey={pType}
                  >
                    <List
                      size="small"
                      split
                      dataSource={grouped.get(pType) ?? []}
                      renderItem={({ type, config }) => {
                        const isUser = type === 'user';
                        const name = isUser
                          ? ((config as UserAiConfig).name ?? '我的配置')
                          : (config as AiChatModel).name;
                        const model = isUser
                          ? (() => {
                              const uc = config as UserAiConfig;
                              const extra = uc.models.length > 1 ? ` 等 ${uc.models.length} 个模型` : '';
                              return uc.defaultModel ? `${uc.defaultModel}${extra}` : null;
                            })()
                          : (config as AiChatModel).model;
                        // 系统配置走 /api/ai/models，仅返回启用项
                        const isEnabled = isUser ? (config as UserAiConfig).isEnabled : true;
                        return (
                          <List.Item
                            key={isUser ? `user-${config.id}` : `sys-${(config as AiChatModel).id}`}
                            main={
                              <Space align="center" style={{ gap: 6 }}>
                                <Tag color={isUser ? 'violet' : 'blue'} size="small">
                                  {isUser ? '我的' : '系统'}
                                </Tag>
                                <Text style={{ fontSize: 13, fontWeight: 600 }}>{name}</Text>
                                {!isUser && (config as AiChatModel).isDefault && (
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
                              <Space>
                                <Button theme="borderless" size="small" onClick={() => openEdit(config as UserAiConfig)}>编辑</Button>
                                <Popconfirm
                                  title="确定删除这个配置吗？"
                                  onConfirm={() => void handleDelete(config.id)}
                                >
                                  <Button
                                    theme="borderless"
                                    type="danger"
                                    size="small"
                                    loading={deletingId === config.id}
                                  >
                                    删除
                                  </Button>
                                </Popconfirm>
                              </Space>
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
        userConfig={formTarget}
        onSaved={() => {
          setFormVisible(false);
          onSaved();
        }}
      />
    </>
  );
}
