import { useEffect, useRef, useState } from 'react';
import { Form, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import AppModal from '@/components/AppModal';
import { useAiPreference, useSaveAiPreference } from '@/hooks/queries/ai-extras';

interface PreferenceModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
}

/** 个人指令（Custom Instructions）编辑弹窗 */
export default function PreferenceModal({ visible, onClose }: PreferenceModalProps) {
  const formApi = useRef<FormApi | null>(null);
  const query = useAiPreference(visible);
  const saveMutation = useSaveAiPreference();
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (visible && query.data) setFormKey((k) => k + 1);
  }, [visible, query.data]);

  const handleOk = async () => {
    const values = formApi.current?.getValues() as { aboutMe?: string; replyStyle?: string; isEnabled?: boolean } | undefined;
    await saveMutation.mutateAsync({
      aboutMe: values?.aboutMe?.trim() || null,
      replyStyle: values?.replyStyle?.trim() || null,
      isEnabled: values?.isEnabled ?? true,
    });
    Toast.success('已保存，之后的对话将自动生效');
    onClose();
  };

  return (
    <AppModal
      title="个人指令"
      visible={visible}
      onOk={handleOk}
      onCancel={onClose}
      okButtonProps={{ loading: saveMutation.isPending }}
      width={520}
      closeOnEsc
    >
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
        AI 在所有对话中都会参考这些信息（对话角色模板优先级更高）
      </Typography.Text>
      <Form
        key={formKey}
        getFormApi={(api) => { formApi.current = api; }}
        initValues={{
          aboutMe: query.data?.aboutMe ?? '',
          replyStyle: query.data?.replyStyle ?? '',
          isEnabled: query.data?.isEnabled ?? true,
        }}
        labelPosition="top"
      >
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
        <Form.Switch field="isEnabled" label="启用个人指令" />
      </Form>
    </AppModal>
  );
}
