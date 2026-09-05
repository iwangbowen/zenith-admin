import type { RefObject } from 'react';
import { Button, Form, Input, Modal, Space, TagInput, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { AiPromptTemplate } from '@zenith/shared/ai';
import AppModal from '@/components/AppModal';
import { extractPromptVariables } from '../chat-utils';

/** 重命名会话 */
export function RenameConversationModal({ visible, value, onChange, onOk, onCancel }: Readonly<{
  visible: boolean; value: string; onChange: (v: string) => void; onOk: () => void; onCancel: () => void;
}>) {
  return (
    <AppModal
      title="重命名会话"
      visible={visible}
      onOk={onOk}
      onCancel={onCancel}
      closeOnEsc
      width={360}
    >
      <Input
        value={value}
        onChange={onChange}
        placeholder="请输入新名称"
        maxLength={200}
        showClear
        onEnterPress={onOk}
        autoFocus
      />
    </AppModal>
  );
}

/** 点踩原因（字典 ai_dislike_reason）：选一项即提交，或跳过 */
export function DislikeReasonModal({ visible, reasons, onSubmit, onCancel }: Readonly<{
  visible: boolean;
  reasons: Array<{ value: string; label: string }>;
  onSubmit: (reason: string | null) => void;
  onCancel: () => void;
}>) {
  return (
    <Modal
      title="可以告诉我们哪里需要改进吗？"
      visible={visible}
      footer={null}
      onCancel={onCancel}
      closeOnEsc
      width={380}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {reasons.map((r) => (
          <Button key={r.value} onClick={() => onSubmit(r.value)}>{r.label}</Button>
        ))}
      </div>
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Button theme="borderless" type="tertiary" onClick={onCancel}>跳过</Button>
      </div>
    </Modal>
  );
}

/** 角色模板 {{变量}} 填充表单；表单 api 交给调用方校验取值 */
export function PromptVariablesModal({ template, formApiRef, onOk, onCancel }: Readonly<{
  template: AiPromptTemplate | null;
  formApiRef: RefObject<FormApi | null>;
  onOk: () => Promise<void>;
  onCancel: () => void;
}>) {
  return (
    <AppModal
      title={`填写角色变量 — ${template?.name ?? ''}`}
      visible={template !== null}
      onOk={onOk}
      onCancel={onCancel}
      closeOnEsc
      width={480}
    >
      {template && (
        <Form
          key={template.id}
          getFormApi={(api) => { formApiRef.current = api; }}
          labelPosition="top"
        >
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
            该角色模板包含变量占位符，填写后将替换到提示词中
          </Typography.Text>
          {extractPromptVariables(template.content).map((name) => (
            <Form.Input
              key={name}
              field={name}
              label={name}
              placeholder={`请输入${name}`}
              rules={[{ required: true, message: `请输入${name}` }]}
            />
          ))}
        </Form>
      )}
    </AppModal>
  );
}

/** 对话标签编辑（最多 10 个，每个不超过 20 字） */
export function ConversationTagsModal({ visible, value, onChange, onOk, onCancel }: Readonly<{
  visible: boolean; value: string[]; onChange: (tags: string[]) => void; onOk: () => void; onCancel: () => void;
}>) {
  return (
    <AppModal
      title="编辑对话标签"
      visible={visible}
      onOk={onOk}
      onCancel={onCancel}
      closeOnEsc
      width={420}
    >
      <Space vertical align="start" style={{ width: '100%' }}>
        <Typography.Text type="tertiary" size="small">最多 10 个标签，每个不超过 20 字，回车添加</Typography.Text>
        <TagInput
          value={value}
          onChange={(v) => onChange((v as string[]).slice(0, 10))}
          placeholder="输入标签后回车"
          max={10}
          maxLength={20}
          style={{ width: '100%' }}
          autoFocus
        />
      </Space>
    </AppModal>
  );
}
