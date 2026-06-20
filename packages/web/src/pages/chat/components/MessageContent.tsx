import { Typography, List, Button } from '@douyinfe/semi-ui';
import { getFileTypeIcon, formatFileSize, canPreviewFile } from '@/utils/file-utils';
import { getMessageExtra, renderTextWithMentions } from '../utils';
import type { ChatMessage, ChatMessageExtra, ChatCardAction } from '@zenith/shared';
import { VoiceMessage } from './VoiceMessage';
import { CardMessage } from './CardMessage';

const { Text } = Typography;

type ForwardedMessageItem = NonNullable<ChatMessageExtra['forwardedMessages']>[number];

function getForwardedItemKey(item: ForwardedMessageItem): string {
  return [item.createdAt, item.senderName ?? 'unknown', item.type, item.content].join('|');
}

function getForwardedItemPreview(item: ForwardedMessageItem): string {
  if (item.type === 'image') return '[图片，点击查看]';
  if (item.type === 'file') return `[文件] ${item.asset?.name ?? ''}`;
  if (item.type === 'voice') return '[语音]';
  return item.content;
}

export function MessageContent({
  msg, isSelf, onOpenImage, onOpenForwardView, currentUserId, onVote, onOpenFilePreview, onCardAction,
}: Readonly<{
  msg: ChatMessage;
  isSelf: boolean;
  onOpenImage?: (msg: ChatMessage) => void;
  onOpenForwardView?: (items: NonNullable<ChatMessageExtra['forwardedMessages']>, title: string) => void;
  currentUserId?: number | null;
  onVote?: (msg: ChatMessage, optionIds: string[]) => void;
  onOpenFilePreview?: (msg: ChatMessage) => void;
  onCardAction?: (msg: ChatMessage, action: ChatCardAction) => void;
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
    const sourceSuffix = sourceConvName ? ` · ${sourceConvName}` : '';
    const title = `聊天记录${sourceSuffix}`;
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
          <List
            split={false}
            dataSource={items.slice(0, 4)}
            renderItem={(item) => (
              <List.Item key={getForwardedItemKey(item)} style={{ padding: 0, marginBottom: 4, border: 'none' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <Text style={{ fontSize: 11, color: isSelf ? 'rgba(255,255,255,0.75)' : 'var(--semi-color-text-3)', flexShrink: 0, lineHeight: 1.6 }}>
                    {item.senderName ?? '未知'}：
                  </Text>
                  <Text style={{ fontSize: 12, color: isSelf ? 'rgba(255,255,255,0.9)' : 'var(--semi-color-text-1)', lineHeight: 1.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {getForwardedItemPreview(item)}
                  </Text>
                </div>
              </List.Item>
            )}
          />
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
    const isPreviewable = canPreviewFile(asset?.mimeType);
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
        {isPreviewable && (
          <Button
            size="small"
            theme="borderless"
            style={{
              flexShrink: 0,
              color: isSelf ? 'rgba(255,255,255,0.85)' : 'var(--semi-color-primary)',
              padding: '2px 6px',
            }}
            onClick={() => onOpenFilePreview?.(msg)}
          >
            预览
          </Button>
        )}
      </div>
    );
  }

  if (msg.type === 'voice') {
    return <VoiceMessage msg={msg} isSelf={isSelf} />;
  }

  if (msg.type === 'card') {
    return <CardMessage msg={msg} onCardAction={onCardAction} />;
  }

  if (msg.type === 'vote') {
    const voteData = extra?.voteData;
    if (!voteData) {
      return (
        <div style={bubbleStyle}>
          <Text type="tertiary">投票数据异常</Text>
        </div>
      );
    }

    const currentVote = voteData.votes.find((v) => v.userId === currentUserId);
    const currentSelected = new Set(currentVote?.optionIds ?? []);
    const totalVoters = voteData.votes.length;
    const isExpired = voteData.expireAt
      ? Date.now() > new Date(voteData.expireAt.replace(' ', 'T')).getTime()
      : false;
    const disabled = voteData.isClosed || isExpired;

    return (
      <div style={{ ...bubbleStyle, minWidth: 260, maxWidth: 360 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{voteData.question}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {voteData.options.map((option) => {
            const count = voteData.votes.filter((v) => v.optionIds.includes(option.id)).length;
            const ratio = totalVoters > 0 ? (count / totalVoters) * 100 : 0;
            const selected = currentSelected.has(option.id);
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (!onVote) return;
                  if (!voteData.isMultiple) {
                    onVote(msg, [option.id]);
                    return;
                  }
                  const next = new Set(currentSelected);
                  if (next.has(option.id)) next.delete(option.id);
                  else next.add(option.id);
                  const optionIds = [...next];
                  if (optionIds.length > 0) onVote(msg, optionIds);
                }}
                style={{
                  border: selected ? '1px solid var(--semi-color-primary)' : '1px solid var(--semi-color-border)',
                  background: selected ? 'var(--semi-color-primary-light-default)' : 'var(--semi-color-fill-0)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                  <span>{option.label}</span>
                  <span style={{ color: 'var(--semi-color-text-2)' }}>{count} 票</span>
                </div>
                <div
                  style={{
                    marginTop: 6,
                    height: 6,
                    width: '100%',
                    borderRadius: 999,
                    background: 'var(--semi-color-fill-2)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${ratio}%`,
                      height: '100%',
                      background: selected ? 'var(--semi-color-primary)' : 'var(--semi-color-primary-light-active)',
                      transition: 'width 0.2s ease',
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: isSelf ? 'rgba(255,255,255,0.75)' : 'var(--semi-color-text-2)' }}>
          {voteData.isMultiple ? '多选' : '单选'} · {voteData.isAnonymous ? '匿名投票' : '实名投票'} · 共 {totalVoters} 人参与
        </div>
        {(voteData.isClosed || isExpired) && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--semi-color-warning)' }}>
            {voteData.isClosed ? '该投票已关闭' : '该投票已截止'}
          </div>
        )}
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
