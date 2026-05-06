import type { ChatMessage, ChatAssetMeta, ChatMessageExtra } from '@zenith/shared';

export const MESSAGE_TIME_GROUP_GAP_MS = 5 * 60 * 1000;

export const URL_REGEX = /(https?:\/\/[^\s]+)/ig;

export function getAvatarColor(name: string): string {
  const colors = ['#f093fb', '#4facfe', '#43e97b', '#fa709a', '#fee140', '#a18cd1', '#fbc2eb', '#a1c4fd'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (name.codePointAt(i) ?? 0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

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

export function renderTextWithLinks(content: string, isSelf: boolean) {
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

export function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function renderTextWithMentions(content: string, isSelf: boolean, mentions?: Array<{ nickname: string }> | null) {
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
