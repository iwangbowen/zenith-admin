import { Typography } from '@douyinfe/semi-ui';
import { getFileTypeIcon, formatFileSize } from '@/utils/file-utils';
import { getMessageExtra, getAssetMeta, renderTextWithMentions } from '../utils';
import type { ChatMessage, ChatMessageExtra } from '@zenith/shared';

const { Text } = Typography;

export function MessageContent({
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
