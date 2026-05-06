import { useState } from 'react';
import { Modal, Input, Toast, Typography } from '@douyinfe/semi-ui';
import { Search, CheckSquare, Square } from 'lucide-react';
import type { ChatConversation } from '@zenith/shared';

const { Text } = Typography;

export function ForwardModal({
  visible, conversations, currentConvId, onConfirm, onCancel, mode,
}: Readonly<{
  visible: boolean;
  conversations: ChatConversation[];
  currentConvId: number | null;
  onConfirm: (targetIds: number[]) => void;
  onCancel: () => void;
  mode: 'merge' | 'individual';
}>) {
  const [selected, setSelected] = useState<number[]>([]);
  const [keyword, setKeyword] = useState('');

  const filtered = conversations.filter((c) => {
    if (c.id === currentConvId) return false;
    const name = c.type === 'direct' ? (c.targetUser?.nickname ?? '') : (c.name ?? '');
    return !keyword || name.toLowerCase().includes(keyword.toLowerCase());
  });

  const toggle = (id: number) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const handleConfirm = () => {
    if (selected.length === 0) { Toast.warning('请选择转发目标'); return; }
    onConfirm(selected);
    setSelected([]);
    setKeyword('');
  };

  return (
    <Modal
      title={mode === 'merge' ? '合并转发 — 选择目标会话' : '逐条转发 — 选择目标会话'}
      visible={visible}
      onCancel={() => { setSelected([]); setKeyword(''); onCancel(); }}
      onOk={handleConfirm}
      okText="确认转发"
      okButtonProps={{ disabled: selected.length === 0 }}
      width={480}
    >
      <div style={{ marginBottom: 12 }}>
        <Input prefix={<Search size={13} />} placeholder="搜索会话" value={keyword} onChange={setKeyword} size="small" />
      </div>
      <Text type="tertiary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        {mode === 'merge' ? '将所选消息合并为一条聊天记录转发' : '将所选消息逐条独立转发'}
      </Text>
      <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--semi-color-border)', borderRadius: 8 }}>
        {filtered.length === 0 && (
          <div style={{ padding: '20px 0', textAlign: 'center' }}>
            <Text type="tertiary" style={{ fontSize: 12 }}>暂无其他会话</Text>
          </div>
        )}
        {filtered.map((conv) => {
          const name = conv.type === 'direct' ? (conv.targetUser?.nickname ?? '未知用户') : (conv.name ?? '群聊');
          const isChecked = selected.includes(conv.id);
          return (
            <button
              key={conv.id}
              type="button"
              onClick={() => toggle(conv.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', width: '100%', border: 'none',
                background: isChecked ? 'var(--semi-color-primary-light-default)' : 'transparent',
                cursor: 'pointer', textAlign: 'left',
                borderBottom: '1px solid var(--semi-color-border)',
              }}
            >
              <span style={{ color: isChecked ? 'var(--semi-color-primary)' : 'var(--semi-color-text-3)', flexShrink: 0 }}>
                {isChecked ? <CheckSquare size={16} /> : <Square size={16} />}
              </span>
              <Text style={{ fontSize: 13, flex: 1 }}>{name}</Text>
            </button>
          );
        })}
      </div>
      {selected.length > 0 && (
        <Text type="tertiary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
          已选 {selected.length} 个会话
        </Text>
      )}
    </Modal>
  );
}
