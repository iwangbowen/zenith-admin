import { useState, useMemo } from 'react';
import { Button, Modal, Toast, Tooltip, TextArea, Input, Tag, Typography, List as SemiList, Switch, Dropdown, Tabs, TabPane } from '@douyinfe/semi-ui';
import { UserPlus, UserMinus, Crown, Pencil, Shield, MicOff, Mic, Link2, UserCheck } from 'lucide-react';
import dayjs from 'dayjs';
import { UserAvatar } from '@/components/UserAvatar';
import { UserSearchList } from './UserSearchList';
import { OrgTreePicker } from './OrgTreePicker';
import { GroupInviteModal } from './GroupInviteModal';
import type { ChatConversation, ChatGroupMember } from '@zenith/shared';
import type { ChatUser } from '../types';
import {
  useAddChatGroupMember,
  useChatGroupMembers,
  useChatJoinRequests,
  useHandleChatJoinRequest,
  useMuteChatMember,
  useRemoveChatGroupMember,
  useSetChatJoinApproval,
  useSetChatMemberRole,
  useSetChatMuteAll,
  useTransferChatGroupOwner,
  useUpdateChatGroupInfo,
} from '@/hooks/queries/chat';

const { Text } = Typography;
const EMPTY_MEMBERS: ChatGroupMember[] = [];

const MUTE_DURATIONS: Array<{ label: string; minutes?: number }> = [
  { label: '10 分钟', minutes: 10 },
  { label: '1 小时', minutes: 60 },
  { label: '12 小时', minutes: 720 },
  { label: '1 天', minutes: 1440 },
  { label: '永久', minutes: undefined },
];

function isMutedNow(m: ChatGroupMember): boolean {
  return !!m.mutedUntil && dayjs(m.mutedUntil).isAfter(dayjs());
}

