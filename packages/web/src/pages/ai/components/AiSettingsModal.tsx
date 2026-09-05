import { useEffect, useRef, useState } from 'react';
import { Button, Form, Popconfirm, Spin, Tabs, TabPane, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import AppModal from '@/components/AppModal';
import {
  useAiSettings,
  useSaveAiSettings,
  useAiMemoryProfile,
  useSaveAiMemoryProfile,
  useClearAiMemoryProfile,
} from '@/hooks/queries/ai-extras';

const { Text } = Typography;

interface AiSettingsModalProps {
  readonly visible: boolean;
  /** 打开时定位到的 Tab（如从聊天记忆卡片直达「AI 记忆」） */
  readonly initialTab?: 'instructions' | 'memory';
  readonly onClose: () => void;
}

/** 用户级 AI 设置弹窗：个人指令（Custom Instructions）+ AI 记忆（working memory 画像） */
export default function AiSettingsModal({ visible, initialTab = 'instructions', onClose }: AiSettingsModalProps) {
  const formApi = useRef<FormApi | null>(null);
  const settingsQuery = useAiSettings(visible);
  const saveMutation = useSaveAiSettings();
  const profileQuery = useAiMemoryProfile(visible);
  const saveProfileMutation = useSaveAiMemoryProfile();
  const clearProfileMutation = useClearAiMemoryProfile();
  const [formKey, setFormKey] = useState(0);
  const [profileDraft, setProfileDraft] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  useEffect(() => {
    if (visible && settingsQuery.data) setFormKey((k) => k + 1);
  }, [visible, settingsQuery.data]);

  // 打开时定位到调用方指定的 Tab
  useEffect(() => {
    if (visible) setActiveTab(initialTab);
  }, [visible, initialTab]);

  // 画像草稿：打开/远端刷新时重置为远端值
  useEffect(() => {
    if (visible) setProfileDraft(null);
  }, [visible, profileQuery.data]);

  const s = settingsQuery.data;
  const profileContent = profileDraft ?? profileQuery.data?.content ?? '';
  const profileDirty = profileDraft !== null && profileDraft !== (profileQuery.data?.content ?? '');

  const handleOk = async () => {
    const values = formApi.current?.getValues() as {
      aboutMe?: string; replyStyle?: string; instructionsEnabled?: boolean; memoryEnabled?: boolean;
    } | undefined;
    await saveMutation.mutateAsync({
      body: {
        instructions: {
          enabled: values?.instructionsEnabled ?? true,
          aboutMe: values?.aboutMe?.trim() || null,
          replyStyle: values?.replyStyle?.trim() || null,
        },
        memory: { enabled: values?.memoryEnabled ?? true },
      },
    });
    if (profileDirty) {
      await saveProfileMutation.mutateAsync({ body: { content: profileContent } });
    }
    Toast.success('已保存，之后的对话将自动生效');
    onClose();
  };

  return (
    <AppModal
      title="AI 个性化设置"
      visible={visible}
      onOk={handleOk}
      onCancel={onClose}
      okButtonProps={{ loading: saveMutation.isPending || saveProfileMutation.isPending }}
      width={560}
      closeOnEsc
    >
      <Form
        key={formKey}
        getFormApi={(api) => { formApi.current = api; }}
        initValues={{
          aboutMe: s?.instructions.aboutMe ?? '',
          replyStyle: s?.instructions.replyStyle ?? '',
          instructionsEnabled: s?.instructions.enabled ?? true,
          memoryEnabled: s?.memory.enabled ?? true,
        }}
        labelPosition="top"
      >
        <Tabs type="line" size="small" activeKey={activeTab} onChange={setActiveTab}>
          <TabPane tab="个人指令" itemKey="instructions">
            <Text type="tertiary" size="small" style={{ display: 'block', margin: '8px 0 12px' }}>
              AI 在所有对话中都会参考这些信息（对话角色模板优先级更高）
            </Text>
            <Form.TextArea
              field="aboutMe"
              label="关于我"
              rows={4}
              maxLength={2000}
              placeholder="例如：我是一名后端工程师，主要使用 TypeScript 和 PostgreSQL……"
            />
            <Form.TextArea
              field="replyStyle"
              label="回答风格要求"
              rows={4}
              maxLength={2000}
              placeholder="例如：回答尽量简洁，代码示例优先，中文回复……"
            />
            <Form.Switch field="instructionsEnabled" label="启用个人指令" />
          </TabPane>
          <TabPane tab="AI 记忆" itemKey="memory">
            <Text type="tertiary" size="small" style={{ display: 'block', margin: '8px 0 12px' }}>
              开启后 AI 会自动从对话中记住你的稳定偏好与背景（跨对话生效），内容可随时查看、编辑或清空
            </Text>
            <Form.Switch field="memoryEnabled" label="启用 AI 记忆" />
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text strong style={{ fontSize: 13 }}>记忆画像</Text>
                <Popconfirm
                  title="确定清空 AI 记忆画像吗？"
                  content="清空后 AI 将忘记已学到的所有信息"
                  onConfirm={() => {
                    void clearProfileMutation.mutateAsync({}).then(() => {
                      setProfileDraft(null);
                      Toast.success('已清空');
                    });
                  }}
                >
                  <Button size="small" type="danger" theme="borderless" loading={clearProfileMutation.isPending}>
                    清空记忆
                  </Button>
                </Popconfirm>
              </div>
              {profileQuery.isLoading ? (
                <div style={{ textAlign: 'center', padding: '16px 0' }}><Spin /></div>
              ) : (
                <TextArea
                  value={profileContent}
                  onChange={setProfileDraft}
                  rows={9}
                  maxLength={8000}
                  placeholder="AI 尚未记住任何内容；随着对话进行会自动更新，也可以直接在此编辑"
                  style={{ fontFamily: 'var(--semi-font-family-code, monospace)', fontSize: 12 }}
                />
              )}
            </div>
          </TabPane>
        </Tabs>
      </Form>
    </AppModal>
  );
}
