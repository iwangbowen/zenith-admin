import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Input, Button, Avatar, Badge, Typography, Empty, Spin, Toast, Tooltip, Tabs, TabPane, Dropdown, Modal, TextArea, Tag, Select, DatePicker,
} from '@douyinfe/semi-ui';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { Search, MessageSquarePlus, Send, CornerDownLeft, RotateCcw, Smile, ImagePlus, Users, User, UserPlus, Copy, Paperclip, Pin, Star, X, Download, Crown, UserMinus, Pencil, ChevronLeft, ChevronRight, ListFilter, AtSign, Bookmark, History, CheckSquare, Square, Forward } from 'lucide-react';
import { useWebSocket, sendWsMessage } from '@/hooks/useWebSocket';
import { request } from '@/utils/request';
import { formatDateTime, formatConvTime, formatDateTimeForApi } from '@/utils/date';
import { formatFileSize, getFileTypeIcon } from '@/utils/file-utils';
import type {
  ChatConversation, ChatMessage, WsMessage, ChatLinkPreview, ChatAssetMeta, ChatMessageExtra, ChatGroupMember, ChatMessageSearchItem, ChatMessageSearchResult, ChatMessageContext,
} from '@zenith/shared';

const { Text, Title } = Typography;
const MESSAGE_TIME_GROUP_GAP_MS = 5 * 60 * 1000;

interface ChatUser {
  id: number;
  nickname: string;
  username: string;
  avatar?: string | null;
}

interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
}

type SearchDatePreset = '' | 'today' | '7d' | '30d';

const CHAT_MESSAGE_TYPE_OPTIONS: Array<{ value: ChatMessage['type']; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'file', label: '文件' },
  { value: 'system', label: '系统' },
];

function getAvatarColor(name: string): string {
  const colors = ['#f093fb', '#4facfe', '#43e97b', '#fa709a', '#fee140', '#a18cd1', '#fbc2eb', '#a1c4fd'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (name.codePointAt(i) ?? 0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function UserAvatar({ name, avatar, size = 36 }: Readonly<{ name: string; avatar?: string | null; size?: number }>) {
  if (avatar) return <Avatar src={avatar} size="small" style={{ width: size, height: size, flexShrink: 0 }} />;
  return (
    <Avatar size="small" style={{ width: size, height: size, flexShrink: 0, backgroundColor: getAvatarColor(name) }}>
      {name.slice(0, 1).toUpperCase()}
    </Avatar>
  );
}

function GroupGridAvatar({
  name,
  size = 36,
  members,
}: Readonly<{
  name: string;
  size?: number;
  members?: Array<{ id: number; nickname: string; avatar?: string | null }>;
}>) {
  const memberCells = (members ?? []).slice(0, 9).map((member, idx) => ({
    key: `m-${member.id}-${idx}`,
    avatar: member.avatar,
    char: member.nickname.slice(0, 1),
  }));

  const cells = memberCells.length > 0
    ? memberCells
    : [{ key: `placeholder-${name}`, avatar: null, char: '' }];

  const count = cells.length;
  let cols = 3;
  let rows = 3;
  if (count <= 1) {
    cols = 1;
    rows = 1;
  } else if (count === 2) {
    cols = 2;
    rows = 1;
  } else if (count <= 4) {
    cols = 2;
    rows = 2;
  } else if (count <= 6) {
    cols = 3;
    rows = 2;
  }

  const gap = 1;
  const innerSize = size - 4;
  const cellSize = Math.max(8, Math.floor((innerSize - (cols - 1) * gap) / cols));

  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 8,
        padding: 2,
        boxSizing: 'border-box',
        background: 'var(--semi-color-fill-0)',
        border: '1px solid var(--semi-color-border)',
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
        justifyContent: 'center',
        alignContent: 'center',
        gap,
      }}
    >
      {cells.map((cell, idx) => (
        <div
          key={cell.key}
          style={{
            width: cellSize,
            height: cellSize,
            borderRadius: 3,
            background: cell.char ? getAvatarColor(`${name}-${idx}`) : 'var(--semi-color-fill-1)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: Math.max(8, Math.floor(cellSize * 0.52)),
            lineHeight: 1,
            fontWeight: 600,
            overflow: 'hidden',
          }}
        >
          {cell.avatar ? (
            <img
              src={cell.avatar}
              alt={cell.char || '成员'}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            cell.char ? cell.char.slice(0, 1).toUpperCase() : ''
          )}
        </div>
      ))}
    </div>
  );
}

function getMessageTimestamp(value: string): number {
  return new Date(value.replace(' ', 'T')).getTime();
}

function shouldDisplayMessageTime(current: ChatMessage, next?: ChatMessage): boolean {
  if (!next) return true;
  const currentTime = getMessageTimestamp(current.createdAt);
  const nextTime = getMessageTimestamp(next.createdAt);
  if (Number.isNaN(currentTime) || Number.isNaN(nextTime)) return true;
  return nextTime - currentTime > MESSAGE_TIME_GROUP_GAP_MS;
}

const URL_REGEX = /(https?:\/\/[^\s]+)/ig;

function extractFirstUrl(content: string): string | null {
  const hit = content.match(URL_REGEX);
  return hit?.[0] ?? null;
}

function getFileExtension(fileName: string): string | null {
  const cleanName = fileName.split('?')[0] ?? fileName;
  const index = cleanName.lastIndexOf('.');
  if (index <= 0 || index === cleanName.length - 1) return null;
  return cleanName.slice(index + 1).toLowerCase();
}

function getMessageExtra(msg: ChatMessage): ChatMessageExtra | null {
  return msg.extra ?? null;
}

function getAssetMeta(msg: ChatMessage): ChatAssetMeta | null {
  return getMessageExtra(msg)?.asset ?? null;
}

function getMessageSummary(msg: ChatMessage): string {
  if (msg.isRecalled) return '消息已撤回';
  if (msg.type === 'image') {
    const asset = getAssetMeta(msg);
    return asset?.name ? `[图片] ${asset.name}` : '[图片]';
  }
  if (msg.type === 'file') {
    const asset = getAssetMeta(msg);
    return asset?.name ? `[文件] ${asset.name}` : '[文件]';
  }
  return msg.content;
}

async function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  const previewUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('load image failed'));
      image.src = previewUrl;
    });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
}

function renderTextWithLinks(content: string, isSelf: boolean) {
  const parts = content.split(URL_REGEX);
  return parts.map((part, idx) => {
    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={`${part}-${idx}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          style={{ color: isSelf ? 'rgba(255,255,255,0.92)' : 'var(--semi-color-link)', textDecoration: 'underline' }}
        >
          {part}
        </a>
      );
    }
    return <span key={`${part}-${idx}`}>{part}</span>;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderTextWithMentions(content: string, isSelf: boolean, mentions?: Array<{ nickname: string }> | null) {
  const labels = Array.from(new Set((mentions ?? []).map((item) => `@${item.nickname}`))).sort((a, b) => b.length - a.length);
  if (labels.length === 0) return renderTextWithLinks(content, isSelf);

  const mentionRegex = new RegExp(`(${labels.map(escapeRegExp).join('|')})`, 'g');
  const parts = content.split(URL_REGEX);

  return parts.map((part, idx) => {
    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={`${part}-${idx}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          style={{ color: isSelf ? 'rgba(255,255,255,0.92)' : 'var(--semi-color-link)', textDecoration: 'underline' }}
        >
          {part}
        </a>
      );
    }

    return part.split(mentionRegex).map((segment, segmentIdx) => {
      if (labels.includes(segment)) {
        return (
          <span
            key={`${segment}-${idx}-${segmentIdx}`}
            style={{
              color: isSelf ? '#fff' : 'var(--semi-color-primary)',
              fontWeight: 600,
              background: isSelf ? 'rgba(255,255,255,0.14)' : 'var(--semi-color-primary-light-default)',
              borderRadius: 4,
              padding: '0 2px',
            }}
          >
            {segment}
          </span>
        );
      }
      return <span key={`${segment}-${idx}-${segmentIdx}`}>{segment}</span>;
    });
  });
}

// ─── UserSearchList ──────────────────────────────────────────────────────────────────────────

function UserSearchList({ onSelect, excludeIds }: Readonly<{ onSelect: (user: ChatUser) => void; excludeIds?: number[] }>) {
  const [keyword, setKeyword] = useState('');
  const [ulist, setUlist] = useState<ChatUser[]>([]);
  const [loading, setLoading] = useState(false);
  const excludeIdKey = (excludeIds ?? []).join(',');

  const search = useCallback(async (kw: string) => {
    setLoading(true);
    const qs = kw ? `?keyword=${encodeURIComponent(kw)}` : '';
    const res = await request.get<ChatUser[]>(`/api/chat/users${qs}`, { silent: true });
    setLoading(false);
    const excludeIdSet = new Set(excludeIdKey ? excludeIdKey.split(',').map((id) => Number(id)) : []);
    if (res.code === 0 && res.data) setUlist(res.data.filter((u) => !excludeIdSet.has(u.id)));
  }, [excludeIdKey]);

  useEffect(() => { void search(''); }, [search]);
  useEffect(() => {
    const t = setTimeout(() => { void search(keyword); }, 300);
    return () => clearTimeout(t);
  }, [keyword, search]);

  return (
    <>
      <Input prefix={<Search size={14} />} placeholder="搜索用户名 / 昵称" value={keyword} onChange={setKeyword} size="small" />
      <Spin spinning={loading}>
        <div style={{ marginTop: 8, maxHeight: 240, overflowY: 'auto' }}>
          {ulist.length === 0 && !loading && (
            <Empty description="暂无用户" style={{ padding: '16px 0' }} imageStyle={{ width: 56 }} />
          )}
          {ulist.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => onSelect(u)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px',
                cursor: 'pointer', borderRadius: 6, border: 'none', background: 'transparent',
                width: '100%', textAlign: 'left',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--semi-color-fill-0)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <UserAvatar name={u.nickname} avatar={u.avatar} />
              <div>
                <Text strong style={{ fontSize: 13 }}>{u.nickname}</Text>
                <Text type="tertiary" style={{ fontSize: 12, display: 'block' }}>@{u.username}</Text>
              </div>
            </button>
          ))}
        </div>
      </Spin>
    </>
  );
}

// ─── NewChatPanel ─────────────────────────────────────────────────────────────

function NewChatPanel({
  onSelectUser, onGroupCreated, onClose,
}: Readonly<{
  onSelectUser: (user: ChatUser) => void;
  onGroupCreated: (conv: ChatConversation) => void;
  onClose: () => void;
}>) {
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreateGroup = async () => {
    if (!groupName.trim()) { Toast.warning('请输入群聊名称'); return; }
    setCreating(true);
    const res = await request.post<ChatConversation>('/api/chat/conversations/group', { name: groupName.trim() });
    setCreating(false);
    if (res.code === 0 && res.data) {
      onGroupCreated(res.data);
    } else {
      Toast.error(res.message ?? '创建失败');
    }
  };

  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 8 }}>
        <Title heading={6} style={{ margin: 0, flex: 1 }}>新建对话</Title>
        <Button size="small" type="tertiary" theme="borderless" onClick={onClose}>取消</Button>
      </div>
      <Tabs size="small" defaultActiveKey="direct">
        <TabPane tab="私聊" itemKey="direct">
          <div style={{ paddingTop: 8 }}>
            <UserSearchList onSelect={onSelectUser} />
          </div>
        </TabPane>
        <TabPane tab="创建群聊" itemKey="group">
          <div style={{ paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input
              placeholder="群聊名称（最多 64 字符）"
              value={groupName}
              onChange={setGroupName}
              maxLength={64}
              size="small"
            />
            <Button type="primary" size="small" loading={creating} onClick={() => { void handleCreateGroup(); }} block>
              创建群聊
            </Button>
          </div>
        </TabPane>
      </Tabs>
    </div>
  );
}

// ─── GroupMembersPanel ────────────────────────────────────────────────────────

