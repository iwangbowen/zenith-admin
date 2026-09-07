import { useState } from 'react';
import { Input, Toast, Typography, List as SemiList } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import { Search, CheckSquare, Square } from 'lucide-react';
import { chatContract } from '@zenith/shared/chat';
import { api } from '@/lib/contract-query';
import { UserAvatar } from '@/components/UserAvatar';
import { useChatUsers } from '@/hooks/queries/chat';
import { useDebouncedValue } from '@tanstack/react-pacer';
import type { ChatConversation } from '@zenith/shared/chat';
import type { ChatUser } from '../types';

const { Text } = Typography;

export function ForwardModal({
  visible, conversations, currentConvId, onConfirm, onCancel, mode, title, hint, okText,
}: Readonly<{
  visible: boolean;
  conversations: ChatConversation[];
  currentConvId: number | null;
  onConfirm: (targetIds: number[]) => void;
  onCancel: () => void;
  mode: 'merge' | 'individual';
  /** 复用为其他「选择会话」场景（如网盘发送到聊天）时覆盖标题 / 说明 / 按钮文案 */
  title?: string;
  hint?: string;
  okText?: string;
}>) {
  const [selected, setSelected] = useState<number[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<ChatUser[]>([]);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword] = useDebouncedValue(keyword.trim(), { wait: 300 });
  const [submitting, setSubmitting] = useState(false);

  const filtered = conversations.filter((c) => {
    if (c.id === currentConvId) return false;
    const name = c.type === 'direct' ? (c.targetUser?.nickname ?? '') : (c.name ?? '');
    return !keyword || name.toLowerCase().includes(keyword.toLowerCase());
  });

  // 已有单聊会话的用户从「用户」区排除：他们通过上方会话行选择
  const directUserIds = new Set(
    conversations.filter((c) => c.type === 'direct' && c.targetUser).map((c) => c.targetUser!.id),
  );
  const usersQuery = useChatUsers({ keyword: debouncedKeyword || undefined }, visible && !!debouncedKeyword);
  const searchedUsers = (usersQuery.data ?? []).filter((u) => !directUserIds.has(u.id));

  const toggle = (id: number) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const toggleUser = (user: ChatUser) => {
    setSelectedUsers((prev) => prev.some((u) => u.id === user.id)
      ? prev.filter((u) => u.id !== user.id)
      : [...prev, user]);
  };

  const resetAndClose = () => {
    setSelected([]);
    setSelectedUsers([]);
    setKeyword('');
    onCancel();
  };

  const handleConfirm = async () => {
    const totalCount = selected.length + selectedUsers.length;
    if (totalCount === 0) { Toast.warning('请选择转发目标'); return; }
    setSubmitting(true);
    try {
      // 尚无会话的用户先建单聊会话，再合并入目标会话列表
      const createdIds: number[] = [];
      for (const user of selectedUsers) {
        const conv = await api(chatContract.createDirect, { body: { targetUserId: user.id } }).catch(() => null);
        if (!conv) { Toast.error(`无法与 ${user.nickname} 建立会话`); return; }
        createdIds.push(conv.id);
      }
      onConfirm([...selected, ...createdIds]);
      setSelected([]);
      setSelectedUsers([]);
      setKeyword('');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCount = selected.length + selectedUsers.length;

  return (
    <AppModal
      title={title ?? (mode === 'merge' ? '合并转发 — 选择目标' : '逐条转发 — 选择目标')}
      visible={visible}
      onCancel={resetAndClose}
      onOk={() => { void handleConfirm(); }}
      okText={okText ?? '确认转发'}
      okButtonProps={{ disabled: selectedCount === 0, loading: submitting }}
      width={480}
    >
      <div style={{ marginBottom: 12 }}>
        <Input prefix={<Search size={13} />} placeholder="搜索会话或用户" value={keyword} onChange={setKeyword} size="small" />
      </div>
      <Text type="tertiary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        {hint ?? (mode === 'merge' ? '将所选消息合并为一条聊天记录转发' : '将所选消息逐条独立转发')}
      </Text>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        <SemiList
          bordered
          size="small"
          dataSource={filtered}
          emptyContent={(
            <div style={{ padding: '20px 0', textAlign: 'center' }}>
              <Text type="tertiary" style={{ fontSize: 12 }}>暂无匹配的会话</Text>
            </div>
          )}
          style={{ borderRadius: 'var(--semi-border-radius-medium)' }}
          renderItem={(conv: ChatConversation) => {
            const name = conv.type === 'direct' ? (conv.targetUser?.nickname ?? '未知用户') : (conv.name ?? '群聊');
            const isChecked = selected.includes(conv.id);
            return (
              <SemiList.Item
                key={conv.id}
                onClick={() => toggle(conv.id)}
                align="center"
                style={{
                  padding: '10px 14px',
                  background: isChecked ? 'var(--semi-color-primary-light-default)' : 'transparent',
                  cursor: 'pointer',
                }}
                header={(
                  <span style={{ color: isChecked ? 'var(--semi-color-primary)' : 'var(--semi-color-text-3)', flexShrink: 0 }}>
                    {isChecked ? <CheckSquare size={16} /> : <Square size={16} />}
                  </span>
                )}
                main={<Text style={{ fontSize: 13, flex: 1 }}>{name}</Text>}
              />
            );
          }}
        />
        {debouncedKeyword && searchedUsers.length > 0 && (
          <>
            <Text type="tertiary" style={{ fontSize: 12, display: 'block', margin: '10px 0 6px' }}>
              用户（将新建单聊会话）
            </Text>
            <SemiList
              bordered
              size="small"
              dataSource={searchedUsers}
              style={{ borderRadius: 'var(--semi-border-radius-medium)' }}
              renderItem={(user: ChatUser) => {
                const isChecked = selectedUsers.some((u) => u.id === user.id);
                return (
                  <SemiList.Item
                    key={user.id}
                    onClick={() => toggleUser(user)}
                    align="center"
                    style={{
                      padding: '8px 14px',
                      background: isChecked ? 'var(--semi-color-primary-light-default)' : 'transparent',
                      cursor: 'pointer',
                    }}
                    header={(
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ color: isChecked ? 'var(--semi-color-primary)' : 'var(--semi-color-text-3)' }}>
                          {isChecked ? <CheckSquare size={16} /> : <Square size={16} />}
                        </span>
                        <UserAvatar name={user.nickname} avatar={user.avatar} size={24} />
                      </span>
                    )}
                    main={(
                      <Text style={{ fontSize: 13, flex: 1 }}>
                        {user.nickname}
                        <Text type="tertiary" style={{ fontSize: 12, marginLeft: 6 }}>@{user.username}</Text>
                      </Text>
                    )}
                  />
                );
              }}
            />
          </>
        )}
      </div>
      {selectedCount > 0 && (
        <Text type="tertiary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
          已选 {selectedCount} 个目标
        </Text>
      )}
    </AppModal>
  );
}
