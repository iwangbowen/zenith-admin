import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Toast, Tooltip, Dropdown, Typography } from '@douyinfe/semi-ui';
import {
  CornerDownLeft, RotateCcw, Copy, Bookmark, Pin, Trash2, Forward, CheckSquare, Square, Download, Pencil, Check, X as XIcon,
} from 'lucide-react';
import { formatDateTime } from '@/utils/date';
import type { ChatMessage, ChatMessageExtra } from '@zenith/shared';
import { getAssetMeta } from '../utils';
import { UserAvatar } from './UserAvatar';
import { MessageContent } from './MessageContent';

const { Text } = Typography;

export function MessageBubble({
  msg, isSelf, onReply, onRecall, onOpenImage, shouldShowTime, getReplyMessage, onScrollToMessage,
  onToggleFavorite, onTogglePin, onEditRecalled, recalledDraft, multiSelectMode, isSelected,
  onToggleSelect, onForwardSingle, onOpenForwardView, onDeleteMessage, onReaction, onPickReactionEmoji,
  currentUserId, onEdit,
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
  onDeleteMessage?: (msg: ChatMessage) => void;
  onReaction?: (messageId: number, emoji: string) => void;
  onPickReactionEmoji?: (messageId: number, e: React.MouseEvent) => void;
  currentUserId?: number | null;
  onEdit?: (msg: ChatMessage) => void;
}>) {
  const fullTimeStr = formatDateTime(msg.createdAt);
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [inlineEditing, setInlineEditing] = useState(false);
  const [inlineEditContent, setInlineEditContent] = useState('');
  const inlineEditRef = useRef<HTMLTextAreaElement>(null);
  const showBottomTime = shouldShowTime || isHovered;

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

  // 24 小时内可编辑（文本消息且为自己发送）
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const canEdit = isSelf && !msg.isRecalled && msg.type === 'text'
    && (Date.now() - new Date(msg.createdAt.replace(' ', 'T')).getTime() < ONE_DAY_MS);

  const handleStartInlineEdit = useCallback(() => {
    setInlineEditContent(msg.content);
    setInlineEditing(true);
    setTimeout(() => inlineEditRef.current?.focus(), 50);
  }, [msg.content]);

  const handleCancelInlineEdit = useCallback(() => {
    setInlineEditing(false);
    setInlineEditContent('');
  }, []);

  const handleConfirmInlineEdit = useCallback(() => {
    if (!inlineEditContent.trim()) return;
    onEdit?.({ ...msg, content: inlineEditContent.trim() });
    setInlineEditing(false);
    setInlineEditContent('');
  }, [inlineEditContent, msg, onEdit]);

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

  const handleCopyFile = useCallback(async () => {
    const mimeType = getAssetMeta(msg)?.mimeType ?? 'application/octet-stream';
    try {
      const resp = await fetch(msg.content);
      if (!resp.ok) throw new Error('fetch failed');
      const blob = await resp.blob();

      if (mimeType.startsWith('image/')) {
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
          img.onerror = () => reject(new Error('load failed'));
          img.src = URL.createObjectURL(blob);
        });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        Toast.success('文件（图片）已复制到剪贴板');
        return;
      }

      if ('ClipboardItem' in window && navigator.clipboard.write) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ [mimeType]: blob })]);
          Toast.success('文件已复制到剪贴板');
          return;
        } catch { /* fall through to download */ }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = getAssetMeta(msg)?.name ?? '文件';
      a.click();
      URL.revokeObjectURL(url);
      Toast.info('浏览器不支持复制此类文件，已改为下载');
    } catch {
      Toast.error('复制失败');
    }
  }, [msg]);

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
          let replyText = '原消息已不在';
          let replySender = '';
          if (replied) {
            replySender = replied.senderName ?? '';
            if (replied.isRecalled) replyText = '消息已撤回';
            else if (replied.type === 'image') replyText = '[图片]';
            else if (replied.type === 'file') replyText = `[文件] ${getAssetMeta(replied)?.name ?? ''}`;
            else replyText = replied.content.length > 40 ? `${replied.content.slice(0, 40)}…` : replied.content;
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
              {inlineEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220, maxWidth: 360 }}>
                  {/* 编辑框——与气泡同款圆角，仅用发光底边表示激活态 */}
                  <div
                    style={{
                      position: 'relative',
                      background: isSelf ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-1)',
                      borderRadius: isSelf ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                      padding: '1px',
                      boxShadow: '0 0 0 2px var(--semi-color-primary)',
                    }}
                  >
                    <textarea
                      ref={inlineEditRef}
                      value={inlineEditContent}
                      onChange={(e) => setInlineEditContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleConfirmInlineEdit(); }
                        else if (e.key === 'Escape') handleCancelInlineEdit();
                      }}
                      rows={Math.min(6, Math.max(2, inlineEditContent.split('\n').length))}
                      style={{
                        display: 'block',
                        width: '100%',
                        resize: 'none',
                        borderRadius: isSelf ? '11px 11px 3px 11px' : '11px 11px 11px 3px',
                        padding: '8px 12px',
                        border: 'none',
                        background: isSelf ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-1)',
                        color: isSelf ? '#fff' : 'var(--semi-color-text-0)',
                        caretColor: isSelf ? '#fff' : 'var(--semi-color-primary)',
                        fontSize: 14,
                        fontFamily: 'inherit',
                        outline: 'none',
                        lineHeight: 1.5,
                        wordBreak: 'break-word',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  {/* 操作行：快捷键提示 + 图标按钮 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: isSelf ? 'flex-end' : 'flex-start',
                      gap: 6,
                    }}
                  >
                    <Text
                      type="quaternary"
                      style={{ fontSize: 11, lineHeight: 1, userSelect: 'none' }}
                    >
                      Enter 保存 · Esc 取消
                    </Text>
                    <Button
                      size="small"
                      theme="solid"
                      type="primary"
                      icon={<Check size={11} />}
                      onClick={handleConfirmInlineEdit}
                      style={{ padding: '2px 8px', height: 22, borderRadius: 11 }}
                    />
                    <Button
                      size="small"
                      theme="borderless"
                      type="tertiary"
                      icon={<XIcon size={11} />}
                      onClick={handleCancelInlineEdit}
                      style={{ padding: '2px 6px', height: 22, borderRadius: 11 }}
                    />
                  </div>
                </div>
              ) : (
                <MessageContent msg={msg} isSelf={isSelf} onOpenImage={onOpenImage} onOpenForwardView={onOpenForwardView} />
              )}
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
        {/* Reaction bar */}
        {(msg.reactions?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, justifyContent: isSelf ? 'flex-end' : 'flex-start' }}>
            {(msg.reactions ?? []).map((r) => {
              const reacted = currentUserId !== null && r.userIds.includes(currentUserId ?? 0);
              return (
                <button
                  key={r.emoji}
                  type="button"
                  title={`${r.count} 人`}
                  onClick={() => onReaction?.(msg.id, r.emoji)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    background: reacted ? 'var(--semi-color-primary-light-default)' : 'var(--semi-color-fill-1)',
                    border: reacted ? '1px solid var(--semi-color-primary)' : '1px solid var(--semi-color-border)',
                    borderRadius: 12, padding: '1px 7px', fontSize: 13, cursor: 'pointer',
                    lineHeight: 1.5,
                  }}
                >
                  <span>{r.emoji}</span>
                  <span style={{ fontSize: 11, color: reacted ? 'var(--semi-color-primary)' : 'var(--semi-color-text-2)' }}>{r.count}</span>
                </button>
              );
            })}
            <button
              type="button"
              title="添加表情回应"
              onClick={(e) => onPickReactionEmoji?.(msg.id, e)}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26,
                background: 'var(--semi-color-fill-0)',
                border: '1px dashed var(--semi-color-border)',
                borderRadius: 13, cursor: 'pointer', fontSize: 14, color: 'var(--semi-color-text-3)',
              }}
            >
              +
            </button>
          </div>
        )}
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
            padding: '0 2px',
          }}
        >
          {fullTimeStr}{msg.isEdited && <span style={{ marginLeft: 4, color: 'var(--semi-color-text-3)', fontStyle: 'italic' }}>已编辑</span>}
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
                {!msg.isRecalled && (
                  <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid var(--semi-color-border)' }}>
                    {['👍', '❤️', '😂', '😮', '😢', '👎'].map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => { onReaction?.(msg.id, emoji); setContextMenuPos(null); }}
                        style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                <Dropdown.Item
                  icon={<CornerDownLeft size={12} />}
                  onClick={() => { onReply(msg); setContextMenuPos(null); }}
                >
                  回复
                </Dropdown.Item>
                {isSelf && canRecall && !msg.isRecalled && (
                  <Dropdown.Item
                    icon={<RotateCcw size={12} />}
                    onClick={() => { onRecall(msg); setContextMenuPos(null); }}
                  >
                    撤回
                  </Dropdown.Item>
                )}
                {canEdit && (
                  <Dropdown.Item
                    icon={<Pencil size={12} />}
                    onClick={() => { handleStartInlineEdit(); setContextMenuPos(null); }}
                  >
                    编辑
                  </Dropdown.Item>
                )}
                {msg.type === 'text' && (
                  <Dropdown.Item
                    icon={<Copy size={12} />}
                    onClick={() => { void handleCopyText(); setContextMenuPos(null); }}
                  >
                    复制
                  </Dropdown.Item>
                )}
                {msg.type === 'image' && (
                  <Dropdown.Item
                    icon={<Copy size={12} />}
                    onClick={() => { void handleCopyImage(); setContextMenuPos(null); }}
                  >
                    复制
                  </Dropdown.Item>
                )}
                {msg.type === 'file' && (
                  <Dropdown.Item
                    icon={<Copy size={12} />}
                    onClick={() => { void handleCopyFile(); setContextMenuPos(null); }}
                  >
                    复制
                  </Dropdown.Item>
                )}
                {msg.type === 'file' && (
                  <Dropdown.Item
                    icon={<Download size={12} />}
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = msg.content;
                      a.download = getAssetMeta(msg)?.name ?? '文件';
                      a.click();
                      setContextMenuPos(null);
                    }}
                  >
                    下载
                  </Dropdown.Item>
                )}
                <Dropdown.Item
                  icon={<Bookmark size={12} />}
                  onClick={() => { onToggleFavorite(msg); setContextMenuPos(null); }}
                >
                  {msg.extra?.isFavorited ? '取消收藏' : '收藏'}
                </Dropdown.Item>
                <Dropdown.Item
                  icon={<Pin size={12} />}
                  onClick={() => { onTogglePin(msg); setContextMenuPos(null); }}
                >
                  {msg.extra?.isPinned ? '取消置顶消息' : '置顶消息'}
                </Dropdown.Item>
                {!msg.isRecalled && (
                  <Dropdown.Item
                    icon={<Trash2 size={12} />}
                    type="danger"
                    onClick={() => { onDeleteMessage?.(msg); setContextMenuPos(null); }}
                  >
                    删除
                  </Dropdown.Item>
                )}
                {!msg.isRecalled && (
                  <Dropdown.Item
                    icon={<Forward size={12} />}
                    onClick={() => { onForwardSingle?.(msg); setContextMenuPos(null); }}
                  >
                    转发
                  </Dropdown.Item>
                )}
                {!msg.isRecalled && (
                  <Dropdown.Item
                    icon={<CheckSquare size={12} />}
                    onClick={() => { onToggleSelect?.(msg); setContextMenuPos(null); }}
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