function GroupMembersPanel({
  conversationId, currentUserId, conv, onConvUpdate,
}: Readonly<{
  conversationId: number;
  currentUserId: number | null;
  conv: ChatConversation;
  onConvUpdate: (patch: Partial<ChatConversation>) => void;
}>) {
  const [members, setMembers] = useState<ChatGroupMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  // 群信息编辑
  const [editName, setEditName] = useState('');
  const [editAnnouncement, setEditAnnouncement] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [showInfoEdit, setShowInfoEdit] = useState(false);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    const res = await request.get<ChatGroupMember[]>(`/api/chat/conversations/${conversationId}/members`, { silent: true });
    setLoading(false);
    if (res.code === 0 && res.data) setMembers(res.data);
  }, [conversationId]);

  useEffect(() => { void fetchMembers(); }, [fetchMembers]);

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
    setAdding(true);
    const res = await request.post(`/api/chat/conversations/${conversationId}/members`, { userId: user.id });
    setAdding(false);
    if (res.code === 0) {
      Toast.success(`已添加 ${user.nickname}`);
      setShowAdd(false);
      void fetchMembers();
    } else {
      Toast.error(res.message ?? '添加失败');
    }
  };

  const handleRemoveMember = (member: ChatGroupMember) => {
    Modal.confirm({
      title: `确定移除 ${member.nickname}？`,
      content: '移除后该成员将无法看到群聊消息。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete(`/api/chat/conversations/${conversationId}/members/${member.id}`);
        if ((res as { code: number }).code === 0) {
          Toast.success('已移除');
          void fetchMembers();
        } else {
          Toast.error((res as { message?: string }).message ?? '移除失败');
        }
      },
    });
  };

  const handleTransfer = (member: ChatGroupMember) => {
    Modal.confirm({
      title: `确定将群主转让给 ${member.nickname}？`,
      content: '转让后你将成为普通成员，无法撤销。',
      okButtonProps: { type: 'warning', theme: 'solid' },
      onOk: async () => {
        const res = await request.post(`/api/chat/conversations/${conversationId}/transfer`, { newOwnerId: member.id });
        if ((res as { code: number }).code === 0) {
          Toast.success('群主已转让');
          void fetchMembers();
        } else {
          Toast.error((res as { message?: string }).message ?? '转让失败');
        }
      },
    });
  };

  const handleSaveInfo = async () => {
    setSavingInfo(true);
    const body: { name?: string; announcement?: string | null } = {};
    if (editName.trim() !== (conv.name ?? '')) body.name = editName.trim();
    if (editAnnouncement !== (conv.announcement ?? '')) body.announcement = editAnnouncement || null;
    if (Object.keys(body).length === 0) { setSavingInfo(false); setShowInfoEdit(false); return; }
    const res = await request.patch(`/api/chat/conversations/${conversationId}/group-info`, body);
    setSavingInfo(false);
    if ((res as { code: number }).code === 0) {
      Toast.success('已更新');
      setShowInfoEdit(false);
      onConvUpdate({ name: body.name ?? conv.name, announcement: body.announcement !== undefined ? body.announcement : conv.announcement });
    } else {
      Toast.error((res as { message?: string }).message ?? '更新失败');
    }
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
            <Button size="small" theme="solid" loading={savingInfo} onClick={() => { void handleSaveInfo(); }}>保存</Button>
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
              loading={adding}
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
        <Spin spinning={loading}>
          {sortedMembers.map((m) => {
            const isSelf = m.id === currentUserId;
            return (
              <div
                key={m.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--semi-color-border)' }}
              >
                <UserAvatar name={m.nickname} avatar={m.avatar} size={28} />
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
                {isOwner && !isSelf && (
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
              </div>
            );
          })}
        </Spin>
      </div>
    </div>
  );
}

// ─── ForwardModal ─────────────────────────────────────────────────────────────

function ForwardModal({
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

// ─── ForwardedMessagesModal ──────────────────────────────────────────────────

function ForwardedMessagesModal({
  visible, items, title, onCancel,
}: Readonly<{
  visible: boolean;
  items: NonNullable<ChatMessageExtra['forwardedMessages']>;
  title: string;
  onCancel: () => void;
}>) {
  return (
    <Modal
      title={title}
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={560}
    >
      <div style={{ maxHeight: 520, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.length === 0 && <Text type="tertiary" style={{ textAlign: 'center', display: 'block', padding: '20px 0' }}>暂无消息</Text>}
        {items.map((item, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '8px 10px',
              background: 'var(--semi-color-fill-0)',
              borderRadius: 8,
              border: '1px solid var(--semi-color-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text strong style={{ fontSize: 12 }}>{item.senderName ?? '未知'}</Text>
              {item.createdAt && (
                <Text type="tertiary" style={{ fontSize: 11 }}>{item.createdAt}</Text>
              )}
            </div>
            {item.type === 'image' ? (
              <a
                href={item.content}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-block' }}
              >
                <img
                  src={item.asset?.thumbnailUrl ?? item.content}
                  alt={item.asset?.name ?? '图片'}
                  style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 6, display: 'block', cursor: 'zoom-in' }}
                />
              </a>
            ) : item.type === 'file' ? (
              <a
                href={item.content}
                download={item.asset?.name ?? '文件'}
                style={{ color: 'var(--semi-color-primary)', fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {getFileTypeIcon(item.asset?.mimeType, 16)}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 380 }}>
                  {item.asset?.name ?? '文件'}
                </span>
              </a>
            ) : (
              <Text style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.content}</Text>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ─── MessageContent ───────────────────────────────────────────────────────────

function MessageContent({
  msg, isSelf, onOpenImage, onOpenForwardView,
}: Readonly<{
  msg: ChatMessage;
  isSelf: boolean;
  onOpenImage?: (msg: ChatMessage) => void;
  onOpenForwardView?: (items: NonNullable<ChatMessageExtra['forwardedMessages']>, title: string) => void;
}>) {
  const extra = getMessageExtra(msg);
  const asset = extra?.asset ?? null;
  const linkPreview = extra?.linkPreview ?? null;
  const bubbleStyle: React.CSSProperties = {
    background: isSelf ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-1)',
    color: isSelf ? '#fff' : 'inherit',
    padding: '8px 12px',
    borderRadius: isSelf ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
    fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word',
  };

  if (msg.type === 'forward') {
    const items = extra?.forwardedMessages ?? [];
    const sourceConvName = extra?.forwardSourceConvName;
    const title = `聊天记录${sourceConvName ? ` · ${sourceConvName}` : ''}`;
    return (
      <button
        type="button"
        onClick={() => onOpenForwardView?.(items, title)}
        style={{
          ...bubbleStyle,
          padding: 0,
          overflow: 'hidden',
          minWidth: 220,
          maxWidth: 340,
          border: isSelf ? '1px solid rgba(255,255,255,0.25)' : '1px solid var(--semi-color-border)',
          cursor: 'pointer',
          textAlign: 'left',
          display: 'block',
          width: '100%',
        }}
      >
        <div style={{ padding: '8px 12px', borderBottom: isSelf ? '1px solid rgba(255,255,255,0.18)' : '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text strong style={{ fontSize: 12, color: isSelf ? '#fff' : 'var(--semi-color-text-0)' }}>
            {title}
          </Text>
          <Text style={{ fontSize: 11, color: isSelf ? 'rgba(255,255,255,0.65)' : 'var(--semi-color-text-3)' }}>点击查看</Text>
        </div>
        <div style={{ padding: '6px 12px 8px' }}>
          {items.slice(0, 4).map((item, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'flex-start' }}>
              <Text style={{ fontSize: 11, color: isSelf ? 'rgba(255,255,255,0.75)' : 'var(--semi-color-text-3)', flexShrink: 0, lineHeight: 1.6 }}>
                {item.senderName ?? '未知'}：
              </Text>
              <Text style={{ fontSize: 12, color: isSelf ? 'rgba(255,255,255,0.9)' : 'var(--semi-color-text-1)', lineHeight: 1.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {item.type === 'image' ? '[图片，点击查看]' : item.type === 'file' ? `[文件] ${item.asset?.name ?? ''}` : item.content}
              </Text>
            </div>
          ))}
          {items.length > 4 && (
            <Text type="tertiary" style={{ fontSize: 11 }}>…共 {items.length} 条消息</Text>
          )}
        </div>
      </button>
    );
  }

  if (msg.type === 'image') {
    return (
      <button
        type="button"
        onClick={() => onOpenImage?.(msg)}
        style={{ background: 'transparent', padding: 0, border: 'none', borderRadius: 0, cursor: 'zoom-in' }}
      >
        <img
          src={asset?.thumbnailUrl ?? msg.content}
          alt={asset?.name ?? '图片'}
          style={{ maxWidth: 240, maxHeight: 200, borderRadius: 0, display: 'block', cursor: 'zoom-in', border: 'none', boxShadow: 'none' }}
        />
      </button>
    );
  }

  if (msg.type === 'file') {
    return (
      <div
        style={{
          ...bubbleStyle,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minWidth: 220,
          maxWidth: 340,
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: isSelf ? 'rgba(255,255,255,0.2)' : 'var(--semi-color-fill-0)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {getFileTypeIcon(asset?.mimeType, 16)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
        <a
          href={msg.content}
          download={asset?.name ?? '文件'}
          style={{
            display: 'block',
            color: isSelf ? '#fff' : 'var(--semi-color-primary)',
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {asset?.name ?? '文件'}
        </a>
        {asset?.size !== undefined && (
          <Text
            style={{
              fontSize: 11,
              color: isSelf ? 'rgba(255,255,255,0.78)' : 'var(--semi-color-text-2)',
            }}
          >
            {formatFileSize(asset.size)}
          </Text>
        )}
        </div>
      </div>
    );
  }

  return (
    <div style={bubbleStyle}>
      <div style={{ whiteSpace: 'pre-wrap' }}>{renderTextWithMentions(msg.content, isSelf, msg.extra?.mentions)}</div>
      {linkPreview && (
        <a
          href={linkPreview.url}
          target="_blank"
          rel="noreferrer"
          style={{
            marginTop: 8,
            display: 'flex',
            gap: 10,
            borderRadius: 8,
            border: isSelf ? '1px solid rgba(255,255,255,0.35)' : '1px solid var(--semi-color-border)',
            background: isSelf ? 'rgba(255,255,255,0.12)' : 'var(--semi-color-bg-1)',
            color: isSelf ? '#fff' : 'inherit',
            textDecoration: 'none',
            overflow: 'hidden',
            minWidth: 220,
            maxWidth: 340,
          }}
        >
          {linkPreview.image && (
            <img
              src={linkPreview.image}
              alt={linkPreview.title}
              style={{ width: 88, objectFit: 'cover', flexShrink: 0, borderRadius: 0 }}
            />
          )}
          <div style={{ padding: '8px 10px', minWidth: 0, flex: 1 }}>
            <Text
              strong
              style={{
                display: 'block',
                color: isSelf ? '#fff' : 'var(--semi-color-text-0)',
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {linkPreview.title}
            </Text>
            {linkPreview.description && (
              <Text
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  marginTop: 2,
                  color: isSelf ? 'rgba(255,255,255,0.88)' : 'var(--semi-color-text-2)',
                  fontSize: 12,
                }}
              >
                {linkPreview.description}
              </Text>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              {linkPreview.favicon && (
                <img src={linkPreview.favicon} alt="favicon" style={{ width: 14, height: 14, borderRadius: 3 }} />
              )}
              <Text
                type="tertiary"
                style={{
                  fontSize: 11,
                  color: isSelf ? 'rgba(255,255,255,0.72)' : 'var(--semi-color-text-3)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {linkPreview.siteName ?? linkPreview.url}
              </Text>
            </div>
          </div>
        </a>
      )}
    </div>
  );
}

function ImageGalleryLightbox({
  images, activeImageId, onClose, onPrev, onNext,
}: Readonly<{
  images: ChatMessage[];
  activeImageId: number | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}>) {
  const activeIndex = images.findIndex((item) => item.id === activeImageId);
  const current = activeIndex >= 0 ? images[activeIndex] : null;

  useEffect(() => {
    if (!current) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && activeIndex > 0) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight' && activeIndex < images.length - 1) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, current, images.length, onClose, onNext, onPrev]);

  if (!current) return null;

  const asset = getAssetMeta(current);
  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex < images.length - 1;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2200,
        background: 'rgba(0, 0, 0, 0.9)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'rgba(0,0,0,0.45)',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: 'rgba(255,255,255,0.96)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {asset?.name ?? '图片预览'}
            {asset?.width && asset.height ? ` (${asset.width}×${asset.height})` : ''}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 2 }}>
            {activeIndex + 1} / {images.length}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <a
            href={current.content}
            download={asset?.name ?? '图片'}
            onClick={(e) => e.stopPropagation()}
            title="下载"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 6,
              background: 'rgba(255,255,255,0.15)', color: '#fff', textDecoration: 'none',
            }}
          >
            <Download size={15} />
          </a>
          <button
            type="button"
            title="关闭 (Esc)"
            onClick={onClose}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 6,
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', cursor: 'pointer',
            }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {hasPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          title="上一张 (←)"
          style={{
            position: 'absolute',
            left: 20,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255,255,255,0.16)',
            color: '#fff',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronLeft size={22} />
        </button>
      )}

      {hasNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          title="下一张 (→)"
          style={{
            position: 'absolute',
            right: 20,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255,255,255,0.16)',
            color: '#fff',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronRight size={22} />
        </button>
      )}

      <img
        src={current.content}
        alt={asset?.name ?? '预览图片'}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '92vw',
          maxHeight: 'calc(88vh - 52px)',
          display: 'block',
          border: 'none',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          borderRadius: 4,
        }}
      />
    </div>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg, isSelf, onReply, onRecall, onOpenImage, shouldShowTime, getReplyMessage, onScrollToMessage, onToggleFavorite, onTogglePin, onEditRecalled, recalledDraft, multiSelectMode, isSelected, onToggleSelect, onForwardSingle, onOpenForwardView,
}: Readonly<{
  msg: ChatMessage;
  isSelf: boolean;
  onReply: (msg: ChatMessage) => void;
  onRecall: (msg: ChatMessage) => void;
  onOpenImage: (msg: ChatMessage) => void;
  shouldShowTime: boolean;
  getReplyMessage: (id: number) => ChatMessage | undefined;
  onScrollToMessage: (id: number) => void;
  onToggleFavorite: (msg: ChatMessage) => void;
  onTogglePin: (msg: ChatMessage) => void;
  onEditRecalled: (messageId: number) => void;
  recalledDraft?: { content: string; mentions?: Array<{ userId: number; nickname: string }> };
  multiSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (msg: ChatMessage) => void;
  onForwardSingle?: (msg: ChatMessage) => void;
  onOpenForwardView?: (items: NonNullable<ChatMessageExtra['forwardedMessages']>, title: string) => void;
}>) {
  const fullTimeStr = formatDateTime(msg.createdAt);
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const showBottomTime = shouldShowTime || isHovered;

  // 是否在 2 分钟内可撤回
  const TWO_MINUTES_MS = 2 * 60 * 1000;
  const [canRecall, setCanRecall] = useState(() => {
    const elapsed = Date.now() - new Date(msg.createdAt.replace(' ', 'T')).getTime();
    return elapsed < TWO_MINUTES_MS;
  });
  useEffect(() => {
    if (!isSelf || msg.isRecalled) return;
    const elapsed = Date.now() - new Date(msg.createdAt.replace(' ', 'T')).getTime();
    const remaining = TWO_MINUTES_MS - elapsed;
    if (remaining <= 0) { setCanRecall(false); return; }
    const timer = setTimeout(() => setCanRecall(false), remaining);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.id, msg.createdAt, isSelf, msg.isRecalled]);

  const handleCopyText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      Toast.success('文本已复制');
    } catch {
      Toast.error('复制失败');
    }
  }, [msg.content]);

  const handleCopyImage = useCallback(async () => {
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        await navigator.clipboard.writeText(msg.content);
        Toast.success('当前环境不支持写入图片，已复制图片链接');
        return;
      }
      // 浏览器剪贴板仅支持 image/png，统一通过 canvas 转换
      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('canvas unavailable')); return; }
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((b) => {
            if (b) resolve(b); else reject(new Error('toBlob failed'));
          }, 'image/png');
        };
        img.onerror = () => reject(new Error('image load failed'));
        img.src = msg.content;
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      Toast.success('图片已复制');
    } catch {
      Toast.error('复制图片失败');
    }
  }, [msg.content]);

  if (msg.type === 'system') {
    return (
      <div
        id={`msg-${msg.id}`}
        style={{ textAlign: 'center', padding: '0 0 4px' }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            lineHeight: 1.5,
            padding: '2px 10px',
            borderRadius: 999,
            background: 'var(--semi-color-fill-0)',
            cursor: 'default',
          }}
        >
          <Text type="tertiary" style={{ fontSize: 12 }}>{msg.content}</Text>
        </span>
        <Text
          type="quaternary"
          style={{
            display: 'block',
            textAlign: 'center',
            marginTop: 1,
            fontSize: 10,
            lineHeight: 1,
            opacity: showBottomTime ? 1 : 0,
            transform: `translateY(${showBottomTime ? '0' : '-2px'})`,
            transition: 'opacity 120ms ease, transform 120ms ease',
            pointerEvents: 'none',
          }}
        >
          {fullTimeStr}
        </Text>
      </div>
    );
  }

  if (msg.isRecalled) {
    return (
      <div style={{ textAlign: 'center', padding: '4px 0' }}>
        <Tooltip content={fullTimeStr} position="top">
          <Text type="tertiary" style={{ fontSize: 12, cursor: 'default' }}>
            {isSelf ? '你' : (msg.senderName ?? '对方')}撤回了一条消息
          </Text>
        </Tooltip>
        {isSelf && recalledDraft && (
          <Button
            size="small"
            theme="borderless"
            type="primary"
            style={{ marginLeft: 4, height: 'auto', padding: '0 2px' }}
            onClick={() => onEditRecalled(msg.id)}
          >
            重新编辑
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      id={`msg-${msg.id}`}
      style={{
        display: 'flex', flexDirection: isSelf ? 'row-reverse' : 'row', gap: 8, marginBottom: 16, alignItems: 'flex-end',
        background: isSelected ? 'var(--semi-color-primary-light-default)' : 'transparent',
        borderRadius: 8,
        padding: multiSelectMode ? '2px 4px' : '0',
        transition: 'background 0.15s ease',
        cursor: multiSelectMode ? 'pointer' : 'default',
      }}
      onClick={multiSelectMode ? () => onToggleSelect?.(msg) : undefined}
    >
      {multiSelectMode && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, paddingBottom: 4, color: isSelected ? 'var(--semi-color-primary)' : 'var(--semi-color-text-3)' }}>
          {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
        </div>
      )}
      {!isSelf && <UserAvatar name={msg.senderName ?? '?'} avatar={msg.senderAvatar} size={32} />}
      <div
        style={{ maxWidth: '65%', position: 'relative' }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenuPos({ x: e.clientX, y: e.clientY });
        }}
      >
        {!isSelf && (
          <Text type="tertiary" style={{ fontSize: 11, display: 'block', marginBottom: 2, marginLeft: 4 }}>
            {msg.senderName}
          </Text>
        )}
        {msg.replyToId && (() => {
          const replied = getReplyMessage(msg.replyToId);
          let replyText = '\u539f\u6d88\u606f\u5df2\u4e0d\u5728'; // 原消息已不在
          let replySender = '';
          if (replied) {
            replySender = replied.senderName ?? '';
            if (replied.isRecalled) replyText = '\u6d88\u606f\u5df2\u64a4\u56de'; // 消息已撤回
            else if (replied.type === 'image') replyText = '[\u56fe\u7247]';
            else if (replied.type === 'file') replyText = `[\u6587\u4ef6] ${getAssetMeta(replied)?.name ?? ''}`;
            else replyText = replied.content.length > 40 ? `${replied.content.slice(0, 40)}\u2026` : replied.content;
          }
          return (
            <button
              type="button"
              onClick={() => { if (msg.replyToId) onScrollToMessage(msg.replyToId); }}
              style={{
                background: 'var(--semi-color-fill-1)', borderLeft: '3px solid var(--semi-color-primary)',
                padding: '4px 8px', borderRadius: 4, marginBottom: 4, fontSize: 12,
                color: 'var(--semi-color-text-2)', border: 'none',
                cursor: replied ? 'pointer' : 'default',
                textAlign: 'left', display: 'block', width: '100%', maxWidth: '100%',
              }}
            >
              {replySender && <span style={{ fontWeight: 600, marginRight: 4, color: 'var(--semi-color-primary)' }}>{replySender}</span>}
              <span>{replyText}</span>
            </button>
          );
        })()}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: isSelf ? 'flex-end' : 'flex-start', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, flexDirection: isSelf ? 'row-reverse' : 'row' }}>
            <div style={{ display: 'flex', cursor: 'default' }}>
              <MessageContent msg={msg} isSelf={isSelf} onOpenImage={onOpenImage} onOpenForwardView={onOpenForwardView} />
            </div>
            <div style={{ display: 'flex', gap: 2, flexShrink: 0, paddingBottom: 2 }}>
              {isSelf && canRecall && !msg.isRecalled && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <Tooltip content="撤回（2分钟内有效）" position="top">
                    <div style={{ display: 'flex' }}>
                      <Button
                        size="small" theme="borderless" type="tertiary"
                        icon={<RotateCcw size={12} />}
                        onClick={() => onRecall(msg)}
                        style={{ padding: '2px 4px', height: 'auto', minWidth: 'auto' }}
                      />
                    </div>
                  </Tooltip>
                </div>
              )}
            </div>
          </div>
        </div>
        <Text
          type="tertiary"
          style={{
            position: 'absolute',
            bottom: -14,
            [isSelf ? 'right' : 'left']: 4,
            fontSize: 10,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            cursor: 'default',
            opacity: showBottomTime ? 1 : 0,
            transform: `translateY(${showBottomTime ? '0' : '-2px'})`,
            transition: 'opacity 120ms ease, transform 120ms ease',
            pointerEvents: 'none',
            background: 'var(--semi-color-bg-0)',
            padding: '0 2px',
          }}
        >
          {fullTimeStr}
        </Text>
        {contextMenuPos && (
          <Dropdown
            trigger="click"
            visible
            clickToHide
            position="bottomLeft"
            onVisibleChange={(visible) => {
              if (!visible) setContextMenuPos(null);
            }}
            render={(
              <Dropdown.Menu>
                <Dropdown.Item
                  icon={<CornerDownLeft size={12} />}
                  onClick={() => {
                    onReply(msg);
                    setContextMenuPos(null);
                  }}
                >
                  回复
                </Dropdown.Item>
                {isSelf && canRecall && !msg.isRecalled && (
                  <Dropdown.Item
                    icon={<RotateCcw size={12} />}
                    onClick={() => {
                      onRecall(msg);
                      setContextMenuPos(null);
                    }}
                  >
                    撤回
                  </Dropdown.Item>
                )}
                {msg.type === 'text' && (
                  <Dropdown.Item
                    icon={<Copy size={12} />}
                    onClick={() => {
                      void handleCopyText();
                      setContextMenuPos(null);
                    }}
                  >
                    复制
                  </Dropdown.Item>
                )}
                {msg.type === 'image' && (
                  <Dropdown.Item
                    icon={<Copy size={12} />}
                    onClick={() => {
                      void handleCopyImage();
                      setContextMenuPos(null);
                    }}
                  >
                    复制
                  </Dropdown.Item>
                )}
                <Dropdown.Item
                  icon={<Bookmark size={12} />}
                  onClick={() => {
                    onToggleFavorite(msg);
                    setContextMenuPos(null);
                  }}
                >
                  {msg.extra?.isFavorited ? '取消收藏' : '收藏'}
                </Dropdown.Item>
                <Dropdown.Item
                  icon={<Pin size={12} />}
                  onClick={() => {
                    onTogglePin(msg);
                    setContextMenuPos(null);
                  }}
                >
                  {msg.extra?.isPinned ? '取消置顶消息' : '置顶消息'}
                </Dropdown.Item>
                {!msg.isRecalled && (
                  <Dropdown.Item
                    icon={<Forward size={12} />}
                    onClick={() => {
                      onForwardSingle?.(msg);
                      setContextMenuPos(null);
                    }}
                  >
                    转发
                  </Dropdown.Item>
                )}
                {!msg.isRecalled && (
                  <Dropdown.Item
                    icon={<CheckSquare size={12} />}
                    onClick={() => {
                      onToggleSelect?.(msg);
                      setContextMenuPos(null);
                    }}
                  >
                    多选
                  </Dropdown.Item>
                )}
              </Dropdown.Menu>
            )}
          >
            <span
              style={{
                position: 'fixed',
                left: contextMenuPos.x,
                top: contextMenuPos.y,
                width: 1,
                height: 1,
              }}
            />
          </Dropdown>
        )}
      </div>
    </div>
  );
}

