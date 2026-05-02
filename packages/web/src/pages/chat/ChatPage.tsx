import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Input, Button, Avatar, Badge, Typography, Empty, Spin, Toast, Tooltip, Tabs, TabPane, Dropdown,
} from '@douyinfe/semi-ui';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { Search, MessageSquarePlus, Send, CornerDownLeft, RotateCcw, Smile, ImagePlus, Users, UserPlus, Copy } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { request } from '@/utils/request';
import { formatDateTime, formatConvTime } from '@/utils/date';
import type { ChatConversation, ChatMessage, WsMessage } from '@zenith/shared';

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

function GroupMembersPanel({ conversationId }: Readonly<{ conversationId: number }>) {
  const [members, setMembers] = useState<ChatUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    const res = await request.get<ChatUser[]>(`/api/chat/conversations/${conversationId}/members`, { silent: true });
    setLoading(false);
    if (res.code === 0 && res.data) setMembers(res.data);
  }, [conversationId]);

  useEffect(() => { void fetchMembers(); }, [fetchMembers]);

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

  const memberIds = members.map((m) => m.id);

  return (
    <div style={{ width: 220, borderLeft: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', flexShrink: 0, padding: '12px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 6 }}>
        <Text strong style={{ flex: 1, fontSize: 13 }}>群成员（{members.length}）</Text>
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
        {members.map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <UserAvatar name={m.nickname} avatar={m.avatar} size={28} />
            <Text style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.nickname}
            </Text>
          </div>
        ))}
      </Spin>
    </div>
  );
}

// ─── MessageContent ───────────────────────────────────────────────────────────

