/**
 * 会话标签编辑弹窗
 *
 * 用 Semi TagInput 维护会话标签数组（最多 10 个，每个 ≤ 20 字），
 * 保存时调用 PUT /api/channels/cs/{channelId}/conversations/{userId}/tags。
 */
import { useEffect, useState } from 'react';
import { TagInput, Toast, Typography } from '@douyinfe/semi-ui';
import type { ChannelConversation } from '@zenith/shared';
import { request } from '@/utils/request';
import { AppModal } from '@/components/AppModal';

const MAX_TAGS = 10;
const MAX_TAG_LEN = 20;

interface Props {
  channelId: number;
  conversation: ChannelConversation | null;
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function ConversationTagModal({ channelId, conversation, visible, onClose, onSaved }: Readonly<Props>) {
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) setTags(conversation?.tags ?? []);
  }, [visible, conversation]);

  const handleAdd = (value: string | string[]) => {
    const incoming = Array.isArray(value) ? value : [value];
    const next = [...tags];
    for (const raw of incoming) {
      const v = raw.trim();
      if (!v) continue;
      if (v.length > MAX_TAG_LEN) { Toast.warning(`标签不能超过 ${MAX_TAG_LEN} 字`); continue; }
      if (next.includes(v)) continue;
      if (next.length >= MAX_TAGS) { Toast.warning(`最多 ${MAX_TAGS} 个标签`); break; }
      next.push(v);
    }
    setTags(next);
  };

  const handleSubmit = async () => {
    if (conversation == null) return;
    setSubmitting(true);
    try {
      const res = await request.put(
        `/api/channels/cs/${channelId}/conversations/${conversation.userId}/tags`,
        { tags },
      );
      if (res.code === 0) {
        Toast.success('标签已更新');
        onClose();
        onSaved?.();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppModal
      title={`编辑标签${conversation ? ` · ${conversation.userName}` : ''}`}
      visible={visible}
      onCancel={onClose}
      onOk={() => void handleSubmit()}
      confirmLoading={submitting}
      okText="保存"
      width={460}
      fullscreenable={false}
    >
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
        最多 {MAX_TAGS} 个标签，每个不超过 {MAX_TAG_LEN} 字。输入后按 Enter 添加。
      </Typography.Text>
      <TagInput
        value={tags}
        onChange={setTags}
        onAdd={handleAdd}
        addOnBlur
        allowDuplicates={false}
        maxTagCount={MAX_TAGS}
        placeholder="输入标签后回车"
        style={{ width: '100%' }}
      />
    </AppModal>
  );
}

export default ConversationTagModal;