// ─── ChatPage ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [emojiVisible, setEmojiVisible] = useState(false);
  const [convSearch, setConvSearch] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [pendingNewMsgCount, setPendingNewMsgCount] = useState(0);
  const [msgSearch, setMsgSearch] = useState('');
  const [searchTypeFilters, setSearchTypeFilters] = useState<ChatMessage['type'][]>([]);
  const [searchSenderId, setSearchSenderId] = useState<number | undefined>();
  const [searchTimeRange, setSearchTimeRange] = useState<[Date, Date] | null>(null);
  const [searchDatePreset, setSearchDatePreset] = useState<SearchDatePreset>('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<ChatMessageSearchItem[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasSearched, setSearchHasSearched] = useState(false);
  const [searchMembers, setSearchMembers] = useState<ChatGroupMember[]>([]);
  const [groupAvatarMap, setGroupAvatarMap] = useState<Record<number, Array<{ id: number; nickname: string; avatar?: string | null }>>>({});
  const [activeGroupMembers, setActiveGroupMembers] = useState<ChatGroupMember[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<Array<{ userId: number; nickname: string }>>([]);
  const [leftPaneMode, setLeftPaneMode] = useState<'conversations' | 'favorites'>('conversations');
  const [favoriteMessages, setFavoriteMessages] = useState<ChatMessage[]>([]);
  const [leftPaneContextMenu, setLeftPaneContextMenu] = useState<
    | { x: number; y: number; type: 'conversation'; conv: ChatConversation }
    | { x: number; y: number; type: 'favorite'; msg: ChatMessage }
    | null
  >(null);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [announcementHistoryVisible, setAnnouncementHistoryVisible] = useState(false);
  const [announcementHistory, setAnnouncementHistory] = useState<ChatMessage[]>([]);
  const [recalledDrafts, setRecalledDrafts] = useState<Record<number, { content: string; mentions?: Array<{ userId: number; nickname: string }> }>>({});
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<number[]>([]);
  const [forwardModalVisible, setForwardModalVisible] = useState(false);
  const [forwardingMessageIds, setForwardingMessageIds] = useState<number[]>([]);
  const [forwardingMode, setForwardingMode] = useState<'merge' | 'individual'>('individual');
  const [forwardViewVisible, setForwardViewVisible] = useState(false);
  const [forwardViewItems, setForwardViewItems] = useState<NonNullable<ChatMessageExtra['forwardedMessages']>>([]);
  const [forwardViewTitle, setForwardViewTitle] = useState('');
  const [contextMode, setContextMode] = useState<{ anchorMessageId: number; keyword: string } | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<number, { nickname: string; timer: ReturnType<typeof setTimeout> }>>({});
  const typingThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [previewImageId, setPreviewImageId] = useState<number | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileAttachRef = useRef<HTMLInputElement>(null);
  const emojiContainerRef = useRef<HTMLDivElement>(null);
  const pendingImagesRef = useRef<PendingImage[]>([]);

  // 点击 emoji 选择器外部时关闭
  useEffect(() => {
    if (!emojiVisible) return;
    const handler = (e: MouseEvent) => {
      if (emojiContainerRef.current && !emojiContainerRef.current.contains(e.target as Node)) {
        setEmojiVisible(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [emojiVisible]);

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(() => () => {
    pendingImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserNickname, setCurrentUserNickname] = useState('我');
  useEffect(() => {
    try {
      const token = localStorage.getItem('zenith_token');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1])) as { userId?: number; nickname?: string };
        setCurrentUserId(payload.userId ?? null);
        setCurrentUserNickname(payload.nickname ?? '我');
      }
    } catch { /* ignore */ }
  }, []);

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;
  const mentionState = useMemo(() => {
    if (!activeConv || activeConv.type !== 'group') return null;
    const cursor = inputRef.current?.selectionStart ?? input.length;
    const prefix = input.slice(0, cursor);
    const atIndex = prefix.lastIndexOf('@');
    if (atIndex < 0) return null;
    if (atIndex > 0 && !/[\s\n]/.test(prefix[atIndex - 1] ?? '')) return null;
    const query = prefix.slice(atIndex + 1);
    if (query.includes(' ') || query.includes('\n')) return null;
    return { start: atIndex, end: cursor, query };
  }, [activeConv, input]);

  const mentionCandidates = useMemo(() => {
    if (!mentionState) return [];
    const kw = mentionState.query.trim().toLowerCase();
    return activeGroupMembers.filter((member) => {
      if (member.id === currentUserId) return false;
      if (!kw) return true;
      return member.nickname.toLowerCase().includes(kw) || member.username.toLowerCase().includes(kw);
    }).slice(0, 8);
  }, [activeGroupMembers, currentUserId, mentionState]);

  const isNearBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const fetchConversations = useCallback(async () => {
    setLoadingConvs(true);
    const res = await request.get<ChatConversation[]>('/api/chat/conversations', { silent: true });
    setLoadingConvs(false);
    if (res.code === 0 && res.data) setConversations(res.data);
  }, []);

  useEffect(() => { void fetchConversations(); }, [fetchConversations]);

  const fetchPinnedMessages = useCallback(async (convId: number) => {
    const res = await request.get<ChatMessage[]>(`/api/chat/conversations/${convId}/pinned-messages`, { silent: true });
    if (res.code === 0 && res.data) setPinnedMessages(res.data);
  }, []);

  const fetchFavoriteMessages = useCallback(async () => {
    const res = await request.get<{ list: ChatMessage[] }>(`/api/chat/favorite-messages?page=1&pageSize=100`, { silent: true });
    if (res.code === 0 && res.data) setFavoriteMessages(res.data.list);
  }, []);

  const fetchAnnouncementHistory = useCallback(async (convId: number) => {
    const res = await request.get<ChatMessage[]>(`/api/chat/conversations/${convId}/announcement-history`, { silent: true });
    if (res.code === 0 && res.data) setAnnouncementHistory(res.data);
  }, []);

  const openFavoriteMessage = useCallback(async (message: ChatMessage) => {
    const res = await request.get<ChatMessageContext>(
      `/api/chat/conversations/${message.conversationId}/messages/${message.id}/context?before=15&after=15`,
      { silent: true },
    );
    if (res.code !== 0 || !res.data) {
      Toast.error(res.message ?? '定位收藏消息失败');
      return;
    }
    setLeftPaneMode('conversations');
    setActiveConvId(message.conversationId);
    setMessages(res.data.list);
    setHasMore(res.data.hasBefore);
    setPage(1);
    setContextMode({ anchorMessageId: res.data.anchorMessageId, keyword: '收藏消息' });
    setTimeout(() => {
      const el = document.getElementById(`msg-${res.data!.anchorMessageId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background 0.3s ease';
      el.style.background = 'var(--semi-color-primary-light-hover)';
      setTimeout(() => { el.style.background = ''; }, 1200);
    }, 80);
  }, []);

  useEffect(() => {
    if (!activeConvId) {
      setActiveGroupMembers([]);
      setPinnedMessages([]);
      return;
    }
    void fetchPinnedMessages(activeConvId);
    if (activeConv?.type === 'group') {
      void request.get<ChatGroupMember[]>(`/api/chat/conversations/${activeConvId}/members`, { silent: true }).then((res) => {
        if (res.code === 0 && res.data) setActiveGroupMembers(res.data);
      });
    } else {
      setActiveGroupMembers([]);
    }
  }, [activeConv?.type, activeConvId, fetchPinnedMessages]);

  useEffect(() => {
    if (leftPaneMode === 'favorites') {
      void fetchFavoriteMessages();
    }
  }, [fetchFavoriteMessages, leftPaneMode]);

  const fetchMessages = useCallback(async (convId: number, p = 1) => {
    const el = messagesContainerRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    const prevScrollTop = el?.scrollTop ?? 0;
    setLoadingMsgs(true);
    const res = await request.get<{ list: ChatMessage[]; total: number; page: number; pageSize: number }>(
      `/api/chat/conversations/${convId}/messages?page=${p}&pageSize=30`,
      { silent: true },
    );
    setLoadingMsgs(false);
    if (res.code === 0 && res.data) {
      const newMsgs = [...res.data.list].reverse();
      if (p === 1) {
        setMessages(newMsgs);
        setPage(1);
        setPendingNewMsgCount(0);
        setContextMode(null);
      } else {
        setMessages((prev) => [...newMsgs, ...prev]);
        setPage(p);
        requestAnimationFrame(() => {
          const box = messagesContainerRef.current;
          if (!box) return;
          const delta = box.scrollHeight - prevScrollHeight;
          box.scrollTop = prevScrollTop + delta;
        });
      }
      setHasMore(res.data.list.length >= 30);
    }
  }, []);

  const handleSelectConv = useCallback(async (conv: ChatConversation) => {
    setActiveConvId(conv.id);
    setReplyTo(null);
    setSelectedMentions([]);
    setLeftPaneMode('conversations');
    setAnnouncementHistoryVisible(false);
    setShowMembers(false);
    setShowSearchPanel(false);
    setMsgSearch('');
    setSearchTypeFilters([]);
    setSearchSenderId(undefined);
    setSearchTimeRange(null);
    setSearchDatePreset('');
    setSearchResults([]);
    setSearchTotal(0);
    setSearchPage(1);
    setSearchHasSearched(false);
    setContextMode(null);
    await fetchMessages(conv.id, 1);
    await request.post(`/api/chat/conversations/${conv.id}/read`, {}, { silent: true });
    setConversations((prev) => prev.map((c) => c.id === conv.id ? { ...c, unreadCount: 0 } : c));
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [fetchMessages]);

  const handleNewDirectChat = useCallback(async (user: ChatUser) => {
    setShowNewChat(false);
    const res = await request.post<ChatConversation>('/api/chat/conversations/direct', { targetUserId: user.id });
    if (res.code === 0 && res.data) {
      await fetchConversations();
      await handleSelectConv(res.data);
    }
  }, [fetchConversations, handleSelectConv]);

  const handleGroupCreated = useCallback(async (conv: ChatConversation) => {
    setShowNewChat(false);
    await fetchConversations();
    await handleSelectConv(conv);
  }, [fetchConversations, handleSelectConv]);

  const sendFileMessage = useCallback(async (file: File) => {
    if (!activeConvId) return false;
    const fd = new FormData();
    fd.append('file', file);
    const uploadRes = await request.postForm<{ url: string; originalName: string; size: number }>('/api/files/upload-one', fd);
    if (uploadRes.code !== 0 || !uploadRes.data) return false;
    const { url, originalName, size } = uploadRes.data;
    const asset: ChatAssetMeta = {
      kind: 'file',
      name: originalName,
      size,
      mimeType: file.type || null,
      extension: getFileExtension(originalName),
    };
    const msgRes = await request.post<ChatMessage>(`/api/chat/conversations/${activeConvId}/messages`, {
      content: url,
      type: 'file',
      extra: { asset },
    });
    return msgRes.code === 0;
  }, [activeConvId]);

  const handleTyping = useCallback(() => {
    if (!activeConvId || !currentUserId) return;
    if (typingThrottleRef.current) return; // 3秒内只发一次
    let nickname = '用户';
    try {
      const token = localStorage.getItem('zenith_token');
      if (token) {
        const p = JSON.parse(atob(token.split('.')[1])) as { nickname?: string };
        nickname = p.nickname ?? '用户';
      }
    } catch { /* ignore */ }
    sendWsMessage({ type: 'chat:typing', payload: { conversationId: activeConvId, userId: currentUserId, nickname } });
    typingThrottleRef.current = setTimeout(() => { typingThrottleRef.current = null; }, 3000);
  }, [activeConvId, currentUserId]);

  const sendImageFile = useCallback(async (file: File) => {
    if (!activeConvId) return false;
    const dimensions = await getImageDimensions(file);
    const fd = new FormData();
    fd.append('file', file);
    const uploadRes = await request.postForm<{ url: string; originalName: string; size: number }>(
      '/api/files/upload-one', fd,
    );
    if (uploadRes.code !== 0 || !uploadRes.data) {
      return false;
    }
    const { url, originalName, size } = uploadRes.data;
    const asset: ChatAssetMeta = {
      kind: 'image',
      name: originalName,
      size,
      mimeType: file.type || null,
      extension: getFileExtension(originalName),
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      thumbnailUrl: url,
    };
    const msgRes = await request.post<ChatMessage>(`/api/chat/conversations/${activeConvId}/messages`, {
      content: url,
      type: 'image',
      extra: { asset },
    });
    return msgRes.code === 0;
  }, [activeConvId]);

  const fetchLinkPreview = useCallback(async (url: string): Promise<ChatLinkPreview | null> => {
    const res = await request.get<ChatLinkPreview>(`/api/chat/link-preview?url=${encodeURIComponent(url)}`, { silent: true });
    if (res.code === 0 && res.data) return res.data;
    return null;
  }, []);

  const handleSend = useCallback(async () => {
    if (!activeConvId || sending || (!input.trim() && pendingImages.length === 0)) return;

    const content = input.trim();
    const imagesToSend = [...pendingImages];

    setInput('');
    setPendingImages([]);
    imagesToSend.forEach((item) => URL.revokeObjectURL(item.previewUrl));

    setSending(true);
    if (imagesToSend.length > 0) setUploading(true);

    let failedImageCount = 0;

    if (content) {
      const body: Record<string, unknown> = { content, type: 'text' };
      if (replyTo) body.replyToId = replyTo.id;
      const mentions = selectedMentions.filter((item) => content.includes(`@${item.nickname}`));
      const extra: Record<string, unknown> = mentions.length > 0 ? { mentions } : {};
      const firstUrl = extractFirstUrl(content);
      if (firstUrl) {
        const preview = await fetchLinkPreview(firstUrl);
        if (preview) extra.linkPreview = preview;
      }
      if (Object.keys(extra).length > 0) body.extra = extra;
      const res = await request.post<ChatMessage>(`/api/chat/conversations/${activeConvId}/messages`, body);
      if (res.code !== 0) {
        setInput(content);
        Toast.error('文本发送失败');
      }
    }

    if (imagesToSend.length > 0) {
      for (const item of imagesToSend) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await sendImageFile(item.file);
        if (!ok) failedImageCount += 1;
      }
    }

    setReplyTo(null);
  setSelectedMentions([]);
    setUploading(false);
    setSending(false);

    if (failedImageCount > 0) {
      Toast.error(`有 ${failedImageCount} 张图片发送失败`);
    }
  }, [activeConvId, fetchLinkPreview, input, pendingImages, replyTo, selectedMentions, sendImageFile, sending]);

  const handleSelectImages = useCallback((files: File[]) => {
    const validFiles = files.filter((file) => file.type.startsWith('image/'));
    if (validFiles.length === 0) return;

    const added = validFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setPendingImages((prev) => [...prev, ...added]);
  }, []);

  const handleSelectFile = useCallback((files: File[]) => {
    const nonImageFiles = files.filter((file) => !file.type.startsWith('image/'));
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));

    if (nonImageFiles.length === 0 && imageFiles.length > 0) {
      Toast.info('图片请使用“选择图片”按钮发送');
      return;
    }

    if (nonImageFiles.length > 0) {
      setSending(true);
      void (async () => {
        let failed = 0;
        for (const file of nonImageFiles) {
          // eslint-disable-next-line no-await-in-loop
          const ok = await sendFileMessage(file);
          if (!ok) failed += 1;
        }
        setSending(false);
        if (failed > 0) Toast.error(`有 ${failed} 个文件发送失败`);
      })();
    }
  }, [sendFileMessage]);

  const handleRemovePendingImage = useCallback((id: string) => {
    setPendingImages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const handleInputPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items ?? []);
    const imageFiles = items
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (imageFiles.length > 0) {
      e.preventDefault();
      handleSelectImages(imageFiles);
      Toast.success(`已添加 ${imageFiles.length} 张图片`);
    }
  }, [handleSelectImages]);

  const scrollToMessage = useCallback((id: number) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background 0.3s ease';
      el.style.background = 'var(--semi-color-primary-light-hover)';
      setTimeout(() => { el.style.background = ''; }, 1200);
    }
  }, []);

  const getReplyMessage = useCallback((id: number) => messages.find((m) => m.id === id), [messages]);

  const insertMention = useCallback((member: ChatGroupMember) => {
    if (!mentionState) return;
    const mentionText = `@${member.nickname} `;
    setInput((prev) => prev.slice(0, mentionState.start) + mentionText + prev.slice(mentionState.end));
    setSelectedMentions((prev) => prev.some((item) => item.userId === member.id)
      ? prev
      : [...prev, { userId: member.id, nickname: member.nickname }]);
    requestAnimationFrame(() => {
      const nextPos = mentionState.start + mentionText.length;
      inputRef.current?.setSelectionRange(nextPos, nextPos);
      inputRef.current?.focus();
    });
  }, [mentionState]);

  const applyMessageUpdate = useCallback((updated: ChatMessage) => {
    setMessages((prev) => prev.map((item) => item.id === updated.id ? updated : item));
    setPinnedMessages((prev) => {
      const next = prev.filter((item) => item.id !== updated.id);
      if (updated.extra?.isPinned) next.unshift(updated);
      return next.slice(0, 5);
    });
    setFavoriteMessages((prev) => {
      const next = prev.filter((item) => item.id !== updated.id);
      if (updated.extra?.isFavorited) next.unshift(updated);
      return next;
    });
    setConversations((prev) => prev.map((conv) => conv.lastMessage?.id === updated.id ? { ...conv, lastMessage: updated } : conv));
  }, []);

  const handleToggleFavorite = useCallback(async (msg: ChatMessage) => {
    const res = await request.patch<ChatMessage>(`/api/chat/messages/${msg.id}/favorite`, { favorite: !msg.extra?.isFavorited });
    if (res.code === 0 && res.data) {
      applyMessageUpdate(res.data);
      Toast.success(res.data.extra?.isFavorited ? '已收藏' : '已取消收藏');
      return;
    }
    Toast.error(res.message ?? '操作失败');
  }, [applyMessageUpdate]);

  const handleTogglePinMessage = useCallback(async (msg: ChatMessage) => {
    const res = await request.patch<ChatMessage>(`/api/chat/messages/${msg.id}/pin`, { pin: !msg.extra?.isPinned });
    if (res.code === 0 && res.data) {
      applyMessageUpdate(res.data);
      Toast.success(res.data.extra?.isPinned ? '已置顶消息' : '已取消置顶');
      return;
    }
    Toast.error(res.message ?? '操作失败');
  }, [applyMessageUpdate]);

  const handleEditRecalled = useCallback((messageId: number) => {
    const draft = recalledDrafts[messageId];
    if (!draft) return;
    setInput(draft.content);
    setSelectedMentions(draft.mentions ?? []);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [recalledDrafts]);

  const handleToggleSelectMessage = useCallback((msg: ChatMessage) => {
    if (msg.isRecalled || msg.type === 'system') return;
    setMultiSelectMode(true);
    setSelectedMessageIds((prev) =>
      prev.includes(msg.id) ? prev.filter((id) => id !== msg.id) : [...prev, msg.id],
    );
  }, []);

  const handleExitMultiSelect = useCallback(() => {
    setMultiSelectMode(false);
    setSelectedMessageIds([]);
  }, []);

  const handleForwardSingle = useCallback((msg: ChatMessage) => {
    setForwardingMode('individual');
    setForwardingMessageIds([msg.id]);
    setForwardModalVisible(true);
  }, []);

  const handleForwardSelected = useCallback((mode: 'merge' | 'individual') => {
    if (selectedMessageIds.length === 0) return;
    setForwardingMode(mode);
    setForwardingMessageIds([...selectedMessageIds]);
    setForwardModalVisible(true);
  }, [selectedMessageIds]);

  const handleForwardConfirm = useCallback(async (targetIds: number[]) => {
    setForwardModalVisible(false);
    const res = await request.post('/api/chat/messages/forward', {
      messageIds: forwardingMessageIds,
      targetConversationIds: targetIds,
      mode: forwardingMode,
    });
    if ((res as { code: number }).code === 0) {
      Toast.success('转发成功');
      handleExitMultiSelect();
    } else {
      Toast.error((res as { message?: string }).message ?? '转发失败');
    }
    setForwardingMessageIds([]);
  }, [forwardingMessageIds, forwardingMode, handleExitMultiSelect]);

  const handleFavoriteSelected = useCallback(async () => {
    if (selectedMessageIds.length === 0) return;
    const msgs = messages.filter((m) => selectedMessageIds.includes(m.id) && !m.extra?.isFavorited && !m.isRecalled && m.type !== 'system');
    if (msgs.length === 0) { Toast.info('所选消息已全部收藏'); return; }
    let successCount = 0;
    for (const msg of msgs) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request.patch<ChatMessage>(`/api/chat/messages/${msg.id}/favorite`, { favorite: true });
      if (res.code === 0 && res.data) {
        applyMessageUpdate(res.data);
        successCount += 1;
      }
    }
    Toast.success(`已收藏 ${successCount} 条消息`);
    handleExitMultiSelect();
  }, [selectedMessageIds, messages, applyMessageUpdate, handleExitMultiSelect]);

  const handleOpenForwardView = useCallback((items: NonNullable<ChatMessageExtra['forwardedMessages']>, title: string) => {
    setForwardViewItems(items);
    setForwardViewTitle(title);
    setForwardViewVisible(true);
  }, []);

  const handleRecall = useCallback(async (msg: ChatMessage) => {
    if (msg.type === 'text') {
      setRecalledDrafts((prev) => ({
        ...prev,
        [msg.id]: { content: msg.content, mentions: msg.extra?.mentions ?? undefined },
      }));
      setInput(msg.content);
      setSelectedMentions(msg.extra?.mentions ?? []);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    const res = await request.request<null>(`/api/chat/messages/${msg.id}/recall`, { method: 'PATCH' });
    if (res.code !== 0) Toast.error(res.message ?? '撤回失败');
  }, []);

  const resetSearchFilters = useCallback(() => {
    setMsgSearch('');
    setSearchTypeFilters([]);
    setSearchSenderId(undefined);
    setSearchTimeRange(null);
    setSearchDatePreset('');
    setSearchResults([]);
    setSearchTotal(0);
    setSearchPage(1);
    setSearchHasSearched(false);
    setShowSearchPanel(false);
  }, []);

  const applyDatePreset = useCallback((preset: SearchDatePreset) => {
    if (!preset) {
      setSearchDatePreset('');
      setSearchTimeRange(null);
      return;
    }
    const now = new Date();
    const start = new Date(now);
    if (preset === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (preset === '7d') {
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
    } else if (preset === '30d') {
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
    }
    setSearchDatePreset(preset);
    setSearchTimeRange([start, now]);
  }, []);

  const senderOptions = useMemo(() => {
    const optionMap = new Map<number, { value: number; label: string }>();
    if (currentUserId) {
      optionMap.set(currentUserId, { value: currentUserId, label: currentUserNickname || '我' });
    }
    if (activeConv?.type === 'direct' && activeConv.targetUser) {
      optionMap.set(activeConv.targetUser.id, { value: activeConv.targetUser.id, label: activeConv.targetUser.nickname });
    }
    searchMembers.forEach((member) => {
      optionMap.set(member.id, { value: member.id, label: member.nickname });
    });
    messages.forEach((message) => {
      if (message.senderId && message.senderName) {
        optionMap.set(message.senderId, { value: message.senderId, label: message.senderName });
      }
    });
    return Array.from(optionMap.values());
  }, [activeConv, currentUserId, currentUserNickname, messages, searchMembers]);

  useEffect(() => {
    if (!showSearchPanel || !activeConvId || activeConv?.type !== 'group') {
      if (!showSearchPanel) setSearchMembers([]);
      return;
    }
    void (async () => {
      const res = await request.get<ChatGroupMember[]>(`/api/chat/conversations/${activeConvId}/members`, { silent: true });
      if (res.code === 0 && res.data) setSearchMembers(res.data);
    })();
  }, [activeConv?.type, activeConvId, showSearchPanel]);

  const executeSearch = useCallback(async (targetPage = 1) => {
    if (!activeConvId) return;

    const hasCondition = Boolean(
      msgSearch.trim()
      || searchTypeFilters.length > 0
      || searchSenderId
      || searchTimeRange,
    );
    if (!hasCondition) {
      Toast.info('请先输入关键词或设置筛选条件');
      return;
    }

    const qs = new URLSearchParams();
    if (msgSearch.trim()) qs.set('keyword', msgSearch.trim());
    if (searchTypeFilters.length > 0) qs.set('types', searchTypeFilters.join(','));
    if (searchSenderId) qs.set('senderId', String(searchSenderId));
    if (searchTimeRange) {
      qs.set('startAt', formatDateTimeForApi(searchTimeRange[0]));
      qs.set('endAt', formatDateTimeForApi(searchTimeRange[1]));
    }
    qs.set('page', String(targetPage));
    qs.set('pageSize', '20');

    setSearchLoading(true);
    const res = await request.get<ChatMessageSearchResult>(
      `/api/chat/conversations/${activeConvId}/messages/search?${qs.toString()}`,
      { silent: true },
    );
    setSearchLoading(false);

    if (res.code === 0 && res.data) {
      setShowSearchPanel(true);
      setShowMembers(false);
      setSearchHasSearched(true);
      setSearchPage(targetPage);
      setSearchResults(targetPage === 1 ? res.data.list : [...searchResults, ...res.data.list]);
      setSearchTotal(res.data.total);
      return;
    }

    setSearchHasSearched(false);
    setShowSearchPanel(false);
    Toast.info('服务端搜索暂不可用，已保留本地模糊过滤');
  }, [activeConvId, msgSearch, searchResults, searchSenderId, searchTimeRange, searchTypeFilters]);

  const jumpToSearchResult = useCallback(async (item: ChatMessageSearchItem) => {
    if (!activeConvId) return;
    const res = await request.get<ChatMessageContext>(
      `/api/chat/conversations/${activeConvId}/messages/${item.message.id}/context?before=15&after=15`,
      { silent: true },
    );
    if (res.code !== 0 || !res.data) {
      Toast.error(res.message ?? '定位消息失败');
      return;
    }
    setMessages(res.data.list);
    setHasMore(res.data.hasBefore);
    setPage(1);
    setContextMode({ anchorMessageId: res.data.anchorMessageId, keyword: msgSearch.trim() || item.snippet });
    setTimeout(() => scrollToMessage(res.data.anchorMessageId), 80);
  }, [activeConvId, msgSearch, scrollToMessage]);

  const restoreLatestMessages = useCallback(async () => {
    if (!activeConvId) return;
    await fetchMessages(activeConvId, 1);
  }, [activeConvId, fetchMessages]);

  const refreshGroupAvatarMembers = useCallback(async (conversationId: number) => {
    const res = await request.get<ChatGroupMember[]>(`/api/chat/conversations/${conversationId}/members`, { silent: true });
    if (res.code !== 0 || !res.data) return;
    setGroupAvatarMap((prev) => ({
      ...prev,
      [conversationId]: res.data.slice(0, 9).map((m) => ({ id: m.id, nickname: m.nickname, avatar: m.avatar })),
    }));
  }, []);

  const handleWsMessage = useCallback((wsMsg: WsMessage) => {
    if (wsMsg.type === 'chat:message') {
      const msg = wsMsg.payload;
      const isOwnMsg = msg.senderId === currentUserId;
      const mentionedMe = !isOwnMsg && (msg.extra?.mentions ?? []).some((item) => item.userId === currentUserId);
      const shouldAutoRead = msg.conversationId === activeConvId && (isOwnMsg || isNearBottom());
      if (msg.conversationId === activeConvId) {
        setMessages((prev) => [...prev, msg]);
        if (shouldAutoRead) {
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
          request.post(`/api/chat/conversations/${msg.conversationId}/read`, {}, { silent: true }).catch(() => {});
          setPendingNewMsgCount(0);
        } else if (!isOwnMsg) {
          setPendingNewMsgCount((v) => v + 1);
        }
      }
      setConversations((prev) => {
        const isActive = msg.conversationId === activeConvId;
        const updated = prev.map((c) =>
          c.id === msg.conversationId
            ? {
              ...c,
              lastMessage: msg,
              unreadCount: isOwnMsg ? c.unreadCount : (isActive && shouldAutoRead ? 0 : c.unreadCount + 1),
              updatedAt: msg.createdAt,
            }
            : c,
        );
        const idx = updated.findIndex((c) => c.id === msg.conversationId);
        if (idx > 0) {
          const [item] = updated.splice(idx, 1);
          updated.unshift(item);
        }
        return updated;
      });
      if (mentionedMe) Toast.info(`${msg.senderName ?? '有人'} @了你`);
    } else if (wsMsg.type === 'chat:recall') {
      const { messageId } = wsMsg.payload;
      setMessages((prev) =>
        prev.map((m) => m.id === messageId ? { ...m, isRecalled: true, content: '消息已撤回' } : m),
      );
    } else if (wsMsg.type === 'chat:typing') {
      const { conversationId, userId, nickname } = wsMsg.payload;
      if (conversationId !== activeConvId || userId === currentUserId) return;
      setTypingUsers((prev) => {
        const existing = prev[userId];
        if (existing) clearTimeout(existing.timer);
        const timer = setTimeout(() => {
          setTypingUsers((p) => {
            const next = { ...p };
            delete next[userId];
            return next;
          });
        }, 4000);
        return { ...prev, [userId]: { nickname, timer } };
      });
    } else if (wsMsg.type === 'chat:member-join') {
      void refreshGroupAvatarMembers(wsMsg.payload.conversationId);
      if (wsMsg.payload.conversationId === activeConvId) {
        void fetchConversations();
      }
    } else if (wsMsg.type === 'chat:member-leave') {
      const { conversationId, userId } = wsMsg.payload;
      if (userId === currentUserId) {
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
        if (activeConvId === conversationId) {
          setActiveConvId(null);
          setMessages([]);
        }
        Toast.warning('你已被移出该群聊');
      } else {
        void refreshGroupAvatarMembers(conversationId);
      }
    } else if (wsMsg.type === 'chat:group-update') {
      const { conversationId, name, announcement } = wsMsg.payload;
      setConversations((prev) =>
        prev.map((c) => c.id === conversationId
          ? {
            ...c,
            ...(name !== undefined ? { name } : {}),
            ...(announcement !== undefined ? { announcement } : {}),
          }
          : c),
      );
    }
  }, [activeConvId, currentUserId, fetchConversations, isNearBottom, refreshGroupAvatarMembers]);

  const handleMessagesScroll = useCallback(() => {
    if (!activeConvId) return;
    if (!isNearBottom()) return;
    if (pendingNewMsgCount > 0) setPendingNewMsgCount(0);
    request.post(`/api/chat/conversations/${activeConvId}/read`, {}, { silent: true }).catch(() => {});
    setConversations((prev) => prev.map((c) => (c.id === activeConvId ? { ...c, unreadCount: 0 } : c)));
  }, [activeConvId, isNearBottom, pendingNewMsgCount]);

  useWebSocket(handleWsMessage);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleEmojiSelect = useCallback((emoji: { native: string }) => {
    const ta = inputRef.current;
    if (!ta) {
      setInput((prev) => prev + emoji.native);
      return;
    }
    const start = ta.selectionStart ?? input.length;
    const end = ta.selectionEnd ?? input.length;
    setInput((prev) => prev.slice(0, start) + emoji.native + prev.slice(end));
    setEmojiVisible(false);
    requestAnimationFrame(() => {
      const pos = start + emoji.native.length;
      ta.setSelectionRange(pos, pos);
      ta.focus();
    });
  }, [input]);

  const filteredConvs = conversations.filter((c) => {
    if (!convSearch) return true;
    const name = c.type === 'direct' ? (c.targetUser?.nickname ?? '') : (c.name ?? '');
    return name.toLowerCase().includes(convSearch.toLowerCase());
  });

  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0);
  const galleryImages = messages.filter((m) => m.type === 'image' && !m.isRecalled);
  const activeGalleryIndex = galleryImages.findIndex((m) => m.id === previewImageId);
  const useLocalSearchFallback = Boolean(msgSearch.trim()) && !(showSearchPanel && searchHasSearched);
  const displayMessages = useLocalSearchFallback
    ? messages.filter((m) => {
      const keyword = msgSearch.toLowerCase();
      return (m.content ?? '').toLowerCase().includes(keyword) || (m.senderName ?? '').toLowerCase().includes(keyword);
    })
    : messages;

  useEffect(() => {
    if (previewImageId === null) return;
    if (!galleryImages.some((m) => m.id === previewImageId)) {
      setPreviewImageId(null);
    }
  }, [galleryImages, previewImageId]);

  useEffect(() => {
    const groupIds = conversations.filter((c) => c.type === 'group').map((c) => c.id);
    const missingIds = groupIds.filter((id) => !groupAvatarMap[id]);
    if (missingIds.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missingIds.map(async (id) => {
        const res = await request.get<ChatGroupMember[]>(`/api/chat/conversations/${id}/members`, { silent: true });
        return [id, (res.code === 0 && res.data ? res.data : []).slice(0, 9)] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setGroupAvatarMap((prev) => {
        const next = { ...prev };
        for (const [id, members] of entries) {
          next[id] = members.map((m) => ({ id: m.id, nickname: m.nickname, avatar: m.avatar }));
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [conversations, groupAvatarMap, refreshGroupAvatarMembers]);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', minHeight: 500, border: '1px solid var(--semi-color-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--semi-color-bg-0)' }}>

      {/* Left: conversation list */}
      <div style={{ width: 280, borderRight: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {totalUnread > 0 ? (
            <Badge count={totalUnread} overflowCount={99} style={{ flex: 1 }}>
              <Title heading={6} style={{ margin: 0 }}>消息</Title>
            </Badge>
          ) : (
            <Title heading={6} style={{ margin: 0, flex: 1 }}>消息</Title>
          )}
          <Tooltip content="新建对话">
            <Button
              size="small" theme="borderless" type="primary"
              icon={<MessageSquarePlus size={16} />}
              onClick={() => setShowNewChat((v) => !v)}
            />
          </Tooltip>
        </div>

        {showNewChat && (
          <div style={{ borderBottom: '1px solid var(--semi-color-border)' }}>
            <NewChatPanel
              onSelectUser={handleNewDirectChat}
              onGroupCreated={handleGroupCreated}
              onClose={() => setShowNewChat(false)}
            />
          </div>
        )}

        <div style={{ padding: '8px 12px' }}>
          <Input prefix={<Search size={13} />} placeholder="搜索会话" size="small" value={convSearch} onChange={setConvSearch} />
        </div>

        <div style={{ padding: '0 12px 8px', display: 'flex', gap: 8 }}>
          <Button
            size="small"
            theme={leftPaneMode === 'conversations' ? 'solid' : 'borderless'}
            type={leftPaneMode === 'conversations' ? 'primary' : 'tertiary'}
            onClick={() => setLeftPaneMode('conversations')}
          >
            消息
          </Button>
          <Button
            size="small"
            theme={leftPaneMode === 'favorites' ? 'solid' : 'borderless'}
            type={leftPaneMode === 'favorites' ? 'warning' : 'tertiary'}
            icon={<Bookmark size={13} />}
            onClick={() => setLeftPaneMode('favorites')}
          >
            收藏
          </Button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <Spin spinning={loadingConvs}>
            {leftPaneMode === 'conversations' && filteredConvs.length === 0 && !loadingConvs && (
              <Empty description="暂无会话" style={{ padding: '40px 0' }} imageStyle={{ width: 80 }} />
            )}
            {leftPaneMode === 'favorites' && favoriteMessages.length === 0 && !loadingConvs && (
              <Empty description="暂无收藏消息" style={{ padding: '40px 0' }} imageStyle={{ width: 80 }} />
            )}
            {leftPaneMode === 'conversations' && filteredConvs.map((conv) => {
              const name = conv.type === 'direct' ? (conv.targetUser?.nickname ?? '未知用户') : (conv.name ?? '群聊');
              const avatarName = conv.type === 'direct' ? (conv.targetUser?.nickname ?? '?') : (conv.name ?? '?');
              const avatar = conv.type === 'direct' ? conv.targetUser?.avatar : null;
              const groupMembers = conv.type === 'group' ? groupAvatarMap[conv.id] : undefined;
              const avatarNode = conv.type === 'group'
                ? <GroupGridAvatar name={avatarName} size={38} members={groupMembers} />
                : <UserAvatar name={avatarName} avatar={avatar} size={38} />;
              const lastMsg = conv.lastMessage;
              const isActive = conv.id === activeConvId;
              const isPinned = conv.isPinned ?? false;
              const isStarred = conv.isStarred ?? false;
              let lastMsgText = '暂无消息';
              if (lastMsg) {
                const summary = getMessageSummary(lastMsg);
                if (conv.type === 'group' && lastMsg.senderName && lastMsg.type !== 'system' && !lastMsg.isRecalled) {
                  lastMsgText = `${lastMsg.senderName}：${summary}`;
                } else {
                  lastMsgText = summary;
                }
              }

              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => { void handleSelectConv(conv); }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setLeftPaneContextMenu({ x: e.clientX, y: e.clientY, type: 'conversation', conv });
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                    cursor: 'pointer', width: '100%', textAlign: 'left', border: 'none',
                    background: isActive ? 'var(--semi-color-primary-light-default)' : 'transparent',
                    borderLeft: isActive ? '3px solid var(--semi-color-primary)' : '3px solid transparent',
                  }}
                  onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--semi-color-fill-0)'; }}
                  onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                    {conv.unreadCount > 0 ? (
                      <Badge count={conv.unreadCount} overflowCount={99} dot={false}>
                        {avatarNode}
                      </Badge>
                    ) : (
                      avatarNode
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 }}>
                          {isPinned && <Pin size={10} style={{ color: 'var(--semi-color-primary)', flexShrink: 0 }} />}
                          {isStarred && <Star size={10} style={{ color: '#facc15', flexShrink: 0 }} />}
                          <Text strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {name}
                          </Text>
                        </div>
                        {lastMsg && (
                          <Text type="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>
                            {formatConvTime(lastMsg.createdAt)}
                          </Text>
                        )}
                      </div>
                      <Text type="tertiary" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                        {lastMsgText}
                      </Text>
                    </div>
                </button>
              );
            })}
            {leftPaneMode === 'favorites' && favoriteMessages.map((msg) => {
              const conv = conversations.find((item) => item.id === msg.conversationId);
              const convName = conv?.type === 'direct' ? (conv.targetUser?.nickname ?? '私聊') : (conv?.name ?? '群聊');
              return (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => { void openFavoriteMessage(msg); }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setLeftPaneContextMenu({ x: e.clientX, y: e.clientY, type: 'favorite', msg });
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '10px 12px', cursor: 'pointer' }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                      <Text strong style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{convName}</Text>
                      <Text type="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>{formatConvTime(msg.createdAt)}</Text>
                    </div>
                    <Text type="tertiary" style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {getMessageSummary(msg)}
                    </Text>
                </button>
              );
            })}
            {leftPaneContextMenu && (
              <Dropdown
                trigger="click"
                visible
                clickToHide
                position="bottomLeft"
                getPopupContainer={() => document.body}
                onVisibleChange={(visible) => {
                  if (!visible) setLeftPaneContextMenu(null);
                }}
                render={leftPaneContextMenu.type === 'conversation' ? (
                  <Dropdown.Menu>
                    <Dropdown.Item
                      icon={<Pin size={13} />}
                      onClick={() => {
                        const { conv } = leftPaneContextMenu;
                        const isPinned = conv.isPinned ?? false;
                        void request.patch(`/api/chat/conversations/${conv.id}/pin`, { pin: !isPinned }).then((r) => {
                          if ((r as { code: number }).code === 0) {
                            setConversations((prev) => {
                              const updated = prev.map((c) => c.id === conv.id ? { ...c, isPinned: !isPinned } : c);
                              updated.sort((a, b) => {
                                if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
                                const ta = a.lastMessage?.createdAt ?? a.createdAt;
                                const tb = b.lastMessage?.createdAt ?? b.createdAt;
                                return tb.localeCompare(ta);
                              });
                              return updated;
                            });
                            Toast.success(isPinned ? '已取消置顶' : '已置顶');
                          }
                        });
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      {(leftPaneContextMenu.conv.isPinned ?? false) ? '取消置顶' : '置顶'}
                    </Dropdown.Item>
                    <Dropdown.Item
                      icon={<Star size={13} />}
                      onClick={() => {
                        const { conv } = leftPaneContextMenu;
                        const isStarred = conv.isStarred ?? false;
                        void request.patch(`/api/chat/conversations/${conv.id}/star`, { star: !isStarred }).then((r) => {
                          if ((r as { code: number }).code === 0) {
                            setConversations((prev) =>
                              prev.map((c) => c.id === conv.id ? { ...c, isStarred: !isStarred } : c),
                            );
                            Toast.success(isStarred ? '已取消星标' : '已标记星标');
                          }
                        });
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      {(leftPaneContextMenu.conv.isStarred ?? false) ? '取消星标' : '标记星标'}
                    </Dropdown.Item>
                    <Dropdown.Divider />
                    <Dropdown.Item
                      type="danger"
                      onClick={() => {
                        const { conv } = leftPaneContextMenu;
                        Modal.confirm({
                          title: '确定要删除该会话吗？',
                          content: '删除后仅移除你当前账号下的会话记录，无法恢复。',
                          okButtonProps: { type: 'danger', theme: 'solid' },
                          onOk: () => {
                            void request.delete(`/api/chat/conversations/${conv.id}`).then((r) => {
                              if ((r as { code: number; message?: string }).code === 0) {
                                Toast.success('会话已删除');
                                setConversations((prev) => prev.filter((c) => c.id !== conv.id));
                                if (activeConvId === conv.id) {
                                  setActiveConvId(null);
                                  setMessages([]);
                                  setPendingNewMsgCount(0);
                                }
                              } else {
                                Toast.error((r as { message?: string }).message ?? '删除失败');
                              }
                            });
                          },
                        });
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      删除会话
                    </Dropdown.Item>
                  </Dropdown.Menu>
                ) : (
                  <Dropdown.Menu>
                    <Dropdown.Item
                      icon={<Search size={12} />}
                      onClick={() => {
                        void openFavoriteMessage(leftPaneContextMenu.msg);
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      定位到原消息
                    </Dropdown.Item>
                    <Dropdown.Item
                      icon={<Bookmark size={12} />}
                      onClick={() => {
                        void handleToggleFavorite(leftPaneContextMenu.msg);
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      取消收藏
                    </Dropdown.Item>
                    <Dropdown.Item
                      icon={<Pin size={12} />}
                      onClick={() => {
                        void handleTogglePinMessage(leftPaneContextMenu.msg);
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      {leftPaneContextMenu.msg.extra?.isPinned ? '取消置顶消息' : '置顶消息'}
                    </Dropdown.Item>
                  </Dropdown.Menu>
                )}
              >
                <span
                  style={{
                    position: 'fixed',
                    left: leftPaneContextMenu.x,
                    top: leftPaneContextMenu.y,
                    width: 1,
                    height: 1,
                  }}
                />
              </Dropdown>
            )}
          </Spin>
        </div>
      </div>

      {/* Right: chat area */}
      {activeConv ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Header */}
          <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            {activeConv.type === 'direct' && activeConv.targetUser && (
              <UserAvatar name={activeConv.targetUser.nickname} avatar={activeConv.targetUser.avatar} size={32} />
            )}
            {activeConv.type === 'group' && (
              <GroupGridAvatar name={activeConv.name ?? '群聊'} size={32} members={groupAvatarMap[activeConv.id]} />
            )}
            <Title heading={6} style={{ margin: 0, flex: 1 }}>
              {activeConv.type === 'direct' ? (activeConv.targetUser?.nickname ?? '未知用户') : (activeConv.name ?? '群聊')}
            </Title>
            <Input
              size="small"
              prefix={<Search size={12} />}
              placeholder="搜索消息"
              value={msgSearch}
              onChange={setMsgSearch}
              onEnterPress={() => { void executeSearch(1); }}
              showClear
              style={{ width: 240 }}
            />
            <Tooltip content="执行搜索">
              <Button
                size="small"
                theme="solid"
                type="primary"
                icon={<Search size={14} />}
                loading={searchLoading}
                onClick={() => { void executeSearch(1); }}
              />
            </Tooltip>
            {activeConv.type === 'group' && (
              <Tooltip content="群公告历史">
                <Button
                  size="small"
                  theme="borderless"
                  type={announcementHistoryVisible ? 'primary' : 'tertiary'}
                  icon={<History size={15} />}
                  onClick={() => {
                    if (!activeConvId) return;
                    void fetchAnnouncementHistory(activeConvId);
                    setAnnouncementHistoryVisible(true);
                  }}
                />
              </Tooltip>
            )}
            <Tooltip content={showSearchPanel ? '关闭搜索面板' : '高级筛选'}>
              <Button
                size="small"
                theme="borderless"
                type={showSearchPanel ? 'primary' : 'tertiary'}
                icon={<ListFilter size={15} />}
                onClick={() => {
                  setShowSearchPanel((v) => {
                    const next = !v;
                    if (next) setShowMembers(false);
                    return next;
                  });
                }}
              />
            </Tooltip>
            {activeConv.type === 'group' && (
              <Tooltip content={showMembers ? '关闭成员面板' : '查看群成员'}>
                <Button
                  size="small" theme="borderless" type={showMembers ? 'primary' : 'tertiary'}
                  icon={<Users size={15} />}
                  onClick={() => {
                    setShowMembers((v) => {
                      const next = !v;
                      if (next) setShowSearchPanel(false);
                      return next;
                    });
                  }}
                />
              </Tooltip>
            )}
          </div>

          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Messages */}
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}
            >
              {pinnedMessages.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--semi-color-fill-0)', border: '1px solid var(--semi-color-border)' }}>
                  <Text strong style={{ fontSize: 12 }}><Pin size={12} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />置顶消息</Text>
                  {pinnedMessages.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => scrollToMessage(item.id)}
                      style={{ border: 'none', background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer' }}
                    >
                      <Text type="tertiary" style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getMessageSummary(item)}
                      </Text>
                    </button>
                  ))}
                </div>
              )}
              {contextMode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--semi-color-fill-0)', border: '1px solid var(--semi-color-border)' }}>
                  <Text style={{ flex: 1, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                    当前正在查看搜索定位结果：{contextMode.keyword}
                  </Text>
                  <Button size="small" theme="borderless" type="primary" onClick={() => { void restoreLatestMessages(); }}>
                    返回最新消息
                  </Button>
                </div>
              )}
              {hasMore && !useLocalSearchFallback && !contextMode && (
                <div style={{ textAlign: 'center', marginBottom: 8 }}>
                  <Button
                    size="small" type="tertiary" theme="borderless" loading={loadingMsgs}
                    onClick={() => { if (activeConvId) void fetchMessages(activeConvId, page + 1); }}
                  >
                    加载更多
                  </Button>
                </div>
              )}
              <Spin spinning={loadingMsgs && messages.length === 0}>
                {displayMessages.length === 0 && !loadingMsgs && (
                  <Empty description="发送第一条消息吧" style={{ margin: 'auto' }} imageStyle={{ width: 80 }} />
                )}
                {displayMessages.map((msg, index) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isSelf={msg.senderId === currentUserId}
                    onReply={setReplyTo}
                    onRecall={handleRecall}
                    onOpenImage={(imageMsg) => setPreviewImageId(imageMsg.id)}
                    shouldShowTime={shouldDisplayMessageTime(msg, displayMessages[index + 1])}
                    getReplyMessage={getReplyMessage}
                    onScrollToMessage={scrollToMessage}
                    onToggleFavorite={handleToggleFavorite}
                    onTogglePin={handleTogglePinMessage}
                    onEditRecalled={handleEditRecalled}
                    recalledDraft={recalledDrafts[msg.id]}
                    multiSelectMode={multiSelectMode}
                    isSelected={selectedMessageIds.includes(msg.id)}
                    onToggleSelect={handleToggleSelectMessage}
                    onForwardSingle={handleForwardSingle}
                    onOpenForwardView={handleOpenForwardView}
                  />
                ))}
                <div ref={messagesEndRef} />
              </Spin>
              {pendingNewMsgCount > 0 && (
                <div style={{ position: 'sticky', bottom: 10, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
                  <Button
                    size="small"
                    theme="solid"
                    type="primary"
                    style={{ pointerEvents: 'auto' }}
                    onClick={() => {
                      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                      setPendingNewMsgCount(0);
                      if (activeConvId) {
                        void request.post(`/api/chat/conversations/${activeConvId}/read`, {}, { silent: true });
                        setConversations((prev) => prev.map((c) => (c.id === activeConvId ? { ...c, unreadCount: 0 } : c)));
                      }
                    }}
                  >
                    有 {pendingNewMsgCount} 条新消息，点击查看
                  </Button>
                </div>
              )}
            </div>

            {/* Group members sidebar */}
            {activeConv.type === 'group' && showMembers && !showSearchPanel && (
              <GroupMembersPanel
                conversationId={activeConv.id}
                currentUserId={currentUserId}
                conv={activeConv}
                onConvUpdate={(patch) => {
                  setConversations((prev) =>
                    prev.map((c) => c.id === activeConv.id ? { ...c, ...patch } : c),
                  );
                }}
              />
            )}

            {showSearchPanel && (
              <div style={{ width: 380, borderLeft: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', flexShrink: 0, background: 'var(--semi-color-bg-0)' }}>
                <div style={{ padding: '12px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text strong style={{ flex: 1, fontSize: 13 }}>消息搜索</Text>
                  <Text type="tertiary" style={{ fontSize: 12 }}>{searchHasSearched ? `共 ${searchTotal} 条` : '未搜索'}</Text>
                  <Button size="small" theme="borderless" type="tertiary" icon={<X size={14} />} onClick={() => setShowSearchPanel(false)} />
                </div>

                <div style={{ padding: 12, borderBottom: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Input
                    size="small"
                    prefix={<Search size={13} />}
                    placeholder="搜索消息内容 / 文件名 / 发送人"
                    value={msgSearch}
                    onChange={setMsgSearch}
                    onEnterPress={() => { void executeSearch(1); }}
                    showClear
                  />

                  <Select
                    multiple
                    showClear
                    placeholder="消息类别（可多选）"
                    value={searchTypeFilters}
                    onChange={(val) => setSearchTypeFilters(((val as ChatMessage['type'][]) ?? []))}
                    optionList={CHAT_MESSAGE_TYPE_OPTIONS}
                    maxTagCount={2}
                  />

                  <Select
                    showClear
                    filter
                    placeholder="发送人"
                    value={searchSenderId}
                    onChange={(val) => setSearchSenderId(val ? Number(val) : undefined)}
                    optionList={senderOptions}
                  />

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[
                      { value: 'today', label: '今天' },
                      { value: '7d', label: '近7天' },
                      { value: '30d', label: '近30天' },
                    ].map((item) => (
                      <Button
                        key={item.value}
                        size="small"
                        theme={searchDatePreset === item.value ? 'solid' : 'borderless'}
                        type={searchDatePreset === item.value ? 'primary' : 'tertiary'}
                        onClick={() => applyDatePreset(item.value as SearchDatePreset)}
                      >
                        {item.label}
                      </Button>
                    ))}
                    {searchTimeRange && (
                      <Button size="small" theme="borderless" type="tertiary" onClick={() => applyDatePreset('')}>清空时间</Button>
                    )}
                  </div>

                  <DatePicker
                    type="dateTimeRange"
                    placeholder={['开始时间', '结束时间']}
                    value={searchTimeRange ?? undefined}
                    onChange={(val) => {
                      setSearchDatePreset('');
                      setSearchTimeRange(val ? (val as [Date, Date]) : null);
                    }}
                    style={{ width: '100%' }}
                  />

                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button type="primary" loading={searchLoading} icon={<Search size={14} />} onClick={() => { void executeSearch(1); }}>查询</Button>
                    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={resetSearchFilters}>重置</Button>
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                  {!searchHasSearched && (
                    <Empty description="输入关键词或设置筛选条件后开始搜索" style={{ paddingTop: 48 }} imageStyle={{ width: 72 }} />
                  )}
                  {searchHasSearched && searchResults.length === 0 && !searchLoading && (
                    <Empty description="没有找到符合条件的消息" style={{ paddingTop: 48 }} imageStyle={{ width: 72 }} />
                  )}
                  {searchResults.map((item) => {
                    const typeLabel = CHAT_MESSAGE_TYPE_OPTIONS.find((option) => option.value === item.message.type)?.label ?? item.message.type;
                    return (
                      <button
                        key={item.message.id}
                        type="button"
                        onClick={() => { void jumpToSearchResult(item); }}
                        style={{
                          width: '100%', textAlign: 'left', border: '1px solid var(--semi-color-border)', background: 'var(--semi-color-bg-0)', borderRadius: 8,
                          padding: '10px 12px', marginBottom: 10, cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--semi-color-fill-0)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--semi-color-bg-0)'; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <Tag size="small" color="light-blue">{typeLabel}</Tag>
                            <Text strong style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.message.senderName ?? '未知发送人'}
                            </Text>
                          </div>
                          <Text type="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>{formatConvTime(item.message.createdAt)}</Text>
                        </div>
                        <Text style={{ display: 'block', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {item.snippet}
                        </Text>
                      </button>
                    );
                  })}

                  {searchHasSearched && searchResults.length < searchTotal && (
                    <div style={{ textAlign: 'center', marginTop: 4 }}>
                      <Button
                        size="small"
                        type="tertiary"
                        theme="borderless"
                        loading={searchLoading}
                        onClick={() => { void executeSearch(searchPage + 1); }}
                      >
                        加载更多结果
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <ImageGalleryLightbox
            images={galleryImages}
            activeImageId={previewImageId}
            onClose={() => setPreviewImageId(null)}
            onPrev={() => {
              if (activeGalleryIndex > 0) setPreviewImageId(galleryImages[activeGalleryIndex - 1]?.id ?? null);
            }}
            onNext={() => {
              if (activeGalleryIndex >= 0 && activeGalleryIndex < galleryImages.length - 1) {
                setPreviewImageId(galleryImages[activeGalleryIndex + 1]?.id ?? null);
              }
            }}
          />

          <Modal
            title="群公告历史"
            visible={announcementHistoryVisible}
            onCancel={() => setAnnouncementHistoryVisible(false)}
            footer={null}
            width={560}
          >
            {announcementHistory.length === 0 ? (
              <Empty description="暂无公告历史" imageStyle={{ width: 72 }} style={{ padding: '20px 0' }} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 420, overflowY: 'auto' }}>
                {announcementHistory.map((item) => (
                  <div key={item.id} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <Text strong style={{ fontSize: 12 }}>{item.extra?.announcementHistory?.operatorName ?? item.senderName ?? '系统'}</Text>
                      <Text type="tertiary" style={{ fontSize: 11 }}>{formatDateTime(item.createdAt)}</Text>
                    </div>
                    <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {item.extra?.announcementHistory?.announcement || '已清空群公告'}
                    </Text>
                  </div>
                ))}
              </div>
            )}
          </Modal>

          {/* Input area */}
          <div style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--semi-color-border)' }}>
            {multiSelectMode ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', flexWrap: 'wrap' }}>
                <Text style={{ flex: 1, fontSize: 13, minWidth: 80 }}>
                  已选 <Text strong>{selectedMessageIds.length}</Text> 条消息
                </Text>
                <Button
                  size="small" type="primary" theme="light" icon={<Forward size={14} />}
                  disabled={selectedMessageIds.length === 0}
                  onClick={() => handleForwardSelected('individual')}
                >
                  逐条转发
                </Button>
                <Button
                  size="small" type="primary" icon={<Forward size={14} />}
                  disabled={selectedMessageIds.length === 0}
                  onClick={() => handleForwardSelected('merge')}
                >
                  合并转发
                </Button>
                <Button
                  size="small" type="warning" theme="light" icon={<Bookmark size={14} />}
                  disabled={selectedMessageIds.length === 0}
                  onClick={() => { void handleFavoriteSelected(); }}
                >
                  收藏
                </Button>
                <Button size="small" type="tertiary" onClick={handleExitMultiSelect}>取消多选</Button>
              </div>
            ) : (
              <>
            {replyTo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '4px 10px', background: 'var(--semi-color-fill-0)', borderRadius: 6, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                <CornerDownLeft size={12} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  回复 {replyTo.senderName}：{replyTo.type === 'image' ? '[图片]' : replyTo.content}
                </span>
                <Button size="small" theme="borderless" type="tertiary" onClick={() => setReplyTo(null)} style={{ padding: '0 4px', height: 'auto', minWidth: 'auto' }}>✕</Button>
              </div>
            )}

            {pendingImages.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  marginBottom: 8,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                {pendingImages.map((item) => (
                  <div key={item.id} style={{ position: 'relative', width: 64, height: 64 }}>
                    <img
                      src={item.previewUrl}
                      alt={item.file.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: 'block' }}
                    />
                    <Button
                      size="small"
                      theme="solid"
                      type="danger"
                      onClick={() => handleRemovePendingImage(item.id)}
                      style={{
                        position: 'absolute',
                        top: -6,
                        right: -6,
                        minWidth: 20,
                        height: 20,
                        padding: 0,
                        borderRadius: '50%',
                        lineHeight: '20px',
                      }}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center' }}>
              <div ref={emojiContainerRef} style={{ position: 'relative' }}>
                <Button
                  size="small" theme="borderless" type="tertiary"
                  icon={<Smile size={16} />}
                  title="表情"
                  onClick={() => setEmojiVisible((v) => !v)}
                />
                {emojiVisible && (
                  <div
                    style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 1000 }}
                  >
                    <Picker
                      data={data}
                      onEmojiSelect={handleEmojiSelect}
                      theme="auto"
                      locale="zh"
                      previewPosition="none"
                      skinTonePosition="none"
                    />
                  </div>
                )}
              </div>

              <Tooltip content="选择图片">
                <Button
                  size="small" theme="borderless" type="tertiary"
                  icon={<ImagePlus size={16} />}
                  loading={uploading}
                  onClick={() => fileInputRef.current?.click()}
                />
              </Tooltip>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) handleSelectImages(files);
                  e.target.value = '';
                }}
              />
              <Tooltip content="发送文件">
                <Button
                  size="small" theme="borderless" type="tertiary"
                  icon={<Paperclip size={16} />}
                  loading={sending && pendingImages.length === 0}
                  onClick={() => fileAttachRef.current?.click()}
                />
              </Tooltip>
              <input
                ref={fileAttachRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) handleSelectFile(files);
                  e.target.value = '';
                }}
              />
            </div>

            <div style={{ position: 'relative', flex: 1 }}>
              {mentionState && mentionCandidates.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 48,
                    bottom: 'calc(100% + 8px)',
                    zIndex: 30,
                    background: 'var(--semi-color-bg-0)',
                    border: '1px solid var(--semi-color-border)',
                    borderRadius: 8,
                    boxShadow: 'var(--semi-shadow-elevated)',
                    padding: 6,
                    maxHeight: 220,
                    overflowY: 'auto',
                  }}
                >
                  {mentionCandidates.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => insertMention(member)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'transparent', padding: '6px 8px', textAlign: 'left', cursor: 'pointer', borderRadius: 6 }}
                    >
                      <UserAvatar name={member.nickname} avatar={member.avatar} size={26} />
                      <div style={{ minWidth: 0 }}>
                        <Text strong style={{ fontSize: 12 }}>{member.nickname}</Text>
                        <Text type="tertiary" style={{ fontSize: 11, display: 'block' }}>@{member.username}</Text>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {Object.values(typingUsers).length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--semi-color-text-3)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span
                    style={{
                      display: 'inline-flex', gap: 2, alignItems: 'center',
                    }}
                  >
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        style={{
                          width: 4, height: 4, borderRadius: '50%',
                          background: 'var(--semi-color-text-3)',
                          display: 'inline-block',
                          animation: `bounce 1.2s ${i * 0.2}s ease-in-out infinite`,
                        }}
                      />
                    ))}
                  </span>
                  {Object.values(typingUsers).map((u) => u.nickname).join('、')}正在输入...
                </div>
              )}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); handleTyping(); }}
                onKeyDown={handleKeyDown}
                onPaste={handleInputPaste}
                placeholder="输入消息…"
                rows={3}
                style={{
                  width: '100%', resize: 'none', borderRadius: 8, padding: '8px 48px 8px 12px',
                  border: '1px solid var(--semi-color-border)',
                  background: 'var(--semi-color-bg-0)',
                  color: 'var(--semi-color-text-0)',
                  fontSize: 14, fontFamily: 'inherit', outline: 'none',
                  lineHeight: 1.5, boxSizing: 'border-box',
                }}
              />
              <Button
                theme="solid" type="primary"
                icon={<Send size={14} />}
                loading={sending}
                disabled={!input.trim() && pendingImages.length === 0}
                onClick={() => { void handleSend(); }}
                style={{
                  position: 'absolute', bottom: 8, right: 8,
                  borderRadius: 6, width: 32, height: 32, padding: 0,
                }}
              />
            </div>
            <Text type="tertiary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>Enter 发送 · Shift+Enter 换行 · 支持粘贴图片</Text>
              </>
            )}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty
            description={<span>选择一个会话开始聊天，<br />或点击右上角「+」新建</span>}
            imageStyle={{ width: 100 }}
          />
        </div>
      )}
      <ForwardModal
        visible={forwardModalVisible}
        conversations={conversations}
        currentConvId={activeConvId}
        onConfirm={(targetIds) => { void handleForwardConfirm(targetIds); }}
        onCancel={() => { setForwardModalVisible(false); setForwardingMessageIds([]); }}
        mode={forwardingMode}
      />
      <ForwardedMessagesModal
        visible={forwardViewVisible}
        items={forwardViewItems}
        title={forwardViewTitle}
        onCancel={() => setForwardViewVisible(false)}
      />
    </div>
  );
}