function muteLabel(m: ChatGroupMember): string {
  if (!m.mutedUntil) return '';
  const until = dayjs(m.mutedUntil);
  if (until.year() >= 9000) return '永久禁言';
  return `禁言至 ${until.format('MM-DD HH:mm')}`;
}

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
  const [showInvite, setShowInvite] = useState(false);
  // 群信息编辑
  const [editName, setEditName] = useState('');
  const [editAnnouncement, setEditAnnouncement] = useState('');
  const [showInfoEdit, setShowInfoEdit] = useState(false);
  const membersQuery = useChatGroupMembers(conversationId);
  const addMemberMutation = useAddChatGroupMember();
  const removeMemberMutation = useRemoveChatGroupMember();
  const transferOwnerMutation = useTransferChatGroupOwner();
  const updateGroupInfoMutation = useUpdateChatGroupInfo();
  const setMemberRoleMutation = useSetChatMemberRole();
  const muteMemberMutation = useMuteChatMember();
  const setMuteAllMutation = useSetChatMuteAll();
  const setJoinApprovalMutation = useSetChatJoinApproval();
  const handleJoinRequestMutation = useHandleChatJoinRequest();
  const members = membersQuery.data ?? EMPTY_MEMBERS;

  const myRole = members.find((m) => m.id === currentUserId)?.role ?? 'member';
  const isOwner = myRole === 'owner';
  const canManage = isOwner || myRole === 'admin';
  const joinRequestsQuery = useChatJoinRequests(conversationId, canManage);
  const joinRequests = joinRequestsQuery.data ?? [];
  const memberIds = members.map((m) => m.id);
  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => {
      const rank = (m: ChatGroupMember) => {
        if (m.role === 'owner') return 0;
        if (m.role === 'admin') return 1;
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

  const handleSetRole = async (member: ChatGroupMember, role: 'admin' | 'member') => {
    try {
      await setMemberRoleMutation.mutateAsync({ conversationId, userId: member.id, role });
    } catch {
      return;
    }
    Toast.success(role === 'admin' ? `已将 ${member.nickname} 设为管理员` : `已取消 ${member.nickname} 的管理员身份`);
  };

  const handleMute = async (member: ChatGroupMember, durationMinutes?: number) => {
    try {
      await muteMemberMutation.mutateAsync({ conversationId, userId: member.id, mute: true, durationMinutes });
    } catch {
      return;
    }
    Toast.success(`已禁言 ${member.nickname}`);
  };

  const handleUnmute = async (member: ChatGroupMember) => {
    try {
      await muteMemberMutation.mutateAsync({ conversationId, userId: member.id, mute: false });
    } catch {
      return;
    }
    Toast.success(`已解除 ${member.nickname} 的禁言`);
  };

  const handleToggleMuteAll = async (muteAll: boolean) => {
    try {
      await setMuteAllMutation.mutateAsync({ conversationId, muteAll });
    } catch {
      return;
    }
    onConvUpdate({ muteAll });
    Toast.success(muteAll ? '已开启全员禁言' : '已解除全员禁言');
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
          {canManage && (
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
        {canManage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Text type="tertiary" style={{ flex: 1, fontSize: 12 }}>全员禁言</Text>
            <Switch
              size="small"
              checked={conv.muteAll ?? false}
              loading={setMuteAllMutation.isPending}
              onChange={(v) => { void handleToggleMuteAll(v); }}
            />
          </div>
        )}
        {canManage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Text type="tertiary" style={{ flex: 1, fontSize: 12 }}>入群审批</Text>
            <Switch
              size="small"
              checked={conv.joinApproval ?? false}
              loading={setJoinApprovalMutation.isPending}
              onChange={(v) => {
                void setJoinApprovalMutation.mutateAsync({ conversationId, enabled: v }).then(() => {
                  onConvUpdate({ joinApproval: v });
                  Toast.success(v ? '已开启入群审批' : '已关闭入群审批');
                }).catch(() => undefined);
              }}
            />
          </div>
        )}
        {!canManage && conv.muteAll && (
          <Tag size="small" color="red" style={{ marginBottom: 6 }}>全员禁言中</Tag>
        )}
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
          {canManage && (
            <Tooltip content="邀请入群（链接/二维码）">
              <Button
                size="small" theme="borderless" type="primary"
                icon={<Link2 size={14} />}
                onClick={() => setShowInvite(true)}
              />
            </Tooltip>
          )}
          <Tooltip content="添加成员">
            <Button
              size="small" theme="borderless" type="primary"
              icon={<UserPlus size={14} />}
              loading={addMemberMutation.isPending}
              onClick={() => setShowAdd((v) => !v)}
            />
          </Tooltip>
        </div>
        {canManage && joinRequests.length > 0 && (
          <div style={{ marginBottom: 10, padding: 8, background: 'var(--semi-color-warning-light-default)', borderRadius: 6 }}>
            <Text strong style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, fontSize: 12 }}>
              <UserCheck size={13} />入群申请（{joinRequests.length}）
            </Text>
            {joinRequests.map((req) => (
              <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                <UserAvatar name={req.nickname} avatar={req.avatar} size={24} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.nickname}</Text>
                  {req.message && <Text type="tertiary" style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.message}</Text>}
                </div>
                <Button
                  size="small" theme="borderless" type="primary"
                  loading={handleJoinRequestMutation.isPending}
                  onClick={() => { void handleJoinRequestMutation.mutateAsync({ id: req.id, approve: true }).then(() => Toast.success('已通过')).catch(() => undefined); }}
                  style={{ padding: '2px 6px', height: 'auto', minWidth: 'auto' }}
                >
                  通过
                </Button>
                <Button
                  size="small" theme="borderless" type="danger"
                  onClick={() => { void handleJoinRequestMutation.mutateAsync({ id: req.id, approve: false }).then(() => Toast.success('已拒绝')).catch(() => undefined); }}
                  style={{ padding: '2px 6px', height: 'auto', minWidth: 'auto' }}
                >
                  拒绝
                </Button>
              </div>
            ))}
          </div>
        )}
        {showAdd && (
          <div style={{ marginBottom: 10, padding: 8, background: 'var(--semi-color-fill-0)', borderRadius: 6 }}>
            <Tabs size="small" defaultActiveKey="search">
              <TabPane tab="搜索" itemKey="search">
                <div style={{ paddingTop: 6 }}>
                  <UserSearchList onSelect={handleAdd} excludeIds={memberIds} />
                </div>
              </TabPane>
              <TabPane tab="组织架构" itemKey="org">
                <div style={{ paddingTop: 6 }}>
                  <OrgTreePicker onSelectUser={handleAdd} excludeIds={memberIds} height={240} />
                </div>
              </TabPane>
            </Tabs>
          </div>
        )}
        <SemiList
          dataSource={sortedMembers}
          loading={membersQuery.isFetching}
          emptyContent={<Text type="tertiary" style={{ display: 'block', padding: '16px 0', textAlign: 'center', fontSize: 12 }}>暂无成员</Text>}
          renderItem={(m: ChatGroupMember) => {
            const isSelf = m.id === currentUserId;
            const muted = isMutedNow(m);
            // 群主可管理任何人；管理员只能管理普通成员
            const canActOn = !isSelf && (isOwner ? m.role !== 'owner' : (myRole === 'admin' && m.role === 'member'));
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <Text style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
                        {m.nickname}
                      </Text>
                      {m.role === 'owner' && (
                        <Tag size="small" color="amber" style={{ padding: '0 4px', lineHeight: '16px', fontSize: 10 }}>
                          <Crown size={9} style={{ marginRight: 2 }} />群主
                        </Tag>
                      )}
                      {m.role === 'admin' && (
                        <Tag size="small" color="blue" style={{ padding: '0 4px', lineHeight: '16px', fontSize: 10 }}>
                          <Shield size={9} style={{ marginRight: 2 }} />管理员
                        </Tag>
                      )}
                      {muted && (
                        <Tooltip content={muteLabel(m)}>
                          <Tag size="small" color="red" style={{ padding: '0 4px', lineHeight: '16px', fontSize: 10 }}>
                            <MicOff size={9} style={{ marginRight: 2 }} />禁言
                          </Tag>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                )}
                extra={canActOn && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    {isOwner && (
                      <Tooltip content={m.role === 'admin' ? '取消管理员' : '设为管理员'}>
                        <Button
                          size="small"
                          theme="borderless"
                          type={m.role === 'admin' ? 'primary' : 'tertiary'}
                          icon={<Shield size={13} />}
                          onClick={() => { void handleSetRole(m, m.role === 'admin' ? 'member' : 'admin'); }}
                          style={{ padding: '2px 4px', height: 'auto', minWidth: 'auto' }}
                        />
                      </Tooltip>
                    )}
                    {muted ? (
                      <Tooltip content="解除禁言">
                        <Button
                          size="small"
                          theme="borderless"
                          type="tertiary"
                          icon={<Mic size={13} />}
                          onClick={() => { void handleUnmute(m); }}
                          style={{ padding: '2px 4px', height: 'auto', minWidth: 'auto' }}
                        />
                      </Tooltip>
                    ) : (
                      <Dropdown
                        trigger="click"
                        position="bottomRight"
                        render={(
                          <Dropdown.Menu>
                            <Dropdown.Title>禁言时长</Dropdown.Title>
                            {MUTE_DURATIONS.map((d) => (
                              <Dropdown.Item key={d.label} onClick={() => { void handleMute(m, d.minutes); }}>
                                {d.label}
                              </Dropdown.Item>
                            ))}
                          </Dropdown.Menu>
                        )}
                      >
                        <span>
                          <Tooltip content="禁言">
                            <Button
                              size="small"
                              theme="borderless"
                              type="tertiary"
                              icon={<MicOff size={13} />}
                              style={{ padding: '2px 4px', height: 'auto', minWidth: 'auto' }}
                            />
                          </Tooltip>
                        </span>
                      </Dropdown>
                    )}
                    {isOwner && (
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
                    )}
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
      <GroupInviteModal
        conversationId={conversationId}
        groupName={conv.name ?? '群聊'}
        visible={showInvite}
        onClose={() => setShowInvite(false)}
      />
    </div>
  );
}