function MessageContent({ msg, isSelf }: Readonly<{ msg: ChatMessage; isSelf: boolean }>) {
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const bubbleStyle: React.CSSProperties = {
    background: isSelf ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-1)',
    color: isSelf ? '#fff' : 'inherit',
    padding: '8px 12px',
    borderRadius: isSelf ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
    fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word',
  };

  if (msg.type === 'image') {
    return (
      <>
        <button
          type="button"
          onClick={() => setImagePreviewVisible(true)}
          style={{ background: 'transparent', padding: 0, border: 'none', borderRadius: 0, cursor: 'zoom-in' }}
        >
          <img
            src={msg.content}
            alt={(msg.extra as { name?: string } | null)?.name ?? '图片'}
            style={{ maxWidth: 240, maxHeight: 200, borderRadius: 0, display: 'block', cursor: 'zoom-in', border: 'none', boxShadow: 'none' }}
          />
        </button>
        {imagePreviewVisible && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setImagePreviewVisible(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setImagePreviewVisible(false);
              }
            }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 2000,
              background: 'rgba(0, 0, 0, 0.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <img
              src={msg.content}
              alt={(msg.extra as { name?: string } | null)?.name ?? '预览图片'}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: '92vw', maxHeight: '88vh', display: 'block', border: 'none', boxShadow: 'none' }}
            />
          </div>
        )}
      </>
    );
  }

  if (msg.type === 'file') {
    const extra = msg.extra as { name?: string; size?: number } | null;
    return (
      <div style={{ ...bubbleStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
        <a
          href={msg.content}
          download={extra?.name ?? '文件'}
          style={{ color: isSelf ? '#fff' : 'var(--semi-color-primary)', textDecoration: 'underline', fontSize: 13 }}
        >
          {extra?.name ?? '文件'}
        </a>
        {extra?.size !== undefined && (
          <Text style={{ fontSize: 11, color: isSelf ? 'rgba(255,255,255,0.7)' : 'var(--semi-color-text-2)' }}>
            {Math.round(extra.size / 1024)}KB
          </Text>
        )}
      </div>
    );
  }

  return <div style={bubbleStyle}>{msg.content}</div>;
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg, isSelf, onReply, onRecall, shouldShowTime, getReplyMessage, onScrollToMessage,
}: Readonly<{
  msg: ChatMessage;
  isSelf: boolean;
  onReply: (msg: ChatMessage) => void;
  onRecall: (msg: ChatMessage) => void;
  shouldShowTime: boolean;
  getReplyMessage: (id: number) => ChatMessage | undefined;
  onScrollToMessage: (id: number) => void;
}>) {
  const fullTimeStr = formatDateTime(msg.createdAt);
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const showBottomTime = shouldShowTime || isHovered;

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

  if (msg.isRecalled) {
    return (
      <div style={{ textAlign: 'center', padding: '4px 0' }}>
        <Tooltip content={fullTimeStr} position="top">
          <Text type="tertiary" style={{ fontSize: 12, cursor: 'default' }}>
            {isSelf ? '你' : (msg.senderName ?? '对方')}撤回了一条消息
          </Text>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      id={`msg-${msg.id}`}
      style={{ display: 'flex', flexDirection: isSelf ? 'row-reverse' : 'row', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}
    >
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
            else if (replied.type === 'file') replyText = `[\u6587\u4ef6] ${(replied.extra as { name?: string } | null)?.name ?? ''}`;
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
              <MessageContent msg={msg} isSelf={isSelf} />
            </div>
            <div style={{ display: 'flex', gap: 2, flexShrink: 0, paddingBottom: 2 }}>
              {isSelf && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <Tooltip content="撤回" position="top">
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
                {isSelf && (
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
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  useEffect(() => {
    try {
      const token = localStorage.getItem('zenith_token');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1])) as { userId?: number };
        setCurrentUserId(payload.userId ?? null);
      }
    } catch { /* ignore */ }
  }, []);

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

  const fetchConversations = useCallback(async () => {
    setLoadingConvs(true);
    const res = await request.get<ChatConversation[]>('/api/chat/conversations', { silent: true });
    setLoadingConvs(false);
    if (res.code === 0 && res.data) setConversations(res.data);
  }, []);

  useEffect(() => { void fetchConversations(); }, [fetchConversations]);

  const fetchMessages = useCallback(async (convId: number, p = 1) => {
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
      } else {
        setMessages((prev) => [...newMsgs, ...prev]);
        setPage(p);
      }
      setHasMore(res.data.list.length >= 30);
    }
  }, []);

  const handleSelectConv = useCallback(async (conv: ChatConversation) => {
    setActiveConvId(conv.id);
    setReplyTo(null);
    setShowMembers(false);
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

  const sendImageFile = useCallback(async (file: File) => {
    if (!activeConvId) return false;
    const fd = new FormData();
    fd.append('file', file);
    const uploadRes = await request.postForm<{ url: string; originalName: string; size: number }>(
      '/api/files/upload-one', fd,
    );
    if (uploadRes.code !== 0 || !uploadRes.data) {
      return false;
    }
    const { url, originalName, size } = uploadRes.data;
    const msgRes = await request.post<ChatMessage>(`/api/chat/conversations/${activeConvId}/messages`, {
      content: url,
      type: 'image',
      extra: { name: originalName, size },
    });
    return msgRes.code === 0;
  }, [activeConvId]);

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
    setUploading(false);
    setSending(false);

    if (failedImageCount > 0) {
      Toast.error(`有 ${failedImageCount} 张图片发送失败`);
    }
  }, [activeConvId, input, pendingImages, replyTo, sendImageFile, sending]);

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

  const handleRecall = useCallback(async (msg: ChatMessage) => {
    const res = await request.request<null>(`/api/chat/messages/${msg.id}/recall`, { method: 'PATCH' });
    if (res.code !== 0) Toast.error(res.message ?? '撤回失败');
  }, []);

  const handleWsMessage = useCallback((wsMsg: WsMessage) => {
    if (wsMsg.type === 'chat:message') {
      const msg = wsMsg.payload;
      if (msg.conversationId === activeConvId) {
        setMessages((prev) => [...prev, msg]);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
        request.post(`/api/chat/conversations/${msg.conversationId}/read`, {}, { silent: true }).catch(() => {});
      }
      setConversations((prev) => {
        const isActive = msg.conversationId === activeConvId;
        const updated = prev.map((c) =>
          c.id === msg.conversationId
            ? { ...c, lastMessage: msg, unreadCount: isActive ? 0 : c.unreadCount + 1, updatedAt: msg.createdAt }
            : c,
        );
        const idx = updated.findIndex((c) => c.id === msg.conversationId);
        if (idx > 0) {
          const [item] = updated.splice(idx, 1);
          updated.unshift(item);
        }
        return updated;
      });
    } else if (wsMsg.type === 'chat:recall') {
      const { messageId } = wsMsg.payload;
      setMessages((prev) =>
        prev.map((m) => m.id === messageId ? { ...m, isRecalled: true, content: '消息已撤回' } : m),
      );
    } else if (wsMsg.type === 'chat:member-join') {
      if (wsMsg.payload.conversationId === activeConvId) {
        void fetchConversations();
      }
    }
  }, [activeConvId, fetchConversations]);

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

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <Spin spinning={loadingConvs}>
            {filteredConvs.length === 0 && !loadingConvs && (
              <Empty description="暂无会话" style={{ padding: '40px 0' }} imageStyle={{ width: 80 }} />
            )}
            {filteredConvs.map((conv) => {
              const name = conv.type === 'direct' ? (conv.targetUser?.nickname ?? '未知用户') : (conv.name ?? '群聊');
              const avatarName = conv.type === 'direct' ? (conv.targetUser?.nickname ?? '?') : (conv.name ?? '?');
              const avatar = conv.type === 'direct' ? conv.targetUser?.avatar : null;
              const lastMsg = conv.lastMessage;
              const isActive = conv.id === activeConvId;
              let lastMsgText = '暂无消息';
              if (lastMsg) {
                if (lastMsg.isRecalled) {
                  lastMsgText = '消息已撤回';
                } else if (lastMsg.type === 'image') {
                  lastMsgText = '[图片]';
                } else {
                  lastMsgText = lastMsg.content;
                }
              }

              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => { void handleSelectConv(conv); }}
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
                      <UserAvatar name={avatarName} avatar={avatar} size={38} />
                    </Badge>
                  ) : (
                    <UserAvatar name={avatarName} avatar={avatar} size={38} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </Text>
                      {lastMsg && (
                        <Text type="tertiary" style={{ fontSize: 11, flexShrink: 0, marginLeft: 4 }}>
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
              <Avatar size="small" style={{ width: 32, height: 32, flexShrink: 0, backgroundColor: getAvatarColor(activeConv.name ?? '群聊') }}>
                <Users size={16} />
              </Avatar>
            )}
            <Title heading={6} style={{ margin: 0, flex: 1 }}>
              {activeConv.type === 'direct' ? (activeConv.targetUser?.nickname ?? '未知用户') : (activeConv.name ?? '群聊')}
            </Title>
            {activeConv.type === 'group' && (
              <Tooltip content={showMembers ? '关闭成员面板' : '查看群成员'}>
                <Button
                  size="small" theme="borderless" type={showMembers ? 'primary' : 'tertiary'}
                  icon={<Users size={15} />}
                  onClick={() => setShowMembers((v) => !v)}
                />
              </Tooltip>
            )}
          </div>

          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {hasMore && (
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
                {messages.length === 0 && !loadingMsgs && (
                  <Empty description="发送第一条消息吧" style={{ margin: 'auto' }} imageStyle={{ width: 80 }} />
                )}
                {messages.map((msg, index) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isSelf={msg.senderId === currentUserId}
                    onReply={setReplyTo}
                    onRecall={handleRecall}
                    shouldShowTime={shouldDisplayMessageTime(msg, messages[index + 1])}
                    getReplyMessage={getReplyMessage}
                    onScrollToMessage={scrollToMessage}
                  />
                ))}
                <div ref={messagesEndRef} />
              </Spin>
            </div>

            {/* Group members sidebar */}
            {activeConv.type === 'group' && showMembers && (
              <GroupMembersPanel conversationId={activeConv.id} />
            )}
          </div>

          {/* Input area */}
          <div style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--semi-color-border)' }}>
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
            </div>

            <div style={{ position: 'relative', flex: 1 }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
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
    </div>
  );
}
