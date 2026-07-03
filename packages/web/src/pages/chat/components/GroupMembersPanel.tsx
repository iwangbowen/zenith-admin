import { useState, useMemo } from 'react';
import { Button, Modal, Toast, Tooltip, TextArea, Input, Tag, Typography, List as SemiList } from '@douyinfe/semi-ui';
import { UserPlus, UserMinus, Crown, Pencil } from 'lucide-react';
import { UserAvatar } from '@/components/UserAvatar';
import { UserSearchList } from './UserSearchList';
import type { ChatConversation, ChatGroupMember } from '@zenith/shared';
import type { ChatUser } from '../types';
import {
  useAddChatGroupMember,
  useChatGroupMembers,
  useRemoveChatGroupMember,
  useTransferChatGroupOwner,
  useUpdateChatGroupInfo,
} from '@/hooks/queries/chat';

const { Text } = Typography;
const EMPTY_MEMBERS: ChatGroupMember[] = [];

export function GroupMembersPanel({
  conversationId, currentUserId, conv, onConvUpdate, onlineUserIds,
}: Readonly<{
  conversationId: number;
  currentUserId: number | null;
  conv: ChatConversation;
  onConvUpdate: (patch: Partial<ChatConversation>) => void;
  onlineUserIds?: Set<number>;
}>) {
  const [showAdd, setShowAdd] = useState(false);
  // 群信息编辑
  const [editName, setEditName] = useState('');
  const [editAnnouncement, setEditAnnouncement] = useState('');
  const [showInfoEdit, setShowInfoEdit] = useState(false);
  const membersQuery = useChatGroupMembers(conversationId);
  const addMemberMutation = useAddChatGroupMember();
  const removeMemberMutation = useRemoveChatGroupMember();
  const transferOwnerMutation = useTransferChatGroupOwner();
  const updateGroupInfoMutation = useUpdateChatGroupInfo();
  const members = membersQuery.data ?? EMPTY_MEMBERS;

  const myRole = members.find((m) => m.id === currentUserId)?.role ?? 'member';
  const isOwner = myRole === 'owner';
  const memberIds = members.map((m) => m.id);
  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => {
      const rank = (m: ChatGroupMember) => {
        if (m.role === 'owner') return 0;
        if (m.username === 'admin' || m.nickname.includes('管理员')) return 1;
        return 2;
      };
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return a.id - b.id;
    }),
    [members],
  );

  const handleAdd = async (user: ChatUser) => {
    try {
      await addMemberMutation.mutateAsync({ conversationId, userId: user.id });
    } catch {
      return;
    }
    Toast.success(`已添加 ${user.nickname}`);
    setShowAdd(false);
  };

  const handleRemoveMember = (member: ChatGroupMember) => {
    Modal.confirm({
      title: `确定移除 ${member.nickname}？`,
      content: '移除后该成员将无法看到群聊消息。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        try {
          await removeMemberMutation.mutateAsync({ conversationId, memberId: member.id });
        } catch {
          return;
        }
        Toast.success('已移除');
      },
    });
  };

  const handleTransfer = (member: ChatGroupMember) => {
    Modal.confirm({
      title: `确定将群主转让给 ${member.nickname}？`,
      content: '转让后你将成为普通成员，无法撤销。',
      okButtonProps: { type: 'warning', theme: 'solid' },
      onOk: async () => {
        try {
          await transferOwnerMutation.mutateAsync({ conversationId, newOwnerId: member.id });
        } catch {
          return;
        }
        Toast.success('群主已转让');
      },
    });
  };

  const handleSaveInfo = async () => {
    const body: { name?: string; announcement?: string | null } = {};
    if (editName.trim() !== (conv.name ?? '')) body.name = editName.trim();
    if (editAnnouncement !== (conv.announcement ?? '')) body.announcement = editAnnouncement || null;
    if (Object.keys(body).length === 0) { setShowInfoEdit(false); return; }
    try {
      await updateGroupInfoMutation.mutateAsync({ conversationId, values: body });
    } catch {
      return;
    }
    Toast.success('已更新');
    setShowInfoEdit(false);
    onConvUpdate({ name: body.name ?? conv.name, announcement: body.announcement === undefined ? conv.announcement : body.announcement });
  };

  return (
    <div style={{ width: 240, borderLeft: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>
      {/* 群信息区 */}
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--semi-color-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Text strong style={{ flex: 1, fontSize: 13 }}>群聊设置</Text>
          {isOwner && (
            <Tooltip content={showInfoEdit ? '取消编辑' : '编辑群名/公告'}>
              <Button
                size="small" theme="borderless" type={showInfoEdit ? 'primary' : 'tertiary'}
                icon={<Pencil size={13} />}
                onClick={() => {
                  setShowInfoEdit((v) => {
                    if (!v) {
                      setEditName(conv.name ?? '');
                      setEditAnnouncement(conv.announcement ?? '');
                    }
                    return !v;
                  });
                }}
              />
            </Tooltip>
          )}
        </div>
        {showInfoEdit ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Input
              size="small"
              placeholder="群聊名称"
              value={editName}
              onChange={setEditName}
            />
            <TextArea
              placeholder="群公告（可为空）"
              rows={3}
              maxCount={500}
              value={editAnnouncement}
              onChange={(v) => setEditAnnouncement(v)}
              autosize
            />
            <Text type="tertiary" size="small" style={{ fontSize: 11 }}>保存后，原公告将归入「群公告历史」记录</Text>
            <Button size="small" theme="solid" loading={updateGroupInfoMutation.isPending} onClick={() => { void handleSaveInfo(); }}>保存</Button>
          </div>
        ) : (
          <>
            {conv.announcement && (
              <div style={{ padding: '6px 8px', background: 'var(--semi-color-warning-light-default)', borderRadius: 6, fontSize: 12, color: 'var(--semi-color-text-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                📢 {conv.announcement}
              </div>
            )}
          </>
        )}
      </div>

      {/* 成员列表 */}
      <div style={{ flex: 1, padding: '8px 12px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 6 }}>
          <Text strong style={{ flex: 1, fontSize: 13 }}>成员（{members.length}）</Text>
          <Tooltip content="添加成员">
            <Button
              size="small" theme="borderless" type="primary"
              icon={<UserPlus size={14} />}
              loading={addMemberMutation.isPending}
              onClick={() => setShowAdd((v) => !v)}
            />
          </Tooltip>
        </div>
        {showAdd && (
          <div style={{ marginBottom: 10, padding: 8, background: 'var(--semi-color-fill-0)', borderRadius: 6 }}>
            <Text style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>搜索添加成员</Text>
            <UserSearchList onSelect={handleAdd} excludeIds={memberIds} />
          </div>
        )}
        <SemiList
          dataSource={sortedMembers}
          loading={membersQuery.isFetching}
          emptyContent={<Text type="tertiary" style={{ display: 'block', padding: '16px 0', textAlign: 'center', fontSize: 12 }}>暂无成员</Text>}
          renderItem={(m: ChatGroupMember) => {
            const isSelf = m.id === currentUserId;
            return (
              <SemiList.Item
                key={m.id}
                align="center"
                style={{ padding: '6px 0' }}
                header={(
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    <UserAvatar name={m.nickname} avatar={m.avatar} size={28} />
                    {onlineUserIds?.has(m.id) && (
                      <span style={{ position: 'absolute', insetInlineEnd: -1, bottom: -1, width: 9, height: 9, borderRadius: '50%', background: 'var(--semi-color-success)', border: '2px solid var(--semi-color-bg-1)', boxSizing: 'border-box' }} />
                    )}
                  </span>
                )}
                main={(
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Text style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
                        {m.nickname}
                      </Text>
                      {m.role === 'owner' && (
                        <Tag size="small" color="amber" style={{ padding: '0 4px', lineHeight: '16px', fontSize: 10 }}>
                          <Crown size={9} style={{ marginRight: 2 }} />群主
                        </Tag>
                      )}
                    </div>
                  </div>
                )}
                extra={isOwner && !isSelf && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    <Tooltip content="转让群主">
                      <Button
                        size="small"
                        theme="borderless"
                        type="tertiary"
                        icon={<Crown size={13} />}
                        onClick={() => handleTransfer(m)}
                        style={{ padding: '2px 4px', height: 'auto', minWidth: 'auto' }}
                      />
                    </Tooltip>
                    <Tooltip content="移除成员">
                      <Button
                        size="small"
                        theme="borderless"
                        type="danger"
                        icon={<UserMinus size={13} />}
                        onClick={() => handleRemoveMember(m)}
                        style={{ padding: '2px 4px', height: 'auto', minWidth: 'auto' }}
                      />
                    </Tooltip>
                  </div>
                )}
              />
            );
          }}
        />
      </div>
    </div>
  );
}
