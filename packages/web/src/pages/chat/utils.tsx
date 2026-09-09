import type { ReactNode } from 'react';
import type { ChatMessage, ChatAssetMeta, ChatMessageExtra } from '@zenith/shared/chat';
import { escapeRegExp } from '@zenith/shared/core';

export const MESSAGE_TIME_GROUP_GAP_MS = 5 * 60 * 1000;

export const URL_REGEX = /(https?:\/\/[^\s]+)/ig;

function getMessageTimestamp(value: string): number {
  return new Date(value.replace(' ', 'T')).getTime();
}

export function shouldDisplayMessageTime(current: ChatMessage, next?: ChatMessage): boolean {
  if (!next) return true;
  const currentTime = getMessageTimestamp(current.createdAt);
  const nextTime = getMessageTimestamp(next.createdAt);
  if (Number.isNaN(currentTime) || Number.isNaN(nextTime)) return true;
  return nextTime - currentTime > MESSAGE_TIME_GROUP_GAP_MS;
}

export function extractFirstUrl(content: string): string | null {
  const hit = content.match(URL_REGEX);
  return hit?.[0] ?? null;
}

export function getFileExtension(fileName: string): string | null {
  const cleanName = fileName.split('?')[0] ?? fileName;
  const index = cleanName.lastIndexOf('.');
  if (index <= 0 || index === cleanName.length - 1) return null;
  return cleanName.slice(index + 1).toLowerCase();
}

export function getMessageExtra(msg: ChatMessage): ChatMessageExtra | null {
  return msg.extra ?? null;
}

export function getAssetMeta(msg: ChatMessage): ChatAssetMeta | null {
  return getMessageExtra(msg)?.asset ?? null;
}

export function getMessageSummary(msg: ChatMessage): string {
  if (msg.isRecalled) return '消息已撤回';
  if (msg.type === 'image') {
    const asset = getAssetMeta(msg);
    return asset?.name ? `[图片] ${asset.name}` : '[图片]';
  }
  if (msg.type === 'file') {
    const asset = getAssetMeta(msg);
    return asset?.name ? `[文件] ${asset.name}` : '[文件]';
  }
  if (msg.type === 'voice') return '[语音]';
  if (msg.type === 'video') {
    const asset = getAssetMeta(msg);
    return asset?.name ? `[视频] ${asset.name}` : '[视频]';
  }
  if (msg.type === 'card') {
    const card = getMessageExtra(msg)?.card;
    return card?.title ? `[卡片] ${card.title}` : '[卡片]';
  }
  return msg.content;
}

export async function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
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

/** 把文本按 URL 切分：链接段渲染为 <a>，其余段交给 renderText（纯文本 / 提及高亮） */
function renderTextWithLinkParts(content: string, isSelf: boolean, renderText: (part: string, idx: number) => ReactNode): ReactNode[] {
  return content.split(URL_REGEX).map((part, idx) => {
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
    return renderText(part, idx);
  });
}

export function renderTextWithLinks(content: string, isSelf: boolean) {
  return renderTextWithLinkParts(content, isSelf, (part, idx) => <span key={`${part}-${idx}`}>{part}</span>);
}

export function renderTextWithMentions(content: string, isSelf: boolean, mentions?: Array<{ nickname: string }> | null) {
  const labels = Array.from(new Set((mentions ?? []).map((item) => `@${item.nickname}`))).sort((a, b) => b.length - a.length);
  if (labels.length === 0) return renderTextWithLinks(content, isSelf);

  const mentionRegex = new RegExp(`(${labels.map(escapeRegExp).join('|')})`, 'g');
  return renderTextWithLinkParts(content, isSelf, (part, idx) => part.split(mentionRegex).map((segment, segmentIdx) => {
    if (labels.includes(segment)) {
      return (
        <span
          key={`${segment}-${idx}-${segmentIdx}`}
          style={{
            color: isSelf ? '#fff' : 'var(--semi-color-primary)',
            fontWeight: 600,
            background: isSelf ? 'rgba(255,255,255,0.14)' : 'var(--semi-color-primary-light-default)',
            borderRadius: 'var(--semi-border-radius-small)',
            padding: '0 2px',
          }}
        >
          {segment}
        </span>
      );
    }
    return <span key={`${segment}-${idx}-${segmentIdx}`}>{segment}</span>;
  }));
}
